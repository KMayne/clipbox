import { classMajor, isClass, javaVersion } from '../../archive/packages/jar';
import { entryReader } from '../../archive/packages/reader';
import type { ArchiveEntry, ArchiveValue } from '../../archive/types';
import { toCsv } from '../../csv';
import { gridCsv } from '../../csvGrid';
import { isRecord } from '../../guards';
import { loop } from '../../progress';
import {
  archiveClassVersions,
  archiveListing,
  archiveManifest,
  archiveScriptlets,
} from '../catalog/archive';
import { implement } from '../types';
import { textResult } from './util';

/** Core (zip/gzip/tar) and libarchive (7z, RAR…) values share this shape. */
interface ArchiveListingValue {
  kind: 'archive';
  entries: ArchiveEntry[];
  unsupported?: string;
}

const isEntry = (e: unknown): e is ArchiveEntry =>
  isRecord(e) &&
  typeof e.path === 'string' &&
  typeof e.size === 'number' &&
  typeof e.isDir === 'boolean' &&
  (e.compressedSize === undefined || typeof e.compressedSize === 'number') &&
  (e.modified === undefined || typeof e.modified === 'string');

const isArchiveListing = (v: unknown): v is ArchiveListingValue =>
  isRecord(v) && v.kind === 'archive' && Array.isArray(v.entries) && v.entries.every(isEntry);

export function listingCsv(entries: ArchiveEntry[]): string {
  return gridCsv([
    ['path', 'size', 'compressed size', 'modified', 'type'],
    ...entries.map(e => [
      e.path,
      e.isDir ? '' : String(e.size),
      e.compressedSize === undefined || e.isDir ? '' : String(e.compressedSize),
      e.modified ?? '',
      e.isDir ? 'directory' : 'file',
    ]),
  ]);
}

/** Archives with a recognised package (core and libarchive values alike). */
const isPackaged = (
  v: unknown,
): v is ArchiveValue & { package: NonNullable<ArchiveValue['package']> } =>
  isRecord(v) &&
  v.kind === 'archive' &&
  isRecord(v.package) &&
  typeof v.package.type === 'string' &&
  isRecord(v.source) &&
  Array.isArray(v.entries) &&
  v.entries.every(isEntry);

/** "photos.tar.gz" → "photos". */
const stemOf = (name: string | undefined, fallback: string) =>
  (name ?? '').replace(/\.(tar\.\w+|\w+)$/i, '') || fallback;

/** META-INF/versions/11/a/B.class → 11. */
const releaseOf = (path: string) => /^META-INF\/versions\/(\d+)\//.exec(path)?.[1] ?? '';

export const archiveImpls = [
  implement(archiveListing, {
    value: isArchiveListing,
    applies: ({ value }) => !value.unsupported && value.entries.length > 0,
    run({ value, content }) {
      // "photos.tar.gz" → "photos-listing.csv"
      const stem = stemOf(content.name, 'archive');
      return textResult(listingCsv(value.entries), 'text/csv', `${stem}-listing.csv`);
    },
  }),
  implement(archiveManifest, {
    value: isPackaged,
    run: ({ value, content }) =>
      textResult(
        JSON.stringify(value.package, null, 2),
        'application/json',
        `${stemOf(content.name, value.package.type)}-manifest.json`,
      ),
  }),
  implement(archiveClassVersions, {
    value: isPackaged,
    applies: ({ value }) => value.package.type === 'jar' && value.package.classCount > 0,
    async run({ value, content }, _params, ctx) {
      const r = entryReader(value);
      if (!r) throw new Error("Can't read classes from this archive");
      const classes = r.files.filter(isClass);
      const rows: Record<string, unknown>[] = [];
      await loop(classes.length, ctx, 'Reading class headers', i => {
        const path = classes[i] ?? '';
        const header = r.prefix(path, 8);
        const major = classMajor(header);
        rows.push({
          class: path,
          major: major ?? '',
          minor: major === null || !header ? '' : ((header[4] ?? 0) << 8) | (header[5] ?? 0),
          java: major === null ? 'not a class file' : javaVersion(major).replace(/^Java /, ''),
          release: releaseOf(path),
        });
      });
      return textResult(
        toCsv(rows, ['class', 'major', 'minor', 'java', 'release']),
        'text/csv',
        `${stemOf(content.name, 'classes')}-class-versions.csv`,
      );
    },
  }),
  implement(archiveScriptlets, {
    value: isPackaged,
    applies: ({ value }) => value.package.type === 'rpm' && value.package.scripts.length > 0,
    run({ value, content }) {
      const p = value.package;
      const scripts = p.type === 'rpm' ? p.scripts : [];
      const text = scripts
        .map(
          s => `# ${s.name}${s.program ? ` (${s.program})` : ''}\n${s.body.replace(/\n?$/, '\n')}`,
        )
        .join('\n');
      return textResult(text, 'text/plain', `${stemOf(content.name, 'package')}-scriptlets.txt`);
    },
  }),
];
