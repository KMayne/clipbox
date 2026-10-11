import { createMemo, type EntryContent } from '../../core/content';
import type { Detector } from '../types';

export type SheetFormat = 'xlsx' | 'xlsm' | 'xlsb' | 'ods' | 'xls';

const MAX_ZIP_ENTRIES = 20_000;
const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet';
const CFB_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return s;
};

interface ZipEntry {
  name: string;
  /** Compression method: 0 = stored. */
  method: number;
  size: number;
  /** Offset of the local file header. */
  offset: number;
}

/** Entries from a zip's central directory, without decompressing anything; null if unreadable. */
export function zipEntries(b: Uint8Array): ZipEntry[] | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // The end-of-central-directory record is 22 bytes plus a comment of up to 64 KB
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let at = dv.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < Math.min(count, MAX_ZIP_ENTRIES); n++) {
    if (at + 46 > b.length || dv.getUint32(at, true) !== CENTRAL_SIG) return null;
    const nameLen = dv.getUint16(at + 28, true);
    const extraLen = dv.getUint16(at + 30, true);
    const commentLen = dv.getUint16(at + 32, true);
    entries.push({
      name: latin1(b.subarray(at + 46, at + 46 + nameLen)),
      method: dv.getUint16(at + 10, true),
      size: dv.getUint32(at + 20, true),
      offset: dv.getUint32(at + 42, true),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Contents of a small stored (uncompressed) entry, e.g. an ODF `mimetype`; null otherwise. */
function storedText(b: Uint8Array, e: ZipEntry): string | null {
  if (e.method !== 0 || e.size > 256 || e.offset + 30 > b.length) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const data =
    e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  return latin1(b.subarray(data, data + e.size));
}

/** Whether a CFB (OLE2) file has a "Workbook" or "Book" stream, by scanning directory entries. */
export function cfbHasWorkbook(b: Uint8Array): boolean {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // Directory entries are 128 bytes and start on sector boundaries (≥ 512 bytes), after the header
  for (let at = 512; at + 128 <= b.length; at += 128) {
    const nameLen = dv.getUint16(at + 64, true);
    if ((nameLen !== 18 && nameLen !== 10) || b[at + 66] !== 2) continue;
    let name = '';
    for (let i = 0; i < nameLen / 2 - 1; i++)
      name += String.fromCharCode(dv.getUint16(at + i * 2, true));
    if (name === 'Workbook' || name === 'Book') return true;
  }
  return false;
}

interface Detected {
  format: SheetFormat;
  confidence: number;
}

const detectSheet = createMemo((c: EntryContent): Detected | null => {
  const b = c.bytes;
  if (c.magic === 'zip') {
    const entries = zipEntries(b);
    if (!entries) return null;
    const names = entries.map(e => e.name);
    const zipped = (format: SheetFormat) => ({ format, confidence: 0.95 });
    if (names.includes('xl/workbook.bin')) return zipped('xlsb');
    if (names.includes('xl/workbook.xml')) {
      const macros = names.includes('xl/vbaProject.bin') || /\.xlsm$/i.test(c.name ?? '');
      return zipped(macros ? 'xlsm' : 'xlsx');
    }
    // ODF puts `mimetype` first by convention, but not every writer does (SheetJS doesn't)
    const mimetype = entries.find(e => e.name === 'mimetype');
    const ods =
      names.includes('content.xml') &&
      mimetype !== undefined &&
      storedText(b, mimetype)?.startsWith(ODS_MIME) === true;
    return ods ? zipped('ods') : null;
  }
  if (b.length >= 512 && CFB_SIG.every((v, i) => b[i] === v)) {
    // Other OLE2 files (.doc, .msg) share the signature: a Workbook stream tells them apart
    if (cfbHasWorkbook(b)) return { format: 'xls', confidence: 0.95 };
    return /\.xls$/i.test(c.name ?? '') ? { format: 'xls', confidence: 0.7 } : null;
  }
  return null;
});

/** The spreadsheet format of the content, or null. */
export const sheetFormat = (c: EntryContent): SheetFormat | null => detectSheet(c)?.format ?? null;

/** Cheap core-side detector; parsing lives in the lazily-loaded worker half. */
export const spreadsheetDetector: Detector = {
  kind: 'spreadsheet',
  module: 'sheets',
  detect: c => detectSheet(c)?.confidence ?? 0,
};
