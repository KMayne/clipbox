/**
 * RPM packages: metadata, dependencies, scriptlets and the file list all come from the main
 * header, so listing never touches the payload. Extraction streams the payload (a cpio archive)
 * through its decompressor until the wanted file has been read; core handles gzip and
 * uncompressed payloads, the libarchive module the rest.
 */

import { Gunzip } from 'fflate';
import { CpioReader, isDirectory, isRegular, isSymlink } from './cpio';
import type { RpmInfo, RpmScript } from './packages/types';
import {
  readRpmHeaders,
  rpmInts,
  rpmString,
  rpmStrings,
  RPM_TAG_PAYLOADCOMPRESSOR,
  type RpmHeader,
} from './rpmHeader';
import { MAX_ENTRY_BYTES, MAX_RATIO, capExceeded, normalisePath, type ArchiveEntry } from './types';

const TAG = {
  name: 1000,
  version: 1001,
  release: 1002,
  epoch: 1003,
  summary: 1004,
  description: 1005,
  buildTime: 1006,
  buildHost: 1007,
  size: 1009,
  vendor: 1011,
  license: 1014,
  packager: 1015,
  group: 1016,
  url: 1020,
  arch: 1022,
  oldFilenames: 1027,
  fileSizes: 1028,
  fileModes: 1030,
  fileMtimes: 1034,
  fileFlags: 1037,
  sourceRpm: 1044,
  provideName: 1047,
  requireFlags: 1048,
  requireName: 1049,
  requireVersion: 1050,
  conflictFlags: 1053,
  conflictName: 1054,
  conflictVersion: 1055,
  triggerScripts: 1065,
  triggerName: 1066,
  triggerVersion: 1067,
  triggerFlags: 1068,
  triggerIndex: 1069,
  obsoleteName: 1090,
  triggerScriptProg: 1092,
  provideFlags: 1112,
  provideVersion: 1113,
  obsoleteFlags: 1114,
  obsoleteVersion: 1115,
  dirIndexes: 1116,
  baseNames: 1117,
  dirNames: 1118,
  payloadFormat: 1124,
  longFileSizes: 5008,
  longSize: 5009,
} as const;

/** Scriptlet body tag, interpreter tag and the spec-file section name. */
const SCRIPTLETS: [number, number, string][] = [
  [1151, 1153, '%pretrans'],
  [1023, 1085, '%pre'],
  [1024, 1086, '%post'],
  [1025, 1087, '%preun'],
  [1026, 1088, '%postun'],
  [1152, 1154, '%posttrans'],
];

const SENSE_LESS = 2;
const SENSE_GREATER = 4;
const SENSE_EQUAL = 8;
const TRIGGER_TYPES: [number, string][] = [
  [1 << 25, '%triggerprein'],
  [1 << 16, '%triggerin'],
  [1 << 17, '%triggerun'],
  [1 << 18, '%triggerpostun'],
];
const RPMFILE_GHOST = 1 << 6;
const LEAD_TYPE_SOURCE = 1;

export interface RpmListing {
  info: RpmInfo;
  entries: ArchiveEntry[];
  /** The cpio name of each entry ("./usr/bin/x"), for extraction. */
  names: string[];
  payloadOffset: number;
}

/** "glibc >= 2.34" from a name, its sense flags and version. */
function dependencies(h: RpmHeader, names: number, flags: number, versions: number): string[] {
  const n = rpmStrings(h, names);
  const f = rpmInts(h, flags);
  const v = rpmStrings(h, versions);
  return n.map((name, i) => {
    const version = v[i] ?? '';
    const sense = f[i] ?? 0;
    const op =
      (sense & SENSE_LESS ? '<' : '') +
      (sense & SENSE_GREATER ? '>' : '') +
      (sense & SENSE_EQUAL ? '=' : '');
    return version && op ? `${name} ${op} ${version}` : name;
  });
}

function scriptlets(h: RpmHeader): RpmScript[] {
  const out: RpmScript[] = [];
  for (const [bodyTag, progTag, name] of SCRIPTLETS) {
    const body = rpmString(h, bodyTag);
    const prog = rpmStrings(h, progTag);
    if (body === null && prog.length === 0) continue;
    out.push({ name, program: prog.length > 0 ? prog.join(' ') : null, body: body ?? '' });
  }
  // Triggers: each name points at its script through TRIGGERINDEX
  const scripts = rpmStrings(h, TAG.triggerScripts);
  const progs = rpmStrings(h, TAG.triggerScriptProg);
  const names = dependencies(h, TAG.triggerName, TAG.triggerFlags, TAG.triggerVersion);
  const flags = rpmInts(h, TAG.triggerFlags);
  const index = rpmInts(h, TAG.triggerIndex);
  scripts.forEach((body, s) => {
    const on = names.filter((_, i) => index[i] === s);
    const first = names.findIndex((_, i) => index[i] === s);
    const type =
      TRIGGER_TYPES.find(([bit]) => ((flags[first] ?? 0) & bit) !== 0)?.[1] ?? '%trigger';
    out.push({
      name: on.length > 0 ? `${type} -- ${on.join(', ')}` : type,
      program: progs[s] ?? null,
      body,
    });
  });
  return out;
}

/** Full paths from BASENAMES/DIRNAMES/DIRINDEXES, or the old-style OLDFILENAMES. */
function filePaths(h: RpmHeader): string[] {
  const base = rpmStrings(h, TAG.baseNames);
  if (base.length > 0) {
    const dirs = rpmStrings(h, TAG.dirNames);
    const index = rpmInts(h, TAG.dirIndexes);
    return base.map((b, i) => (dirs[index[i] ?? -1] ?? '') + b);
  }
  return rpmStrings(h, TAG.oldFilenames);
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');

/** Parses the headers and builds the file list; throws when the headers are malformed. */
export function parseRpm(bytes: Uint8Array): RpmListing {
  const { main: h, payloadOffset } = readRpmHeaders(bytes);
  const leadType = ((bytes[6] ?? 0) << 8) | (bytes[7] ?? 0);

  const paths = filePaths(h);
  const longSizes = rpmInts(h, TAG.longFileSizes);
  const sizes = longSizes.length > 0 ? longSizes : rpmInts(h, TAG.fileSizes);
  const modes = rpmInts(h, TAG.fileModes);
  const mtimes = rpmInts(h, TAG.fileMtimes);
  const fileFlags = rpmInts(h, TAG.fileFlags);

  const entries: ArchiveEntry[] = [];
  const names: string[] = [];
  const skipped = { symlinks: 0, ghosts: 0, other: 0 };
  paths.forEach((full, i) => {
    const mode = modes[i] ?? 0;
    if ((fileFlags[i] ?? 0) & RPMFILE_GHOST) {
      skipped.ghosts++;
      return;
    }
    const isDir = isDirectory(mode);
    if (!isDir && !isRegular(mode)) {
      if (isSymlink(mode)) skipped.symlinks++;
      else skipped.other++;
      return;
    }
    const path = normalisePath(full, isDir);
    if (path === '') return;
    const mtime = mtimes[i];
    entries.push({
      path,
      size: isDir ? 0 : (sizes[i] ?? 0),
      ...(mtime ? { modified: iso(mtime) } : {}),
      isDir,
    });
    names.push(`.${full.startsWith('/') ? '' : '/'}${full}`);
  });

  const epoch = rpmInts(h, TAG.epoch)[0];
  const buildTime = rpmInts(h, TAG.buildTime)[0];
  const installedSize = rpmInts(h, TAG.longSize)[0] ?? rpmInts(h, TAG.size)[0];
  const info: RpmInfo = {
    type: 'rpm',
    name: rpmString(h, TAG.name) ?? '',
    version: rpmString(h, TAG.version) ?? '',
    release: rpmString(h, TAG.release) ?? '',
    epoch: epoch ?? null,
    arch: rpmString(h, TAG.arch),
    source: leadType === LEAD_TYPE_SOURCE,
    summary: rpmString(h, TAG.summary),
    description: rpmString(h, TAG.description),
    license: rpmString(h, TAG.license),
    url: rpmString(h, TAG.url),
    vendor: rpmString(h, TAG.vendor),
    packager: rpmString(h, TAG.packager),
    group: rpmString(h, TAG.group),
    buildHost: rpmString(h, TAG.buildHost),
    buildTime: buildTime ? iso(buildTime) : null,
    sourceRpm: rpmString(h, TAG.sourceRpm),
    installedSize: installedSize ?? null,
    requires: dependencies(h, TAG.requireName, TAG.requireFlags, TAG.requireVersion),
    provides: dependencies(h, TAG.provideName, TAG.provideFlags, TAG.provideVersion),
    conflicts: dependencies(h, TAG.conflictName, TAG.conflictFlags, TAG.conflictVersion),
    obsoletes: dependencies(h, TAG.obsoleteName, TAG.obsoleteFlags, TAG.obsoleteVersion),
    payloadFormat: rpmString(h, TAG.payloadFormat),
    payloadCompressor: rpmString(h, RPM_TAG_PAYLOADCOMPRESSOR) ?? 'gzip',
    scripts: scriptlets(h),
    skipped,
  };
  return { info, entries, names, payloadOffset };
}

/** "nginx-1.24.0-1.el9.x86_64" (with "epoch:" before the version when set). */
export function nevra(i: RpmInfo): string {
  const version = `${i.epoch !== null && i.epoch > 0 ? `${i.epoch}:` : ''}${i.version}`;
  const arch = i.source ? 'src' : i.arch;
  return [i.name, version, i.release].filter(Boolean).join('-') + (arch ? `.${arch}` : '');
}

/** A streaming decompressor: `push` calls `ondata` with output as it's produced. */
export type StreamDecoder = (ondata: (chunk: Uint8Array) => void) => {
  push(chunk: Uint8Array, final?: boolean): void;
};

const STEP = 64 * 1024;

/**
 * Streams `payload` through `decode` into a cpio reader until `name` has been read. The output
 * is capped at the ratio limit (unless `force`), so a bomb can't keep it busy forever.
 */
export function extractFromPayload(
  payload: Uint8Array,
  name: string,
  path: string,
  force: boolean,
  decode: StreamDecoder | null,
): Uint8Array<ArrayBuffer> {
  const reader = new CpioReader(name, force ? Infinity : MAX_ENTRY_BYTES);
  if (!decode) {
    reader.push(payload);
  } else {
    const cap = force ? Infinity : Math.max(payload.byteLength, 1) * MAX_RATIO;
    let total = 0;
    const stream = decode(chunk => {
      total += chunk.byteLength;
      if (total > cap) throw capExceeded(path);
      if (!reader.done) reader.push(chunk);
    });
    for (let i = 0; i < payload.byteLength && !reader.done; i += STEP) {
      stream.push(payload.subarray(i, i + STEP), i + STEP >= payload.byteLength);
    }
  }
  if (!reader.found) throw new Error(`${path} isn't in the RPM payload`);
  return reader.found;
}

export const gunzipStream: StreamDecoder = ondata => {
  const s = new Gunzip();
  s.ondata = chunk => ondata(chunk);
  return s;
};
