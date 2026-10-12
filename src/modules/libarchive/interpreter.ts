import { Decompress, decompress } from 'fzstd';
import { archiveInterpreter } from '../../core/archive/interpreter';
import { extractFromPayload, parseRpm, type StreamDecoder } from '../../core/archive/rpm';
import { isTar, tarValue } from '../../core/archive/tar';
import {
  ExtractionGuardError,
  normalisePath,
  outputCap,
  type ArchiveFormat,
  type ArchiveValue,
} from '../../core/archive/types';
import { inflateCapped } from '../../core/archive/zip';
import type { EntryContent } from '../../core/content';
import { libarchiveDetector, sniffLibarchive, type LibarchiveFormat } from './detect';
import type { Libarchive } from './reader';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function unsupported(format: ArchiveFormat, c: EntryContent, reason: string): ArchiveValue {
  return {
    kind: 'archive',
    format,
    archiveBytes: c.size,
    entries: [],
    source: { type: 'external', bytes: c.bytes, names: [] },
    unsupported: reason,
  };
}

const zstdName = (name?: string) =>
  name && /\.zstd?$/i.test(name)
    ? name.replace(/\.zstd?$/i, '')
    : name?.endsWith('.tzst')
      ? name.replace(/\.tzst$/, '.tar')
      : 'data';

function zstdDecode(bytes: Uint8Array, path: string, force: boolean): Uint8Array<ArrayBuffer> {
  if (force) return new Uint8Array(decompress(bytes));
  return inflateCapped(bytes, outputCap(bytes.byteLength, false), path, ondata => {
    const s = new Decompress(chunk => ondata(chunk));
    return { push: (chunk, final) => s.push(chunk, final) };
  });
}

/** zstd: libarchive's build lacks it, so fzstd decompresses and the core tar reader lists. */
function zstdValue(c: EntryContent): ArchiveValue {
  const name = zstdName(c.name);
  let data: Uint8Array<ArrayBuffer> | null = null;
  let note: string | undefined;
  try {
    data = zstdDecode(c.bytes, name, false);
  } catch (err) {
    if (!(err instanceof ExtractionGuardError)) return unsupported('zstd', c, errorMessage(err));
    note = 'Too large to decompress up front; opening the file asks for confirmation';
  }
  if (data && isTar(data)) return tarValue(data, 'tar.zst', c.size);
  return {
    kind: 'archive',
    format: 'zstd',
    archiveBytes: c.size,
    entries: [{ path: name, size: data?.byteLength ?? 0, compressedSize: c.size, isDir: false }],
    source: { type: 'single', bytes: c.bytes, data },
    ...(note ? { note } : {}),
  };
}

const TAR_FORMAT: Record<LibarchiveFormat, ArchiveFormat> = {
  '7z': '7z',
  rar: 'rar',
  xz: 'tar.xz',
  bz2: 'tar.bz2',
  zstd: 'tar.zst',
  rpm: 'rpm',
};

const zstdStream: StreamDecoder = ondata => {
  const s = new Decompress(chunk => ondata(chunk));
  return { push: (chunk, final) => s.push(chunk, final) };
};

/**
 * RPMs with non-gzip payloads: the header (parsed in core) lists the files without decompressing;
 * extraction goes through libarchive, which reads RPM natively, except zstd (its build lacks it),
 * which streams through fzstd into core's cpio reader.
 */
function rpmValue(c: EntryContent): ArchiveValue {
  let listing;
  try {
    listing = parseRpm(c.bytes);
  } catch (err) {
    return unsupported('rpm', c, errorMessage(err));
  }
  return {
    kind: 'archive',
    format: 'rpm',
    archiveBytes: c.size,
    entries: listing.entries,
    source: { type: 'external', bytes: c.bytes, names: listing.names },
    package: listing.info,
  };
}

async function libarchiveValue(
  c: EntryContent,
  format: LibarchiveFormat,
  lib: Libarchive,
): Promise<ArchiveValue> {
  let listed;
  try {
    listed = await lib.list(c.bytes);
  } catch (err) {
    return unsupported(format, c, errorMessage(err));
  }
  // libarchive is built without its "raw" format, so a bare .xz/.bz2 stream lists nothing
  if (listed.length === 0 && (format === 'xz' || format === 'bz2')) {
    return unsupported(
      format,
      c,
      `Single-file ${format} streams aren't supported yet, only tar.${format} archives`,
    );
  }
  const kept = listed
    .map(e => ({ ...e, path: normalisePath(e.name, e.isDir) }))
    .filter(e => e.path !== '');
  return {
    kind: 'archive',
    format: TAR_FORMAT[format],
    archiveBytes: c.size,
    entries: kept.map(e => ({ path: e.path, size: e.isDir ? 0 : e.size, isDir: e.isDir })),
    source: { type: 'external', bytes: c.bytes, names: kept.map(e => e.name) },
  };
}

/** 7z, rar, tar.xz and tar.bz2 through libarchive's WASM build; zstd through fzstd. */
export function createLibarchiveInterpreter(load: () => Promise<Libarchive>) {
  return archiveInterpreter({
    detect: c => libarchiveDetector.detect(c),
    async parse(c) {
      const format = sniffLibarchive(c.bytes);
      if (!format) throw new Error('Not a libarchive format');
      if (format === 'zstd') return zstdValue(c);
      if (format === 'rpm') return rpmValue(c);
      return libarchiveValue(c, format, await load());
    },
    async extractExternal(v, index, force) {
      const name = v.source.type === 'external' ? v.source.names[index] : undefined;
      if (name === undefined) throw new Error(`No entry ${index}`);
      if (v.package?.type === 'rpm' && v.package.payloadCompressor === 'zstd') {
        const offset = parseRpm(v.source.bytes).payloadOffset;
        const path = v.entries[index]?.path ?? name;
        return extractFromPayload(v.source.bytes.subarray(offset), name, path, force, zstdStream);
      }
      return (await load()).extract(v.source.bytes, name);
    },
    decodeSingle(v, force) {
      const path = v.entries[0]?.path ?? 'data';
      return zstdDecode(v.source.bytes, path, force);
    },
  });
}
