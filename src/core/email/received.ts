/**
 * The Received chain (RFC 5321 §4.4): each server a message passed through prepends a header, so
 * the chain reads bottom-up. Hops come out in travel order, with the delay since the previous one.
 */

import { headersNamed, parseMailDate, type Header } from './headers';

export interface Hop {
  /** 1-based, in travel order. */
  hop: number;
  /** The sending host as it named itself, with what the receiver saw in parentheses. */
  from: string | null;
  /** The receiving host. */
  by: string | null;
  /** Protocol, e.g. "ESMTPS". */
  with: string | null;
  id: string | null;
  for: string | null;
  /** ISO 8601 (UTC), or null if the date is missing or unreadable. */
  date: string | null;
  /** Seconds since the previous hop, when both have dates. Clock skew can make it negative. */
  delay: number | null;
}

/** Most hops read; past this the chain is cut short. */
export const MAX_HOPS = 100;

const CLAUSES = ['from', 'by', 'via', 'with', 'id', 'for'] as const;
type Clause = (typeof CLAUSES)[number];

/** One header's clauses; the date follows the last `;`. */
export function parseReceived(value: string): Omit<Hop, 'hop' | 'delay'> & { ms: number | null } {
  const semi = value.lastIndexOf(';');
  const clauses = semi < 0 ? value : value.slice(0, semi);
  const date = semi < 0 ? null : parseMailDate(value.slice(semi + 1));
  const found: Partial<Record<Clause, string>> = {};
  // Clause keywords outside parentheses split the header; comments stay with their clause
  const re = /(?:^|\s)(from|by|via|with|id|for)\s+/gi;
  const marks: { clause: Clause; start: number; end: number }[] = [];
  let depth = 0;
  let scanned = 0;
  for (const m of clauses.matchAll(re)) {
    for (; scanned < m.index; scanned++) {
      if (clauses[scanned] === '(') depth++;
      else if (clauses[scanned] === ')' && depth > 0) depth--;
    }
    const word = (m[1] ?? '').toLowerCase();
    const clause = CLAUSES.find(c => c === word);
    if (depth === 0 && clause) marks.push({ clause, start: m.index, end: m.index + m[0].length });
  }
  for (const [i, mark] of marks.entries()) {
    const text = clauses
      .slice(mark.end, marks[i + 1]?.start ?? clauses.length)
      .replace(/\s+/g, ' ')
      .trim();
    if (!(mark.clause in found)) found[mark.clause] = text;
  }
  return {
    from: found.from ?? null,
    by: found.by ?? null,
    with: found.with ?? null,
    id: found.id ?? null,
    for: found.for?.replace(/^<|>$/g, '') ?? null,
    date: date ? new Date(date.ms).toISOString() : null,
    ms: date?.ms ?? null,
  };
}

/** The message's hops, oldest first. */
export function receivedChain(headers: Header[]): Hop[] {
  const values = headersNamed(headers, 'received').slice(0, MAX_HOPS).reverse();
  let previous: number | null = null;
  return values.map((v, i) => {
    const { ms, ...hop } = parseReceived(v);
    const delay = ms !== null && previous !== null ? Math.round((ms - previous) / 1000) : null;
    if (ms !== null) previous = ms;
    return { hop: i + 1, ...hop, delay };
  });
}
