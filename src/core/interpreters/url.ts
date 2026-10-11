import { createMemo } from '../content';
import { formatCount } from '../format';
import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import type { CardData, CardRow } from '../smallValue';
import type { StatRow } from '../types';
import { addRecordsSource, type RecordsValue } from './records';

export interface ParsedUrl {
  href: string;
  scheme: string;
  host: string;
  /** Explicit port, or '' when the scheme default applies. */
  port: string;
  path: string;
  /** Decoded path segments. */
  segments: string[];
  /** Decoded query parameters, in order (keys may repeat). */
  query: [string, string][];
  /** Raw query string including '?', or ''. */
  search: string;
  /** Without the '#'. */
  fragment: string;
  username: string;
  hasPassword: boolean;
}

interface UrlValue {
  kind: 'url';
  urls: ParsedUrl[];
}

/** Long query strings are common, so a single URL may exceed the usual 200-char limit. */
const MAX_URL = 8192;
const MAX_LINES = 10_000;
const ABSOLUTE = /^[a-z][a-z\d+.-]*:\/\/[^\s]+$/i;
const DEFAULT_PORTS: Record<string, string> = {
  http: '80',
  https: '443',
  ws: '80',
  wss: '443',
  ftp: '21',
};

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Parses an absolute URL (`scheme://…`), or returns null. */
export function parseUrl(s: string): ParsedUrl | null {
  if (s.length > MAX_URL || !ABSOLUTE.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  return {
    href: u.href,
    scheme: u.protocol.replace(/:$/, ''),
    host: u.hostname,
    port: u.port,
    path: u.pathname,
    segments: u.pathname.split('/').filter(Boolean).map(safeDecode),
    query: [...u.searchParams],
    search: u.search,
    fragment: safeDecode(u.hash.replace(/^#/, '')),
    username: safeDecode(u.username),
    hasPassword: u.password !== '',
  };
}

/** Every non-blank line is an absolute URL (one or more lines); null otherwise. */
export const urlsOf = createMemo((c): ParsedUrl[] | null => {
  if (c.text === null || c.size > MAX_URL * MAX_LINES) return null;
  const lines = c.text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > MAX_LINES) return null;
  const urls: ParsedUrl[] = [];
  for (const line of lines) {
    const u = parseUrl(line);
    if (!u) return null;
    urls.push(u);
  }
  return urls;
});

const queryOf = (u: ParsedUrl) => u.search.replace(/^\?/, '');

/** Records view: a single URL's query params, or one row per URL. */
export function urlRecords(urls: ParsedUrl[]): RecordsValue | null {
  const [only] = urls;
  if (urls.length === 1 && only) {
    if (only.query.length === 0) return null;
    return {
      kind: 'records',
      columns: ['key', 'value'],
      rows: only.query.map(([key, value]) => ({ key, value })),
      delimiter: null,
      hasHeader: true,
      source: 'URL query',
    };
  }
  return {
    kind: 'records',
    columns: ['url', 'host', 'path', 'query'],
    rows: urls.map(u => ({ url: u.href, host: u.host, path: u.path, query: queryOf(u) })),
    delimiter: null,
    hasHeader: true,
    source: 'URL list',
  };
}

const recordsMemo = createMemo(c => {
  const urls = urlsOf(c);
  return urls ? urlRecords(urls) : null;
});

addRecordsSource({
  detect: c => (recordsMemo(c) ? (urlsOf(c)?.length === 1 ? 0.5 : 0.6) : 0),
  parse(c) {
    const r = recordsMemo(c);
    if (!r) throw new Error('No URL records');
    return r;
  },
});

function portText(u: ParsedUrl): string {
  if (u.port) return u.port;
  const d = DEFAULT_PORTS[u.scheme];
  return d ? `${d} (default)` : 'none';
}

function singleStats(u: ParsedUrl): StatRow[] {
  const stats: StatRow[] = [
    { label: 'Scheme', value: u.scheme },
    { label: 'Host', value: u.host || '(none)' },
    { label: 'Port', value: portText(u) },
    {
      label: 'Path',
      value: u.path,
      children: u.segments.map((s, i) => ({ label: String(i + 1), value: s })),
    },
    {
      label: 'Query params',
      value: formatCount(u.query.length),
      children: u.query.map(([k, v]) => ({ label: k, value: v })),
    },
    { label: 'Fragment', value: u.fragment || '(none)' },
  ];
  if (u.username) stats.push({ label: 'Username', value: u.username });
  if (u.hasPassword) stats.push({ label: 'Password', value: 'present (hidden)' });
  return stats;
}

function multiStats(urls: ParsedUrl[]): StatRow[] {
  const count = (key: (u: ParsedUrl) => string) => {
    const m = new Map<string, number>();
    for (const u of urls) m.set(key(u), (m.get(key(u)) ?? 0) + 1);
    return [...m]
      .sort((a, b) => b[1] - a[1])
      .map(([label, n]) => ({ label: label || '(none)', value: formatCount(n) }));
  };
  const hosts = count(u => u.host);
  return [
    { label: 'URLs', value: formatCount(urls.length) },
    { label: 'Hosts', value: formatCount(hosts.length), children: hosts.slice(0, 100) },
    { label: 'Schemes', value: '', children: count(u => u.scheme) },
    { label: 'With query', value: formatCount(urls.filter(u => u.query.length > 0).length) },
  ];
}

function card(v: UrlValue): CardData {
  const [u] = v.urls;
  if (v.urls.length !== 1 || !u) {
    return {
      rows: v.urls.slice(0, 200).map((x, i): CardRow => ({ label: String(i + 1), value: x.href })),
    };
  }
  const rows: CardRow[] = [
    { label: 'URL', value: u.href },
    { label: 'Decoded', value: safeDecode(u.href) },
    { label: 'Host', value: u.host },
    { label: 'Path', value: u.path },
  ];
  if (u.search) rows.push({ label: 'Query', value: queryOf(u) });
  if (u.fragment) rows.push({ label: 'Fragment', value: u.fragment });
  return {
    rows,
    table:
      u.query.length > 0
        ? {
            title: 'Query parameters',
            columns: ['key', 'value'],
            rows: u.query.map(([k, val]) => [k, val]),
          }
        : undefined,
  };
}

export const urlInterpreter: Interpreter<UrlValue> = {
  kind: 'url',
  isValue: (v): v is UrlValue => hasKind(v, 'url'),
  detect: c => (urlsOf(c) ? 0.95 : 0),
  parse(c) {
    const urls = urlsOf(c);
    if (!urls) throw new Error('Not a URL');
    return { kind: 'url', urls };
  },
  label(v) {
    const [u] = v.urls;
    if (v.urls.length === 1 && u) return `URL · ${u.host || u.scheme}`;
    return `URLs · ${formatCount(v.urls.length)}`;
  },
  summarise(v) {
    const [u] = v.urls;
    return {
      stats: v.urls.length === 1 && u ? singleStats(u) : multiStats(v.urls),
      extent: v.urls.length,
    };
  },
  slice(v, req) {
    if (req.type === 'json') return card(v);
    if (req.type === 'lines') return v.urls.slice(req.from, req.to).map(u => u.href);
    return unsupportedSlice('url', req);
  },
  export: v => ({ text: v.urls.map(u => u.href).join('\n') }),
};
