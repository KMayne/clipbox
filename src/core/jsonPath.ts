import { isRecord } from './guards';

/**
 * A small JSONPath subset, parsed and evaluated without `eval`:
 * `$` root, `.name` / `['name']` children, `*` / `[*]` wildcards, `..` recursive descent,
 * `[0]` / `[-1]` indices, `[1:3]` / `[::2]` slices and `[0,2]` / `['a','b']` unions.
 * Filters (`?()`) and script expressions aren't supported.
 */

type Selector =
  | { t: 'name'; name: string }
  | { t: 'index'; index: number }
  | { t: 'slice'; start: number | null; end: number | null; step: number }
  | { t: 'wildcard' }
  | { t: 'union'; of: Selector[] };

interface Segment {
  descendant: boolean;
  selector: Selector;
}

export interface JsonPath {
  segments: Segment[];
  /** True if the path can only select one value (no wildcards, slices, unions or `..`). */
  definite: boolean;
}

export class JsonPathError extends Error {}

const NAME = /^[A-Za-z_$\u0080-\uffff][\w$\u0080-\uffff-]*/;
const INT = /^-?\d+$/;

function parseBracket(inner: string): Selector {
  const parts = splitUnion(inner);
  if (parts.length > 1) return { t: 'union', of: parts.map(parseBracket) };
  const s = inner.trim();
  if (s === '*') return { t: 'wildcard' };
  if (/^(['"]).*\1$/s.test(s)) return { t: 'name', name: unquote(s) };
  if (INT.test(s)) return { t: 'index', index: Number(s) };
  const slice = /^(-?\d*)\s*:\s*(-?\d*)(?:\s*:\s*(-?\d*))?$/.exec(s);
  if (slice) {
    const num = (x: string | undefined) => (x ? Number(x) : null);
    const step = num(slice[3]) ?? 1;
    if (step === 0) throw new JsonPathError('Slice step cannot be 0');
    return { t: 'slice', start: num(slice[1]), end: num(slice[2]), step };
  }
  if (s.startsWith('?') || s.startsWith('(')) {
    throw new JsonPathError('Filter and script expressions are not supported');
  }
  throw new JsonPathError(`Unexpected '[${inner}]'`);
}

function unquote(s: string): string {
  const quote = s[0];
  let out = '';
  for (let i = 1; i < s.length - 1; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length - 1) out += s[++i];
    else if (ch === quote) throw new JsonPathError(`Unescaped quote in ${s}`);
    else out += ch;
  }
  return out;
}

/** Splits a bracket's contents on commas outside quotes. */
function splitUnion(inner: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ',') {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

/** Index of the `]` closing the bracket opened at `open`, skipping quoted text. */
function closingBracket(path: string, open: number): number {
  let quote: string | null = null;
  for (let i = open + 1; i < path.length; i++) {
    const ch = path[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ']') return i;
  }
  throw new JsonPathError('Unclosed [');
}

export function parseJsonPath(input: string): JsonPath {
  let path = input.trim();
  if (path.startsWith('$')) path = path.slice(1);
  // Allow a bare `a.b` as shorthand for `$.a.b`
  else if (path !== '' && !path.startsWith('.') && !path.startsWith('[')) path = `.${path}`;
  const segments: Segment[] = [];
  let i = 0;
  while (i < path.length) {
    let descendant = false;
    if (path.startsWith('..', i)) {
      descendant = true;
      i += 2;
    } else if (path[i] === '.') {
      i++;
    } else if (path[i] !== '[') {
      throw new JsonPathError(`Unexpected '${path[i] ?? ''}' at ${i + 1}`);
    }
    if (path[i] === '[') {
      const close = closingBracket(path, i);
      segments.push({ descendant, selector: parseBracket(path.slice(i + 1, close)) });
      i = close + 1;
    } else if (path[i] === '*') {
      segments.push({ descendant, selector: { t: 'wildcard' } });
      i++;
    } else {
      const name = NAME.exec(path.slice(i))?.[0];
      if (!name) throw new JsonPathError(`Expected a name at ${i + 1}`);
      segments.push({ descendant, selector: { t: 'name', name } });
      i += name.length;
    }
  }
  const definite = segments.every(
    s => !s.descendant && (s.selector.t === 'name' || s.selector.t === 'index'),
  );
  return { segments, definite };
}

function select(node: unknown, sel: Selector, out: unknown[]): void {
  switch (sel.t) {
    case 'name':
      if (isRecord(node) && Object.hasOwn(node, sel.name)) out.push(node[sel.name]);
      return;
    case 'index':
      if (Array.isArray(node)) {
        const i = sel.index < 0 ? node.length + sel.index : sel.index;
        if (i >= 0 && i < node.length) out.push(node[i]);
      }
      return;
    case 'slice': {
      if (!Array.isArray(node)) return;
      const n = node.length;
      const norm = (x: number) => (x < 0 ? Math.max(0, n + x) : Math.min(n, x));
      if (sel.step > 0) {
        const end = sel.end === null ? n : norm(sel.end);
        for (let i = sel.start === null ? 0 : norm(sel.start); i < end; i += sel.step) {
          out.push(node[i]);
        }
      } else {
        const start = sel.start === null ? n - 1 : Math.min(n - 1, norm(sel.start));
        const end = sel.end === null ? -1 : norm(sel.end);
        for (let i = start; i > end; i += sel.step) out.push(node[i]);
      }
      return;
    }
    case 'wildcard':
      // Loops, not spread: huge arrays would overflow the argument limit
      if (Array.isArray(node)) for (const v of node) out.push(v);
      else if (isRecord(node)) for (const k in node) out.push(node[k]);
      return;
    case 'union':
      for (const s of sel.of) select(node, s, out);
  }
}

/** `node` and everything beneath it, in document order. */
function descendants(node: unknown, out: unknown[]): void {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    out.push(n);
    const kids = Array.isArray(n) ? n : isRecord(n) ? Object.values(n) : [];
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
  }
}

/** Every value `path` selects in `root`, in document order. */
export function queryJsonPath(root: unknown, path: JsonPath): unknown[] {
  let nodes: unknown[] = [root];
  for (const { descendant, selector } of path.segments) {
    let from = nodes;
    if (descendant) {
      from = [];
      for (const n of nodes) descendants(n, from);
    }
    const next: unknown[] = [];
    for (const n of from) select(n, selector, next);
    nodes = next;
  }
  return nodes;
}
