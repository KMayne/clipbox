import { archiveInterpreter } from '../archive/interpreter';
import { gunzipCapped, gunzippedName, parseGzipHeader, type GzipHeader } from '../archive/gzip';
import { isTar, tarValue } from '../archive/tar';
import { ExtractionGuardError, type ArchiveValue } from '../archive/types';
import { hasZipSignature, listZip, type ZipListing } from '../archive/zip';
import { createMemo, type EntryContent } from '../content';

const CONFIDENCE = 0.8;
/** Office documents (docx/xlsx/pptx) are zips too; let format-specific kinds outrank them. */
const OFFICE_CONFIDENCE = 0.5;

const zipListing = createMemo((c): ZipListing | null => {
  if (!hasZipSignature(c.bytes)) return null;
  try {
    return listZip(c.bytes);
  } catch {
    return null;
  }
});

const gzipHeader = createMemo((c): GzipHeader | null => parseGzipHeader(c.bytes));

function gzipValue(c: EntryContent, header: GzipHeader): ArchiveValue {
  const name = gunzippedName(header, c.name);
  let data: Uint8Array<ArrayBuffer> | null = null;
  let note: string | undefined;
  try {
    data = gunzipCapped(c.bytes, name, false);
  } catch (err) {
    if (!(err instanceof ExtractionGuardError)) throw err;
    note = 'Too large to decompress up front; opening the file asks for confirmation';
  }
  if (data && isTar(data)) return tarValue(data, 'tar.gz', c.size);
  return {
    kind: 'archive',
    format: 'gzip',
    archiveBytes: c.size,
    entries: [
      {
        path: name,
        size: data ? data.byteLength : header.declaredSize,
        compressedSize: c.size,
        ...(header.modified ? { modified: header.modified } : {}),
        isDir: false,
      },
    ],
    source: { type: 'single', bytes: c.bytes, data },
    ...(note ? { note } : {}),
  };
}

/** Zip, gzip (including .tar.gz) and tar. Other formats live in the libarchive module. */
export const archiveCoreInterpreter = archiveInterpreter({
  detect(c) {
    const zip = zipListing(c);
    if (zip) {
      return zip.entries.some(e => e.path === '[Content_Types].xml')
        ? OFFICE_CONFIDENCE
        : CONFIDENCE;
    }
    if (gzipHeader(c)) return CONFIDENCE;
    return isTar(c.bytes) ? CONFIDENCE : 0;
  },
  parse(c) {
    const zip = zipListing(c);
    if (zip) {
      return {
        kind: 'archive',
        format: 'zip',
        archiveBytes: c.size,
        entries: zip.entries,
        source: { type: 'zip', bytes: c.bytes, records: zip.records },
      };
    }
    const header = gzipHeader(c);
    if (header) return gzipValue(c, header);
    if (isTar(c.bytes)) return tarValue(c.bytes, 'tar', c.size);
    throw new Error('Not an archive');
  },
});
