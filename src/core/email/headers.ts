/**
 * RFC 5322 header fields: unfolding, RFC 2047 encoded words, RFC 2231 parameters, address lists
 * and dates. Pure TS; shared by the email interpreter and its actions.
 */

/** One header field; `value` is unfolded but not decoded. */
export interface Header {
  name: string;
  value: string;
}

/** Most fields read from one header block; the rest are ignored. */
export const MAX_HEADERS = 2000;

/** Each byte as one UTF-16 unit (windows-1252 is single-byte), so offsets match byte offsets. */
const BYTE_VIEW = new TextDecoder('windows-1252');
export const byteString = (bytes: Uint8Array) => BYTE_VIEW.decode(bytes);

/** ISO-8859-1 (each byte its own code point), the fallback for unknown charsets. */
export function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return s;
}

/** The charset's decoding, falling back to latin1 when the charset is unknown. */
export function decodeCharset(bytes: Uint8Array, charset: string | null): string {
  const cs = charset?.trim().replace(/\*.*$/, '').toLowerCase() || null;
  if (cs === null) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return BYTE_VIEW.decode(bytes);
    }
  }
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch {
    return latin1(bytes);
  }
}

/** Header text: UTF-8 (RFC 6532) when it is valid, else windows-1252. */
export const headerText = (bytes: Uint8Array) => decodeCharset(bytes, null);

/**
 * Where the header block ends and the body starts: the first empty line. `bodyStart` is
 * `bytes.length` when there is none (a part with headers only).
 */
export function headerEnd(
  text: string,
  from = 0,
  to = text.length,
): { end: number; bodyStart: number; blank: boolean } {
  // Line by line, so the search never runs past `to` (a part's end) into the rest of the message
  for (let line = from; line < to;) {
    const nl = text.indexOf('\n', line);
    const empty = nl === line || (nl === line + 1 && text[line] === '\r');
    if (nl < 0 || nl >= to) break;
    if (empty) return { end: line, bodyStart: nl + 1, blank: true };
    line = nl + 1;
  }
  return { end: to, bodyStart: to, blank: false };
}

const FIELD = /^([!-9;-~]+)[ \t]*:(.*)$/;

/** Unfolds a header block into fields, keeping their order; lines that aren't fields are skipped. */
export function parseHeaderBlock(block: string): { headers: Header[]; malformed: number } {
  const headers: Header[] = [];
  let malformed = 0;
  for (const line of block.split(/\r?\n/)) {
    if (line === '') continue;
    const last = headers.at(-1);
    if (/^[ \t]/.test(line)) {
      // Folding: the line break goes, the whitespace stays
      if (last) last.value += line;
      else malformed++;
      continue;
    }
    if (headers.length >= MAX_HEADERS) break;
    const m = FIELD.exec(line);
    if (m) headers.push({ name: m[1] ?? '', value: (m[2] ?? '').trim() });
    else malformed++;
  }
  for (const h of headers) h.value = h.value.trim();
  return { headers, malformed };
}

/** The first field called `name` (case-insensitive). */
export const header = (headers: Header[], name: string): string | null =>
  headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

export const headersNamed = (headers: Header[], name: string): string[] =>
  headers.filter(h => h.name.toLowerCase() === name.toLowerCase()).map(h => h.value);

// --- RFC 2047 encoded words ---

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

function decodeQ(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '_') out.push(0x20);
    else if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(s.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

function decodeB(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  try {
    return Uint8Array.from(atob(clean + '='.repeat((4 - (clean.length % 4)) % 4)), ch =>
      ch.charCodeAt(0),
    );
  } catch {
    return new Uint8Array(0);
  }
}

/**
 * Decodes `=?charset?B|Q?…?=` words. Whitespace between adjacent words is dropped, and adjacent
 * words in the same charset are decoded together, so a character split across words survives.
 */
export function decodeWords(s: string): string {
  if (!s.includes('=?')) return s;
  const out: string[] = [];
  // The run of adjacent words being collected: its charset (null when none) and bytes
  let charset: string | null = null;
  let bytes: number[] = [];
  const flush = () => {
    if (charset !== null) out.push(decodeCharset(new Uint8Array(bytes), charset));
    charset = null;
    bytes = [];
  };
  let at = 0;
  for (const m of s.matchAll(ENCODED_WORD)) {
    const between = s.slice(at, m.index);
    if (charset === null || !/^[ \t\r\n]*$/.test(between)) {
      flush();
      out.push(between);
    }
    const cs = (m[1] ?? '').replace(/\*.*$/, '').toLowerCase();
    const decoded = /^[Bb]$/.test(m[2] ?? '') ? decodeB(m[3] ?? '') : decodeQ(m[3] ?? '');
    if (charset !== cs) flush();
    charset = cs;
    for (const b of decoded) bytes.push(b);
    at = m.index + m[0].length;
  }
  flush();
  out.push(s.slice(at));
  return out.join('');
}

// --- Parameters (Content-Type, Content-Disposition), with RFC 2231 ---

export interface ParamValue {
  /** Lower-case, e.g. "text/html" or "attachment". */
  value: string;
  /** Lower-case names; decoded values. */
  params: Record<string, string>;
}

/** Splits on `;` outside quoted strings and comments. */
function splitParams(s: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quoted = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? '';
    if (quoted) {
      cur += c;
      if (c === '\\') cur += s[++i] ?? '';
      else if (c === '"') quoted = false;
    } else if (c === '"') {
      quoted = true;
      cur += c;
    } else if (c === '(') depth++;
    else if (c === ')' && depth > 0) depth--;
    else if (depth > 0) continue;
    else if (c === ';') {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

const unquote = (s: string) =>
  s.startsWith('"') ? s.replace(/^"|"$/g, '').replace(/\\(.)/g, '$1') : s;

function percentBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(s.charCodeAt(i) & 0xff);
  }
  return out;
}

/**
 * `type/subtype; name=value; …` with quoted strings, comments, RFC 2231 extended values
 * (`name*=utf-8''%E2%82%AC`) and continuations (`name*0=…; name*1*=…`), and RFC 2047 words in
 * values (which some mailers put in quoted filenames).
 */
export function parseParams(header: string): ParamValue {
  const [first = '', ...rest] = splitParams(header);
  const plain: Record<string, string> = {};
  const continued = new Map<string, { n: number; text: string; encoded: boolean }[]>();
  for (const part of rest) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const raw = unquote(part.slice(eq + 1).trim());
    const m = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(key);
    if (!m) continue;
    const name = m[1] ?? '';
    if (m[2] === undefined && m[3] === undefined) {
      if (!(name in plain)) plain[name] = raw;
      continue;
    }
    const list = continued.get(name) ?? [];
    if (list.length < 1000) list.push({ n: Number(m[2] ?? 0), text: raw, encoded: m[3] === '*' });
    continued.set(name, list);
  }
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(plain)) params[name] = decodeWords(value);
  for (const [name, list] of continued) {
    list.sort((a, b) => a.n - b.n);
    let charset: string | null = null;
    const bytes: number[] = [];
    for (const [i, seg] of list.entries()) {
      let text = seg.text;
      if (seg.encoded && i === 0) {
        // charset'language'value
        const q = /^([^']*)'[^']*'(.*)$/s.exec(text);
        if (q) {
          charset = q[1] || null;
          text = q[2] ?? '';
        }
      }
      if (seg.encoded) for (const b of percentBytes(text)) bytes.push(b);
      else for (const b of new TextEncoder().encode(text)) bytes.push(b);
    }
    // The extended form wins over a plain fallback of the same name
    params[name] = decodeCharset(new Uint8Array(bytes), charset ?? 'utf-8');
  }
  return { value: first.trim().toLowerCase(), params };
}

// --- Addresses ---

export interface Address {
  /** Display name, decoded; null when there is none. */
  name: string | null;
  /** `local@domain`; null for an empty group such as `undisclosed-recipients:;`. */
  address: string | null;
  /** The group it was listed under, if any. */
  group?: string;
}

type Token =
  { t: 'word'; v: string; quoted: boolean } | { t: 'angle'; v: string } | { t: ',' | ':' | ';' };

function tokenizeAddresses(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i] ?? '';
    if (/\s/.test(c)) i++;
    else if (c === '(') {
      // Comments nest; a counter keeps it flat
      let depth = 0;
      for (; i < s.length; i++) {
        if (s[i] === '\\') i++;
        else if (s[i] === '(') depth++;
        else if (s[i] === ')' && --depth === 0) break;
      }
      i++;
    } else if (c === '"') {
      let v = '';
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\') i++;
        v += s[i] ?? '';
      }
      i++;
      tokens.push({ t: 'word', v, quoted: true });
    } else if (c === '<') {
      const close = s.indexOf('>', i);
      const end = close < 0 ? s.length : close;
      tokens.push({ t: 'angle', v: s.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (c === ',' || c === ':' || c === ';') {
      tokens.push({ t: c });
      i++;
    } else {
      let v = '';
      while (i < s.length && !/[\s(",:;<]/.test(s[i] ?? '')) v += s[i++] ?? '';
      if (v) tokens.push({ t: 'word', v, quoted: false });
      else i++;
    }
  }
  return tokens;
}

/** Strips a source route (`@a,@b:user@host`) left in an angle address. */
const routeless = (a: string) => a.replace(/^(@[^:]*:)/, '');

/**
 * An address list (From, To, Cc…): `Name <a@b>`, bare `a@b`, `a@b (Name)`, quoted names with
 * commas, and groups (`Team: a@b, c@d;`). Display names are RFC 2047-decoded.
 */
export function parseAddressList(s: string): Address[] {
  const out: Address[] = [];
  let group: string | undefined;
  let groupStart = 0;
  let words: { v: string; quoted: boolean }[] = [];
  let angle: string | null = null;
  const comment = /\(([^()]*)\)/.exec(s)?.[1]?.trim() ?? null;
  const finish = () => {
    const text = words.map(w => w.v).join(' ');
    if (angle !== null) {
      const name = decodeWords(text).trim();
      out.push({ name: name || null, address: routeless(angle), ...(group && { group }) });
    } else if (text) {
      // A bare addr-spec; its display name may sit in a trailing comment
      const address = words.map(w => w.v).join('');
      const name = words.length === 1 && comment && address.includes('@') ? comment : null;
      out.push({ name: name && decodeWords(name), address, ...(group && { group }) });
    }
    words = [];
    angle = null;
  };
  for (const tok of tokenizeAddresses(s)) {
    if (tok.t === 'word') words.push(tok);
    else if (tok.t === 'angle') angle = tok.v;
    else if (tok.t === ',') finish();
    else if (tok.t === ':' && group === undefined && angle === null) {
      group = decodeWords(words.map(w => w.v).join(' ')).trim();
      groupStart = out.length;
      words = [];
    } else if (tok.t === ';') {
      finish();
      if (group !== undefined && out.length === groupStart) {
        out.push({ name: null, address: null, group });
      }
      group = undefined;
    } else words.push({ v: tok.t, quoted: false });
  }
  finish();
  if (group !== undefined && out.length === groupStart)
    out.push({ name: null, address: null, group });
  return out;
}

/** `Name <a@b>`, or just the address; empty for an empty group's placeholder. */
export function formatAddress(a: Address): string {
  if (a.address === null) return '';
  if (!a.name) return a.address;
  const name = /[",;:<>@()]/.test(a.name) ? `"${a.name.replace(/(["\\])/g, '\\$1')}"` : a.name;
  return `${name} <${a.address}>`;
}

/** The list as it would be written, groups included: `a@b, Team: c@d, e@f;`. */
export function formatAddresses(list: Address[]): string {
  const out: string[] = [];
  for (let i = 0; i < list.length;) {
    const group = list[i]?.group;
    if (group === undefined) {
      out.push(formatAddress(list[i++] ?? { name: null, address: null }));
      continue;
    }
    const members: string[] = [];
    for (; i < list.length && list[i]?.group === group; i++) {
      const text = formatAddress(list[i] ?? { name: null, address: null });
      if (text) members.push(text);
    }
    out.push(`${group}: ${members.join(', ')};`);
  }
  return out.join(', ');
}

// --- Dates ---

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Obsolete zone names (RFC 5322 §4.3), in minutes east of UTC. Military letters count as 0. */
const ZONES: Record<string, number> = {
  ut: 0,
  utc: 0,
  gmt: 0,
  z: 0,
  est: -300,
  edt: -240,
  cst: -360,
  cdt: -300,
  mst: -420,
  mdt: -360,
  pst: -480,
  pdt: -420,
};

export interface MailDate {
  /** Epoch milliseconds. */
  ms: number;
  /** The sender's offset from UTC, in minutes. */
  offset: number;
}

/**
 * An RFC 5322 date (`Tue, 1 Jul 2003 10:52:37 +0200`), tolerating comments, missing seconds,
 * two-digit years and obsolete zone names. Null when it can't be read.
 */
export function parseMailDate(s: string): MailDate | null {
  const t = s
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*[A-Za-z]{3,}\s*,?\s*/, '')
    .trim();
  const m =
    /^(\d{1,2})[\s-]+([A-Za-z]{3})[A-Za-z]*[\s-]+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([+-]\d{4}|[A-Za-z]{1,5})?/.exec(
      t,
    );
  if (!m) return null;
  const month = MONTHS.indexOf((m[2] ?? '').toLowerCase());
  if (month < 0) return null;
  let year = Number(m[3]);
  if ((m[3] ?? '').length === 2) year += year < 50 ? 2000 : 1900;
  else if ((m[3] ?? '').length === 3) year += 1900;
  const zone = m[7] ?? '+0000';
  let offset: number;
  if (/^[+-]\d{4}$/.test(zone)) {
    const sign = zone.startsWith('-') ? -1 : 1;
    offset = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5)));
  } else offset = ZONES[zone.toLowerCase()] ?? 0;
  const local = Date.UTC(year, month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  const ms = local - offset * 60_000;
  return Number.isFinite(ms) ? { ms, offset } : null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** "2003-07-01 10:52:37 +02:00", in the sender's own offset. */
export function formatMailDate(d: MailDate): string {
  const local = new Date(d.ms + d.offset * 60_000);
  const sign = d.offset < 0 ? '-' : '+';
  const abs = Math.abs(d.offset);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ` +
    `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())} ` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
