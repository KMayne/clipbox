import { archiveInterpreter } from '../archive/interpreter';
import { gunzipCapped, gunzippedName, parseGzipHeader, type GzipHeader } from '../archive/gzip';
import { crxExtensionId, parseCrxHeader, type CrxHeader } from '../archive/packages/crx';
import { recognisePackage } from '../archive/packages';
import { parseRpm } from '../archive/rpm';
import { LIBARCHIVE_RPM_COMPRESSORS, rpmPayloadCompressor } from '../archive/rpmHeader';
import { isTar, tarValue } from '../archive/tar';
import { ExtractionGuardError, type ArchiveValue } from '../archive/types';
import { hasZipSignature, listZip, type ZipListing } from '../archive/zip';
import { createMemo, type EntryContent } from '../content';

const CONFIDENCE = 0.8;
/** Office documents (docx/xlsx/pptx) are zips too; let format-specific kinds outrank them. */
const OFFICE_CONFIDENCE = 0.5;

/** The zip central directory, memoised per content; null for non-zips. */
export const zipListing = createMemo((c): ZipListing | null => {
  if (!hasZipSignature(c.bytes)) return null;
  try {
    return listZip(c.bytes);
  } catch {
    return null;
  }
});

const gzipHeader = createMemo((c): GzipHeader | null => parseGzipHeader(c.bytes));

/** A CRX header and the zip behind it; null unless both parse. */
const crx = createMemo((c): { header: CrxHeader; zip: ZipListing } | null => {
  const header = parseCrxHeader(c.bytes);
  if (!header) return null;
  try {
    return { header, zip: listZip(c.bytes.subarray(header.zipOffset)) };
  } catch {
    return null;
  }
});

/** RPMs whose payload core can read (gzip, none, or a compressor nobody handles). */
const coreRpm = createMemo((c): boolean => {
  const compressor = rpmPayloadCompressor(c.bytes);
  return compressor !== null && !LIBARCHIVE_RPM_COMPRESSORS.has(compressor);
});

function rpmValue(c: EntryContent): ArchiveValue {
  const { info, entries, names, payloadOffset } = parseRpm(c.bytes);
  const compressor = info.payloadCompressor;
  const readable = compressor === 'gzip' || compressor === 'none' || compressor === '';
  return {
    kind: 'archive',
    format: 'rpm',
    archiveBytes: c.size,
    entries,
    source: {
      type: 'cpio',
      bytes: c.bytes,
      payloadOffset,
      compressor,
      names,
    },
    package: info,
    ...(readable
      ? {}
      : { note: `Files can't be extracted: unknown payload compressor ${compressor}` }),
  };
}

async function crxValue(
  c: EntryContent,
  header: CrxHeader,
  zip: ZipListing,
): Promise<ArchiveValue> {
  const v: ArchiveValue = {
    kind: 'archive',
    format: 'crx',
    archiveBytes: c.size,
    entries: zip.entries,
    source: { type: 'zip', bytes: c.bytes.subarray(header.zipOffset), records: zip.records },
  };
  let id: string | null = null;
  try {
    id = (await crxExtensionId(header)).id;
  } catch {
    // No ID (WebCrypto unavailable or a malformed key); the listing still works
  }
  const pkg = recognisePackage(v, { name: c.name, crx: { version: header.version, id } });
  return pkg ? { ...v, package: pkg } : v;
}

const withPackage = (v: ArchiveValue, c: EntryContent): ArchiveValue => {
  const pkg = recognisePackage(v, { name: c.name });
  return pkg ? { ...v, package: pkg } : v;
};

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

/**
 * Zip (and CRX), gzip (including .tar.gz), tar and RPMs with gzip payloads, with any package
 * manifest inside recognised. Other formats live in the libarchive module.
 */
export const archiveCoreInterpreter = archiveInterpreter({
  detect(c) {
    const zip = zipListing(c);
    if (zip) {
      return zip.entries.some(e => e.path === '[Content_Types].xml')
        ? OFFICE_CONFIDENCE
        : CONFIDENCE;
    }
    if (crx(c) || coreRpm(c)) return CONFIDENCE;
    if (gzipHeader(c)) return CONFIDENCE;
    return isTar(c.bytes) ? CONFIDENCE : 0;
  },
  parse(c) {
    const zip = zipListing(c);
    if (zip) {
      return withPackage(
        {
          kind: 'archive',
          format: 'zip',
          archiveBytes: c.size,
          entries: zip.entries,
          source: { type: 'zip', bytes: c.bytes, records: zip.records },
        },
        c,
      );
    }
    const crxParts = crx(c);
    if (crxParts) return crxValue(c, crxParts.header, crxParts.zip);
    if (coreRpm(c)) return rpmValue(c);
    const header = gzipHeader(c);
    if (header) return withPackage(gzipValue(c, header), c);
    if (isTar(c.bytes)) return withPackage(tarValue(c.bytes, 'tar', c.size), c);
    throw new Error('Not an archive');
  },
});
