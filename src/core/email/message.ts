/**
 * An email message: detection, the parsed value (headers, body choice, attachments, trace) and
 * the outputs built from it (rendered HTML, body text, headers as JSON).
 */

import { extensionForMime } from '../filenames';
import { toBase64 } from '../format';
import { htmlToMarkdown, htmlToText } from '../html/convert';
import { parseHtml, serialize, walk } from '../html/dom';
import { sanitiseTree } from '../html/extract';
import { detectMagic, MAGIC_MIME } from '../magic';
import { authResults, authSummary, authText } from './auth';
import {
  byteString,
  decodeWords,
  formatAddresses,
  formatMailDate,
  header,
  headerEnd,
  headerText,
  parseAddressList,
  parseHeaderBlock,
  parseMailDate,
  type Header,
} from './headers';
import { parseMime, partText, type MimePart } from './mime';
import { receivedChain } from './received';
import type { EmailAttachment, EmailLayout, EmailValue } from './types';

// --- Detection ---

/** Header bytes read for detection; a message whose headers run longer isn't recognised. */
const DETECT_BYTES = 256 * 1024;
/** Besides From, at least one of these marks a message (rather than, say, YAML). */
const MESSAGE_FIELDS = ['date', 'subject', 'message-id', 'mime-version', 'received'];

/**
 * Where the header block starts: after a UTF-8 byte order mark and an mbox-style
 * "From sender date" line, which some mailers put before the headers.
 */
function messageStart(bytes: Uint8Array): number {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const mbox = /^From [^\r\n]*\r?\n/.exec(byteString(bytes.subarray(bom, bom + 1024)));
  return bom + (mbox?.[0].length ?? 0);
}

/**
 * Whether the bytes start with an RFC 5322 header block: only `Name: value` fields (and folded
 * lines) up to a blank line. `strict` also needs a From address plus a Date, Subject, Message-ID,
 * MIME-Version or Received field; without it (for a file named .eml), any of those fields will do.
 */
export function looksLikeEmail(bytes: Uint8Array, strict: boolean): boolean {
  const start = messageStart(bytes);
  const text = byteString(bytes.subarray(start, start + DETECT_BYTES));
  if (!/^[!-9;-~]+[ \t]*:/.test(text)) return false;
  const h = headerEnd(text);
  if (!h.blank) return false;
  const { headers, malformed } = parseHeaderBlock(text.slice(0, h.end));
  if (malformed > 0 || headers.length < 2) return false;
  const names = new Set(headers.map(x => x.name.toLowerCase()));
  const marked = MESSAGE_FIELDS.some(f => names.has(f));
  if (!strict) return marked || names.has('from');
  return marked && /@/.test(header(headers, 'from') ?? '');
}

// --- Parsing ---

const isLeaf = (p: MimePart) => p.children.length === 0;
const isBodyCandidate = (p: MimePart, type: string) =>
  p.type === type && p.disposition !== 'attachment' && p.filename === null;

function subjectOf(bytes: Uint8Array): string | null {
  const text = byteString(bytes.subarray(0, DETECT_BYTES));
  const { headers } = parseHeaderBlock(headerText(bytes.subarray(0, headerEnd(text).end)));
  const s = header(headers, 'subject');
  return s === null ? null : decodeWords(s).trim() || null;
}

function attachmentName(p: MimePart): string {
  if (p.filename) return p.filename;
  if (p.type === 'message/rfc822') {
    const subject = subjectOf(p.bytes)?.slice(0, 80);
    return `${subject ?? `message-${p.index}`}.eml`;
  }
  return `part-${p.index}.${extensionForMime(p.type)}`;
}

function attachmentMime(p: MimePart): string {
  if (p.type !== 'application/octet-stream') return p.type;
  const magic = detectMagic(p.bytes);
  return magic ? MAGIC_MIME[magic] : p.type;
}

/** Content-IDs the HTML references as `cid:` URLs, lower-cased. */
function referencedCids(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/cid:([^"'\s)>]+)/gi)) {
    out.add(safeDecode(m[1] ?? '').toLowerCase());
  }
  return out;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const addresses = (headers: Header[], name: string) => {
  const v = header(headers, name);
  return v === null ? [] : parseAddressList(v);
};

export function parseEmail(input: Uint8Array<ArrayBuffer>): EmailValue {
  const start = messageStart(input);
  const bytes = start > 0 ? input.slice(start) : input;
  const { parts, warnings } = parseMime(bytes);
  const root = parts[0];
  if (!root) throw new Error('Not an email message');
  const headers = root.headers;
  const leaves = parts.filter(isLeaf);
  const htmlPart = leaves.find(p => isBodyCandidate(p, 'text/html'))?.index ?? null;
  const textPart = leaves.find(p => isBodyCandidate(p, 'text/plain'))?.index ?? null;
  const html = htmlPart === null ? '' : partText(parts[htmlPart] ?? root);
  const cids = referencedCids(html);
  const attachments: EmailAttachment[] = leaves
    // An empty multipart isn't a file; one nested too deep (kept whole) is
    .filter(p => p.index !== htmlPart && p.index !== textPart)
    .filter(p => !p.type.startsWith('multipart/') || p.bytes.length > 0)
    .map(p => ({
      part: p.index,
      name: attachmentName(p),
      mime: attachmentMime(p),
      size: p.bytes.length,
      contentId: p.contentId,
      inline: p.contentId !== null && cids.has(p.contentId.toLowerCase()),
    }));
  const subject = header(headers, 'subject');
  const dateRaw = header(headers, 'date');
  return {
    kind: 'email',
    size: input.byteLength,
    headers,
    subject: subject === null ? null : decodeWords(subject).trim(),
    from: addresses(headers, 'from'),
    to: addresses(headers, 'to'),
    cc: addresses(headers, 'cc'),
    bcc: addresses(headers, 'bcc'),
    replyTo: addresses(headers, 'reply-to'),
    date: dateRaw === null ? null : parseMailDate(dateRaw),
    dateRaw,
    messageId: header(headers, 'message-id')?.replace(/^\s*<|>\s*$/g, '') ?? null,
    parts,
    htmlPart,
    textPart,
    attachments,
    auth: authResults(headers),
    received: receivedChain(headers),
    warnings,
  };
}

// --- Outputs ---

/** The bytes of attachment `index`. */
export function attachmentBytes(v: EmailValue, index: number): Uint8Array<ArrayBuffer> {
  const a = v.attachments[index];
  const part = a && v.parts[a.part];
  if (!part) throw new Error(`No attachment ${index}`);
  return part.bytes;
}

/** Images a sanitised page may embed as data URLs (see `sanitiseTree`). */
const DATA_IMAGE = /^image\/(png|gif|jpeg|webp|avif|bmp)$/;
const REMOTE = /^\s*(https?:|\/\/)/i;

const rendered = new WeakMap<EmailValue, { html: string; blocked: number }>();

/**
 * The HTML body made safe to show: `cid:` images become data URLs of their inline parts, remote
 * images are left out (and counted), then the usual sanitiser (no scripts, styles or handlers).
 */
export function renderedHtml(v: EmailValue): { html: string; blocked: number } {
  const hit = rendered.get(v);
  if (hit) return hit;
  const part = v.htmlPart === null ? undefined : v.parts[v.htmlPart];
  if (!part) return { html: '', blocked: 0 };
  const byCid = new Map<string, EmailAttachment>();
  for (const a of v.attachments) if (a.contentId) byCid.set(a.contentId.toLowerCase(), a);
  const tree = parseHtml(partText(part));
  let blocked = 0;
  for (const el of walk(tree)) {
    if (el.name !== 'img') continue;
    const src = el.attrs.src ?? '';
    const cid = /^\s*cid:(.+)$/i.exec(src)?.[1];
    if (cid !== undefined) {
      const a = byCid.get(safeDecode(cid.trim()).toLowerCase());
      const bytes = a && v.parts[a.part]?.bytes;
      if (a && bytes && DATA_IMAGE.test(a.mime)) {
        el.attrs.src = `data:${a.mime};base64,${toBase64(bytes)}`;
      } else delete el.attrs.src;
    } else if (REMOTE.test(src)) {
      delete el.attrs.src;
      blocked++;
    }
    if (el.attrs.srcset && /(https?:|\/\/)/i.test(el.attrs.srcset)) {
      delete el.attrs.srcset;
      if (!REMOTE.test(src)) blocked++;
    }
  }
  const out = { html: serialize(sanitiseTree(tree)), blocked };
  rendered.set(v, out);
  return out;
}

/** The body as plain text: the text part, else the HTML part converted. */
export function bodyText(v: EmailValue): string {
  const text = v.textPart === null ? undefined : v.parts[v.textPart];
  if (text) return partText(text);
  const html = v.htmlPart === null ? undefined : v.parts[v.htmlPart];
  return html ? htmlToText(partText(html), true) : '';
}

/** The body as Markdown: the HTML part converted, else the text part as it is. */
export function bodyMarkdown(v: EmailValue): string {
  const html = v.htmlPart === null ? undefined : v.parts[v.htmlPart];
  if (html) return htmlToMarkdown(partText(html));
  return bodyText(v);
}

/** Every header in order, with encoded words decoded. */
export const headersJson = (v: EmailValue) =>
  v.headers.map(h => ({ name: h.name, value: decodeWords(h.value) }));

export const dateText = (v: EmailValue) => (v.date ? formatMailDate(v.date) : v.dateRaw);

export function emailLayout(v: EmailValue): EmailLayout {
  const summary = authSummary(v.auth);
  return {
    subject: v.subject,
    from: formatAddresses(v.from),
    to: formatAddresses(v.to),
    cc: formatAddresses(v.cc),
    replyTo: formatAddresses(v.replyTo),
    date: dateText(v),
    body: v.htmlPart !== null ? 'html' : v.textPart !== null ? 'text' : 'none',
    blockedImages: v.htmlPart !== null ? renderedHtml(v).blocked : 0,
    attachments: v.attachments.map(({ name, mime, size, inline }) => ({
      name,
      mime,
      size,
      inline,
    })),
    auth: (['spf', 'dkim', 'dmarc'] as const).flatMap(m => {
      const r = summary[m];
      return r ? [{ method: m, result: r.result, text: authText(r) }] : [];
    }),
  };
}
