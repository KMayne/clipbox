/**
 * Everything about the `archive` kind except detection and parsing, shared by the core interpreter
 * (zip/gzip/tar) and the libarchive module (7z/rar/xz/bz2/zstd).
 */

import type { EntryContent } from '../content';
import { formatBytes, formatCount, plural } from '../format';
import { hasKind } from '../guards';
import { unsupportedSlice, type InterpretContext, type Interpreter } from '../interpreter';
import type { DerivedContent, StatRow } from '../types';
import { gunzipCapped } from './gzip';
import {
  basename,
  checkGuard,
  extension,
  FORCE_PREFIX,
  guessMime,
  type ArchiveValue,
} from './types';
import { extractZipEntry } from './zip';

/** "Open as" lists at most this many entries; the preview table opens the rest. */
export const MAX_DERIVATIONS = 20;
const TOP_FILES = 10;

type MaybePromise<T> = T | Promise<T>;

export interface ArchiveParts {
  requires?: string[];
  detect(c: EntryContent): number;
  parse(c: EntryContent, ctx: InterpretContext): MaybePromise<ArchiveValue>;
  /** Extracts entries of an 'external' source; core sources are handled here. */
  extractExternal?(v: ArchiveValue, index: number): MaybePromise<Uint8Array<ArrayBuffer>>;
  /** Decompresses a 'single' source that wasn't decompressed up front (non-gzip formats). */
  decodeSingle?(v: ArchiveValue, force: boolean): MaybePromise<Uint8Array<ArrayBuffer>>;
}

const formatName = (v: ArchiveValue) => v.format.toUpperCase();

export const archiveLabel = (v: ArchiveValue) => {
  if (v.unsupported) return `${formatName(v)} · unsupported`;
  const files = v.entries.filter(e => !e.isDir);
  const total = files.reduce((n, e) => n + e.size, 0);
  return `${formatName(v)} · ${plural(files.length, 'file')} · ${formatBytes(total)}`;
};

function ratioText(compressed: number, total: number): string {
  if (total === 0 || compressed === 0) return '—';
  const saved = 1 - compressed / total;
  return `${(total / compressed).toFixed(1)}:1 (${Math.round(saved * 100)}% smaller)`;
}

export function archiveStats(v: ArchiveValue): StatRow[] {
  const files = v.entries.filter(e => !e.isDir);
  const dirs = v.entries.length - files.length;
  const total = files.reduce((n, e) => n + e.size, 0);
  const byExt = new Map<string, { count: number; bytes: number }>();
  for (const f of files) {
    const ext = extension(f.path);
    const key = ext ? `.${ext}` : '(none)';
    const s = byExt.get(key) ?? { count: 0, bytes: 0 };
    s.count++;
    s.bytes += f.size;
    byExt.set(key, s);
  }
  const largest = [...files].sort((a, b) => b.size - a.size).slice(0, TOP_FILES);
  return [
    { label: 'Format', value: formatName(v) },
    ...(v.unsupported ? [{ label: 'Note', value: v.unsupported }] : []),
    ...(v.note ? [{ label: 'Note', value: v.note }] : []),
    { label: 'Files', value: formatCount(files.length) },
    { label: 'Directories', value: formatCount(dirs) },
    { label: 'Archive size', value: formatBytes(v.archiveBytes) },
    { label: 'Uncompressed size', value: formatBytes(total) },
    { label: 'Compression ratio', value: ratioText(v.archiveBytes, total) },
    ...(largest.length > 0
      ? [
          {
            label: 'Largest files',
            value: '',
            children: largest.map(f => ({ label: f.path, value: formatBytes(f.size) })),
          },
        ]
      : []),
    ...(byExt.size > 0
      ? [
          {
            label: 'File types',
            value: '',
            children: [...byExt]
              .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
              .map(([ext, s]) => ({
                label: ext,
                value: `${plural(s.count, 'file')} · ${formatBytes(s.bytes)}`,
              })),
          },
        ]
      : []),
  ];
}

const parseId = (id: string) =>
  id.startsWith(FORCE_PREFIX)
    ? { path: id.slice(FORCE_PREFIX.length), force: true }
    : { path: id, force: false };

const findFile = (v: ArchiveValue, path: string) => {
  const index = v.entries.findIndex(e => e.path === path && !e.isDir);
  return index < 0 ? null : { index, entry: v.entries[index] };
};

/** Extracts the entry at `index` from zip/tar/gzip sources, after the size/ratio guard. */
export async function extractEntry(
  v: ArchiveValue,
  index: number,
  force: boolean,
  parts: Pick<ArchiveParts, 'extractExternal' | 'decodeSingle'> = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const entry = v.entries[index];
  if (!entry) throw new Error(`No entry ${index}`);
  checkGuard(entry, force);
  const src = v.source;
  switch (src.type) {
    case 'zip': {
      const record = src.records[index];
      if (!record) throw new Error(`No zip record for ${entry.path}`);
      return extractZipEntry(src.bytes, entry, record, force);
    }
    case 'tar': {
      const offset = src.offsets[index];
      if (offset === undefined) throw new Error(`No tar offset for ${entry.path}`);
      return src.bytes.slice(offset, offset + entry.size);
    }
    case 'single':
      if (src.data) return src.data.slice();
      if (v.format === 'gzip' || v.format === 'tar.gz')
        return gunzipCapped(src.bytes, entry.path, force);
      if (parts.decodeSingle) return parts.decodeSingle(v, force);
      throw new Error(`Can't decompress ${entry.path}`);
    case 'external':
      if (!parts.extractExternal) throw new Error(`Can't extract from ${formatName(v)} here`);
      return parts.extractExternal(v, index);
  }
}

/** Builds an `archive` interpreter around format-specific detection, parsing and extraction. */
export function archiveInterpreter(parts: ArchiveParts): Interpreter<ArchiveValue> {
  return {
    kind: 'archive',
    ...(parts.requires ? { requires: parts.requires } : {}),
    isValue: (v): v is ArchiveValue => hasKind(v, 'archive'),
    detect: c => parts.detect(c),
    parse: (c, ctx) => parts.parse(c, ctx),
    label: archiveLabel,
    summarise: v => ({
      stats: archiveStats(v),
      extent: v.entries.length,
      columns: [
        { name: 'path', type: 'string' },
        { name: 'size', type: 'number' },
        { name: 'compressedSize', type: 'number' },
        { name: 'modified', type: 'date' },
      ],
    }),
    slice(v, req) {
      if (req.type === 'rows') {
        return v.entries.slice(req.from, req.to).map(e => ({
          path: e.path,
          size: e.size,
          compressedSize: e.compressedSize ?? null,
          modified: e.modified ?? null,
          isDir: e.isDir,
        }));
      }
      return unsupportedSlice('archive', req);
    },
    export: v => ({ text: v.entries.map(e => e.path).join('\n') }),
    derivations: v =>
      v.entries
        .filter(e => !e.isDir)
        .slice(0, MAX_DERIVATIONS)
        .map(e => ({ id: e.path, label: e.path })),
    canDerive: (v, id) => findFile(v, parseId(id).path) !== null,
    async derive(v, id): Promise<DerivedContent> {
      const { path, force } = parseId(id);
      const found = findFile(v, path);
      if (!found) throw new Error(`No file '${path}' in the archive`);
      const bytes = await extractEntry(v, found.index, force, parts);
      return { mime: guessMime(path), name: basename(path), bytes };
    },
  };
}
