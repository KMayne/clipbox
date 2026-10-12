/** File names for saving entries to disk ("Download", "Download all"). Pure, no DOM. */

/** Preferred extension per MIME type (parameters such as `;charset=` are ignored). */
const EXTENSIONS: Record<string, string> = {
  'text/plain': 'txt',
  'text/html': 'html',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'text/markdown': 'md',
  'text/css': 'css',
  'text/javascript': 'js',
  'text/xml': 'xml',
  'text/yaml': 'yaml',
  'text/uri-list': 'txt',
  'message/rfc822': 'eml',
  'application/json': 'json',
  'application/geo+json': 'geojson',
  'application/x-ndjson': 'ndjson',
  'application/xml': 'xml',
  'application/yaml': 'yaml',
  'application/x-yaml': 'yaml',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/gzip': 'gz',
  'application/x-gzip': 'gz',
  'application/x-tar': 'tar',
  'application/x-7z-compressed': '7z',
  'application/vnd.rar': 'rar',
  'application/x-xz': 'xz',
  'application/x-bzip2': 'bz2',
  'application/zstd': 'zst',
  'application/wasm': 'wasm',
  'application/x-msdownload': 'exe',
  'application/vnd.microsoft.portable-executable': 'exe',
  'application/x-pem-file': 'pem',
  'application/x-x509-ca-cert': 'crt',
  'application/vnd.sqlite3': 'sqlite',
  'application/x-sqlite3': 'sqlite',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/x-emf': 'emf',
  'image/emf': 'emf',
  'image/x-wmf': 'wmf',
  'image/wmf': 'wmf',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/webm': 'weba',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/ogg': 'ogv',
};

/** Fallback when a MIME type is unknown: a few suffix conventions, else `bin`. */
export function extensionForMime(mime: string): string {
  const type = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  const known = EXTENSIONS[type];
  if (known) return known;
  if (type.endsWith('+json')) return 'json';
  if (type.endsWith('+xml')) return 'xml';
  if (type.endsWith('+zip')) return 'zip';
  if (type.startsWith('text/')) return 'txt';
  return 'bin';
}

/** Characters Windows, macOS or Linux reject in a name, plus control characters. */
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[/\\:*?"<>|\u0000-\u001f\u007f]/g;
/** Device names Windows won't create, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
const MAX_LENGTH = 180;

/** A name safe to create in any directory: no separators, no trailing dots, not reserved. */
export function sanitiseFileName(name: string): string {
  let s = name
    .replace(ILLEGAL, '_')
    .trim()
    .replace(/[. ]+$/, '');
  if (/^\.+$/.test(s)) s = '';
  if (RESERVED.test(s)) s = `_${s}`;
  if (s.length > MAX_LENGTH) {
    const { stem, ext } = splitName(s);
    s = ext ? `${stem.slice(0, MAX_LENGTH - ext.length - 1)}.${ext}` : s.slice(0, MAX_LENGTH);
  }
  return s;
}

/** "photo.final.png" → { stem: "photo.final", ext: "png" }; dotfiles have no extension. */
export function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot + 1) } : { stem: name, ext: '' };
}

/** Kind word for generated names: the interpretation's kind if known, else the MIME's top level. */
function kindWord(mime: string, kind?: string): string {
  const top = mime.split('/')[0]?.toLowerCase() ?? '';
  const word = kind ?? (['image', 'audio', 'video', 'text'].includes(top) ? top : 'file');
  return sanitiseFileName(word) || 'file';
}

export interface NamingEntry {
  name?: string;
  mime: string;
  /** The entry's best interpretation, for generated names ("image-3.png"). */
  kind?: string;
}

/**
 * The file name for one entry, before de-duplication: its own name (only the last path segment,
 * sanitised, with an extension added from its MIME type if it has none), else `<kind>-<n>.<ext>`.
 * `n` is 1-based.
 */
export function baseFileName(entry: NamingEntry, n: number): string {
  const ext = extensionForMime(entry.mime);
  const own = sanitiseFileName(entry.name?.split(/[/\\]/).pop() ?? '');
  if (own) return splitName(own).ext || ext === 'bin' ? own : `${own}.${ext}`;
  return `${kindWord(entry.mime, entry.kind)}-${n}.${ext}`;
}

/**
 * Names for every entry, unique case-insensitively (as on Windows and macOS) among themselves and
 * against `taken` (e.g. files already in the folder): clashes become "name (2).ext", "name (3).ext"…
 */
export function uniqueFileNames(entries: NamingEntry[], taken: Iterable<string> = []): string[] {
  const used = new Set([...taken].map(n => n.toLowerCase()));
  return entries.map((entry, i) => {
    const base = baseFileName(entry, i + 1);
    let name = base;
    const { stem, ext } = splitName(base);
    for (let k = 2; used.has(name.toLowerCase()); k++)
      name = ext ? `${stem} (${k}).${ext}` : `${stem} (${k})`;
    used.add(name.toLowerCase());
    return name;
  });
}
