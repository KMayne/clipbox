import { gridCsv } from '../../csvGrid';
import { isRecord } from '../../guards';
import type { ArchiveEntry } from '../../archive/types';
import { archiveListing } from '../catalog/archive';
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

export const archiveImpls = [
  implement(archiveListing, {
    value: isArchiveListing,
    applies: ({ value }) => !value.unsupported && value.entries.length > 0,
    run({ value, content }) {
      // "photos.tar.gz" → "photos-listing.csv"
      const stem = (content.name ?? '').replace(/\.(tar\.\w+|\w+)$/i, '') || 'archive';
      return textResult(listingCsv(value.entries), 'text/csv', `${stem}-listing.csv`);
    },
  }),
];
