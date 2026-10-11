import { z } from 'zod';
import type { NewEntry } from '../state/captureStore';
import type { ShareCacheName, ShareHeaders, ShareParam, SharePath } from '../swProtocol';

/*
 * The page's half of the share target (the service worker stashes, see swProtocol.ts). Pure: no
 * store, so unit tests can use it without starting the engine worker.
 */

export const SHARE_CACHE: ShareCacheName = 'clipbox-share';
export const SHARE_PATH: SharePath = '__clipbox/share/';
export const SHARE_PARAM: ShareParam = 'share';
const SHARE_HEADERS: ShareHeaders = { field: 'x-clipbox-field', filename: 'x-clipbox-filename' };

/** One field of a shared form: `title`, `text` or `url` (text), or a file. */
export interface SharedPart {
  field: string;
  mime: string;
  blob: Blob;
  /** Set for files. */
  filename?: string;
}

const KEY = new RegExp(`/${SHARE_PATH.replace(/\//g, '\\/')}([\\w-]+)/(\\d+)$`);

/** The share id and part index in a stashed part's URL, or null if it isn't one. */
export function shareKey(url: string): { id: string; index: number } | null {
  const m = KEY.exec(new URL(url).pathname);
  return m?.[1] && m[2] ? { id: m[1], index: Number(m[2]) } : null;
}

const headersSchema = z.object({
  field: z.string().min(1),
  filename: z.string().nullable(),
  mime: z.string().nullable(),
});

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Reads a stashed part back (Cache Storage is a trust boundary), or null if it's malformed. */
export async function partFromResponse(res: Response): Promise<SharedPart | null> {
  const headers = headersSchema.safeParse({
    field: res.headers.get(SHARE_HEADERS.field),
    filename: res.headers.get(SHARE_HEADERS.filename),
    mime: res.headers.get('content-type'),
  });
  if (!headers.success) return null;
  const { field, filename, mime } = headers.data;
  const blob = await res.blob();
  return {
    field,
    mime: mime || 'application/octet-stream',
    blob,
    ...(filename !== null && { filename: decode(filename) }),
  };
}

const textEntry = (text: string): NewEntry => {
  const blob = new Blob([text], { type: 'text/plain' });
  return { mime: 'text/plain', size: blob.size, blob };
};

/**
 * A share's capture entries: its text, then its URL unless the text already contains it (Android
 * usually puts a shared page's URL in `text`), then each file. The title is only used when
 * nothing else was shared.
 */
export async function shareEntries(parts: SharedPart[]): Promise<NewEntry[]> {
  const field = async (name: string) => {
    const part = parts.find(p => p.field === name && p.filename === undefined);
    return part ? (await part.blob.text()).trim() : '';
  };
  const [title, text, url] = await Promise.all([field('title'), field('text'), field('url')]);
  const files = parts.filter(p => p.filename !== undefined);
  const entries: NewEntry[] = [];
  if (text) entries.push(textEntry(text));
  if (url && !text.includes(url)) entries.push(textEntry(url));
  for (const f of files) {
    entries.push({ mime: f.mime, size: f.blob.size, blob: f.blob, name: f.filename });
  }
  if (entries.length === 0 && title) entries.push(textEntry(title));
  return entries;
}
