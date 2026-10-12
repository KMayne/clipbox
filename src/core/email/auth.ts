/**
 * Authentication-Results (RFC 8601): what the receiving server concluded about SPF, DKIM and
 * DMARC. Only the topmost header that reports a method counts; lower ones were added on the way
 * and can be forged by the sender.
 */

import { headersNamed, type Header } from './headers';

export interface AuthResult {
  /** Lower-case, e.g. "spf", "dkim", "dmarc", "arc". */
  method: string;
  /** Lower-case, e.g. "pass", "fail", "softfail", "none". */
  result: string;
  /** Properties such as `smtp.mailfrom` or `header.d`. */
  props: Record<string, string>;
  /** Who reported it (the authserv-id). */
  server: string;
}

const stripComments = (s: string) => {
  // Flat counter instead of nested regexes: comments can nest
  let out = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? '';
    if (quoted) {
      out += c;
      if (c === '\\') out += s[++i] ?? '';
      else if (c === '"') quoted = false;
    } else if (c === '"' && depth === 0) {
      quoted = true;
      out += c;
    } else if (c === '(') depth++;
    else if (c === ')' && depth > 0) depth--;
    else if (depth === 0) out += c;
    else if (c === '\\') i++;
  }
  return out;
};

/** One Authentication-Results header's results. */
export function parseAuthResults(value: string): AuthResult[] {
  const [serverPart = '', ...statements] = stripComments(value).split(';');
  const server = serverPart.trim().split(/\s+/)[0] ?? '';
  const out: AuthResult[] = [];
  for (const statement of statements) {
    const m = /^\s*([\w-]+)\s*=\s*([\w-]+)(.*)$/s.exec(statement);
    if (!m) continue;
    const props: Record<string, string> = {};
    for (const p of (m[3] ?? '').matchAll(/([\w-]+\.[\w.-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s;]+)/g)) {
      props[(p[1] ?? '').toLowerCase()] = (p[2] ?? '').replace(/^"|"$/g, '');
    }
    out.push({
      method: (m[1] ?? '').toLowerCase(),
      result: (m[2] ?? '').toLowerCase(),
      props,
      server,
    });
  }
  return out;
}

/**
 * Every result from the message's Authentication-Results headers, topmost header first. A
 * `Received-SPF` header stands in for SPF when no Authentication-Results reports it.
 */
export function authResults(headers: Header[]): AuthResult[] {
  const all = headersNamed(headers, 'authentication-results').flatMap(parseAuthResults);
  if (!all.some(r => r.method === 'spf')) {
    const spf = headersNamed(headers, 'received-spf')[0];
    const result = spf && /^\s*([\w-]+)/.exec(spf)?.[1];
    if (result) all.push({ method: 'spf', result: result.toLowerCase(), props: {}, server: '' });
  }
  return all;
}

/** The verdict for each of SPF, DKIM and DMARC: the first (topmost) one reported. */
export function authSummary(
  results: AuthResult[],
): Partial<Record<'spf' | 'dkim' | 'dmarc', AuthResult>> {
  const out: Partial<Record<'spf' | 'dkim' | 'dmarc', AuthResult>> = {};
  for (const r of results) {
    if ((r.method === 'spf' || r.method === 'dkim' || r.method === 'dmarc') && !out[r.method]) {
      out[r.method] = r;
    }
  }
  return out;
}

/** "pass (example.com)": the result with the domain it is about, when there is one. */
export function authText(r: AuthResult): string {
  const domain =
    r.props['header.d'] ??
    r.props['header.from'] ??
    r.props['smtp.mailfrom'] ??
    r.props['header.i'];
  return domain ? `${r.result} (${domain.replace(/^.*@/, '')})` : r.result;
}
