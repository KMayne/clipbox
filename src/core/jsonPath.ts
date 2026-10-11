import { isRecord } from './guards';

/**
 * JSONPath (RFC 9535), parsed and evaluated without `eval` or `Function`:
 * - `$` root, `.name` / `['name']` children, `*` / `[*]` wildcards, `..` descendants,
 *   `[0]` / `[-1]` indices, `[1:3]` / `[::-1]` slices, `[0,2]` / `['a','b']` unions;
 * - filters `[?@.price < 10 && @.tags]` (also written `[?(…)]`): comparisons
 *   (`== != < <= > >=`), `&&`, `||`, `!`, parentheses, existence tests, nested queries on `@`
 *   (the current node) or `$` (the root), and the standard functions `length()`, `count()`,
 *   `match()`, `search()` and `value()`.
 * - Two common non-standard extensions inside filters: `@.name =~ /^a/i` (regex search) and
 *   `@.x in ['a', 'b']` / `'a' in @.tags` (membership).
 * Leniencies: a bare `a.b` means `$.a.b`, and member names may contain `-` and `$`.
 * Script expressions (`[(…)]`) aren't supported.
 */

type Selector =
  | { t: 'name'; name: string }
  | { t: 'index'; index: number }
  | { t: 'slice'; start: number | null; end: number | null; step: number }
  | { t: 'wildcard' }
  | { t: 'filter'; expr: Logical };

interface Segment {
  descendant: boolean;
  selectors: Selector[];
}

interface Query {
  /** `@` (the current node) or `$` (the root). */
  root: '@' | '$';
  segments: Segment[];
  singular: boolean;
}

type FnName = 'length' | 'count' | 'match' | 'search' | 'value';

interface FnCall {
  name: FnName;
  args: Comparable[];
}

/** Something that has a value inside a filter. */
type Comparable =
  | { t: 'literal'; value: unknown }
  | { t: 'query'; query: Query }
  | { t: 'fn'; call: FnCall }
  | { t: 'regex'; re: RegExp }
  | { t: 'list'; items: unknown[] };

type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | '=~' | 'in';

type Logical =
  | { t: 'or' | 'and'; of: Logical[] }
  | { t: 'not'; of: Logical }
  | { t: 'compare'; op: CompareOp; left: Comparable; right: Comparable }
  | { t: 'exists'; query: Query }
  | { t: 'test'; call: FnCall };

export interface JsonPath {
  segments: Segment[];
  /** True if the path can only select one value (no wildcards, slices, unions, filters or `..`). */
  definite: boolean;
}

export class JsonPathError extends Error {}

/** Each function's parameter types and result type (RFC 9535 §2.4). */
const FUNCTIONS: Record<FnName, { params: ('value' | 'nodes')[]; result: 'value' | 'logical' }> = {
  length: { params: ['value'], result: 'value' },
  count: { params: ['nodes'], result: 'value' },
  match: { params: ['value', 'value'], result: 'logical' },
  search: { params: ['value', 'value'], result: 'logical' },
  value: { params: ['nodes'], result: 'value' },
};
const isFnName = (s: string): s is FnName => Object.hasOwn(FUNCTIONS, s);

const NAME_FIRST = /[A-Za-z_$\u0080-￿]/;
const NAME_CHAR = /[\w$\u0080-￿-]/;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const INT = /^-?\d+/;

class Parser {
  i = 0;
  constructor(readonly s: string) {}

  fail(message: string, at = this.i): never {
    throw new JsonPathError(`${message} at position ${at + 1}`);
  }
  peek(n = 0): string {
    return this.s[this.i + n] ?? '';
  }
  eof(): boolean {
    return this.i >= this.s.length;
  }
  ws(): void {
    while (/[ \t\r\n]/.test(this.peek())) this.i++;
  }
  eat(token: string): boolean {
    if (!this.s.startsWith(token, this.i)) return false;
    this.i += token.length;
    return true;
  }

  name(): string {
    const start = this.i;
    if (!NAME_FIRST.test(this.peek())) this.fail('Expected a name');
    while (NAME_CHAR.test(this.peek())) this.i++;
    return this.s.slice(start, this.i);
  }

  /** Segments until something that can't start one (end of input, an operator, `)` …). */
  segments(allowSpaces: boolean): Segment[] {
    const out: Segment[] = [];
    for (;;) {
      const save = this.i;
      if (allowSpaces) this.ws();
      const c = this.peek();
      if (c === '.' && this.peek(1) === '.') {
        this.i += 2;
        if (this.peek() === '[') out.push({ descendant: true, selectors: this.bracket() });
        else if (this.eat('*')) out.push({ descendant: true, selectors: [{ t: 'wildcard' }] });
        else out.push({ descendant: true, selectors: [{ t: 'name', name: this.name() }] });
      } else if (c === '.') {
        this.i++;
        if (this.eat('*')) out.push({ descendant: false, selectors: [{ t: 'wildcard' }] });
        else out.push({ descendant: false, selectors: [{ t: 'name', name: this.name() }] });
      } else if (c === '[') {
        out.push({ descendant: false, selectors: this.bracket() });
      } else {
        this.i = save;
        return out;
      }
    }
  }

  /** `[selector, …]`, starting at the `[`. */
  bracket(): Selector[] {
    this.i++; // [
    const out: Selector[] = [];
    for (;;) {
      this.ws();
      if (this.eof()) throw new JsonPathError('Unclosed [');
      out.push(this.selector());
      this.ws();
      if (this.eof()) throw new JsonPathError('Unclosed [');
      if (this.eat(']')) return out;
      if (!this.eat(',')) this.fail(`Expected , or ] but found '${this.peek()}'`);
    }
  }

  selector(): Selector {
    const c = this.peek();
    if (c === "'" || c === '"') return { t: 'name', name: this.string() };
    if (c === '*') {
      this.i++;
      return { t: 'wildcard' };
    }
    if (c === '?') {
      this.i++;
      this.ws();
      return { t: 'filter', expr: this.or() };
    }
    if (c === '(') throw new JsonPathError('Script expressions are not supported');
    if (c === '-' || c === ':' || /\d/.test(c)) return this.indexOrSlice();
    return this.fail(`Unexpected '${c}'`);
  }

  int(): number | null {
    const m = INT.exec(this.s.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    return Number(m[0]);
  }

  indexOrSlice(): Selector {
    const start = this.int();
    this.ws();
    if (this.peek() !== ':') {
      if (start === null) this.fail('Expected an index');
      return { t: 'index', index: start };
    }
    this.i++;
    this.ws();
    const end = this.int();
    this.ws();
    let step = 1;
    if (this.eat(':')) {
      this.ws();
      step = this.int() ?? 1;
      if (step === 0) throw new JsonPathError('Slice step cannot be 0');
    }
    return { t: 'slice', start, end, step };
  }

  /** A quoted string, with JSON-style escapes (plus `\'` in single quotes). */
  string(): string {
    const quote = this.peek();
    const start = this.i++;
    let out = '';
    for (;;) {
      if (this.eof()) this.fail('Unclosed string', start);
      const ch = this.s[this.i++] ?? '';
      if (ch === quote) return out;
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const e = this.s[this.i++] ?? '';
      const simple: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (e === 'u') {
        const hex = this.s.slice(this.i, this.i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('Bad \\u escape');
        out += String.fromCharCode(parseInt(hex, 16));
        this.i += 4;
      } else out += simple[e] ?? e;
    }
  }

  // Filter expressions

  or(): Logical {
    const of = [this.and()];
    for (;;) {
      this.ws();
      if (!this.eat('||')) break;
      of.push(this.and());
    }
    return of.length === 1 && of[0] ? of[0] : { t: 'or', of };
  }

  and(): Logical {
    const of = [this.basic()];
    for (;;) {
      this.ws();
      if (!this.eat('&&')) break;
      of.push(this.basic());
    }
    return of.length === 1 && of[0] ? of[0] : { t: 'and', of };
  }

  basic(): Logical {
    this.ws();
    if (this.peek() === '!' && this.peek(1) !== '=') {
      this.i++;
      this.ws();
      return { t: 'not', of: this.peek() === '(' ? this.paren() : this.test() };
    }
    if (this.peek() === '(') return this.paren();
    const at = this.i;
    const left = this.comparable();
    this.ws();
    const op = this.compareOp();
    if (op) {
      this.ws();
      const right = this.comparable(op);
      this.checkComparable(left, op, 'left', at);
      this.checkComparable(right, op, 'right', at);
      return { t: 'compare', op, left, right };
    }
    return this.asTest(left, at);
  }

  paren(): Logical {
    this.i++; // (
    const e = this.or();
    this.ws();
    if (!this.eat(')')) this.fail('Expected )');
    return e;
  }

  test(): Logical {
    const at = this.i;
    return this.asTest(this.comparable(), at);
  }

  asTest(c: Comparable, at: number): Logical {
    if (c.t === 'query') return { t: 'exists', query: c.query };
    if (c.t === 'fn' && FUNCTIONS[c.call.name].result === 'logical')
      return { t: 'test', call: c.call };
    if (c.t === 'fn') {
      return this.fail(
        `${c.call.name}() gives a value: compare it, e.g. ${c.call.name}(…) > 0,`,
        at,
      );
    }
    return this.fail('Expected a comparison', this.i);
  }

  compareOp(): CompareOp | null {
    for (const op of ['==', '!=', '<=', '>=', '=~', '<', '>'] as const) if (this.eat(op)) return op;
    if (this.s.startsWith('in', this.i) && !NAME_CHAR.test(this.peek(2))) {
      this.i += 2;
      return 'in';
    }
    return null;
  }

  /** RFC 9535: a query compared with something must select at most one node. */
  checkComparable(c: Comparable, op: CompareOp, side: 'left' | 'right', at: number): void {
    if (c.t === 'query' && !c.query.singular && !(op === 'in' && side === 'right')) {
      this.fail(
        'A comparison needs a single-value query (no wildcards, slices, filters or ..); use a nested filter instead,',
        at,
      );
    }
    if (c.t === 'fn' && FUNCTIONS[c.call.name].result === 'logical') {
      this.fail(`${c.call.name}() is true or false and can't be compared`, at);
    }
    if (c.t === 'regex' && !(op === '=~' && side === 'right')) this.fail('Unexpected regex', at);
    if (c.t === 'list' && !(op === 'in' && side === 'right')) this.fail('Unexpected list', at);
  }

  comparable(op?: CompareOp): Comparable {
    const c = this.peek();
    if (c === '@' || c === '$') {
      this.i++;
      const segments = this.segments(false);
      return { t: 'query', query: { root: c, segments, singular: isSingular(segments) } };
    }
    if (c === "'" || c === '"') return { t: 'literal', value: this.string() };
    if (c === '/' && op === '=~') return { t: 'regex', re: this.regex() };
    if (c === '[' && op === 'in') return { t: 'list', items: this.list() };
    const num = NUMBER.exec(this.s.slice(this.i));
    if (num) {
      this.i += num[0].length;
      return { t: 'literal', value: Number(num[0]) };
    }
    if (/[a-z]/.test(c)) {
      const start = this.i;
      while (/[a-z0-9_]/.test(this.peek())) this.i++;
      const word = this.s.slice(start, this.i);
      if (word === 'true' || word === 'false' || word === 'null') {
        return { t: 'literal', value: word === 'null' ? null : word === 'true' };
      }
      this.ws();
      if (this.peek() !== '(') this.fail(`Unexpected '${word}'`, start);
      if (!isFnName(word)) {
        this.fail(`Unknown function ${word}() (try length, count, match, search or value)`, start);
      }
      return { t: 'fn', call: this.call(word, start) };
    }
    if (this.eof()) throw new JsonPathError('Unclosed [');
    return this.fail(`Unexpected '${c}'`);
  }

  call(name: FnName, start: number): FnCall {
    this.i++; // (
    const args: Comparable[] = [];
    this.ws();
    if (!this.eat(')')) {
      for (;;) {
        this.ws();
        args.push(this.comparable());
        this.ws();
        if (this.eat(')')) break;
        if (!this.eat(',')) this.fail('Expected , or )');
      }
    }
    const { params } = FUNCTIONS[name];
    if (args.length !== params.length) {
      this.fail(
        `${name}() takes ${params.length} argument${params.length === 1 ? '' : 's'}`,
        start,
      );
    }
    params.forEach((type, k) => {
      const arg = args[k];
      if (type === 'nodes' && arg?.t !== 'query') {
        this.fail(`${name}() needs a query such as @.items[*]`, start);
      }
      if (type === 'value') {
        if (arg?.t === 'query' && !arg.query.singular) {
          this.fail(`${name}() needs a single-value query (no wildcards, slices or ..)`, start);
        }
        if (arg?.t === 'fn' && FUNCTIONS[arg.call.name].result !== 'value') {
          this.fail(`${arg.call.name}() can't be an argument of ${name}()`, start);
        }
      }
    });
    return { name, args };
  }

  /** `/source/flags` after `=~`. */
  regex(): RegExp {
    const start = this.i++;
    let src = '';
    let inClass = false;
    for (;;) {
      if (this.eof()) this.fail('Unclosed regex', start);
      const ch = this.s[this.i++] ?? '';
      if (ch === '\\') {
        src += ch + (this.s[this.i++] ?? '');
        continue;
      }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) break;
      src += ch;
    }
    const flagStart = this.i;
    while (/[imsu]/.test(this.peek())) this.i++;
    try {
      return new RegExp(src, this.s.slice(flagStart, this.i));
    } catch (err) {
      return this.fail(`Invalid regex: ${err instanceof Error ? err.message : String(err)}`, start);
    }
  }

  /** `[literal, …]` after `in`. */
  list(): unknown[] {
    this.i++; // [
    const items: unknown[] = [];
    this.ws();
    if (this.eat(']')) return items;
    for (;;) {
      this.ws();
      const item = this.comparable();
      if (item.t !== 'literal') this.fail('A list can only hold literals');
      items.push(item.value);
      this.ws();
      if (this.eat(']')) return items;
      if (!this.eat(',')) this.fail('Expected , or ]');
    }
  }
}

const isSingular = (segments: Segment[]) =>
  segments.every(
    s =>
      !s.descendant &&
      s.selectors.length === 1 &&
      (s.selectors[0]?.t === 'name' || s.selectors[0]?.t === 'index'),
  );

export function parseJsonPath(input: string): JsonPath {
  let path = input.trim();
  if (path.startsWith('$')) path = path.slice(1);
  // Allow a bare `a.b` as shorthand for `$.a.b`
  else if (path !== '' && !path.startsWith('.') && !path.startsWith('[')) path = `.${path}`;
  const p = new Parser(path);
  const segments = p.segments(true);
  p.ws();
  if (!p.eof()) {
    if (p.peek() === '.') p.fail('Expected a name', p.i + 1);
    p.fail(`Unexpected '${p.peek()}'`);
  }
  return { segments, definite: isSingular(segments) };
}

// Evaluation

/** RFC 9535's "Nothing": a missing value, distinct from JSON null. */
const NOTHING = Symbol('nothing');

function* children(node: unknown): Iterable<unknown> {
  if (Array.isArray(node)) yield* node;
  else if (isRecord(node)) for (const k in node) yield node[k];
}

function sliceIndices(n: number, sel: { start: number | null; end: number | null; step: number }) {
  const norm = (x: number) => (x >= 0 ? x : n + x);
  const out: number[] = [];
  if (sel.step > 0) {
    const lower = Math.min(Math.max(norm(sel.start ?? 0), 0), n);
    const upper = Math.min(Math.max(norm(sel.end ?? n), 0), n);
    for (let i = lower; i < upper; i += sel.step) out.push(i);
  } else {
    const upper = sel.start === null ? n - 1 : Math.min(Math.max(norm(sel.start), -1), n - 1);
    const lower = sel.end === null ? -1 : Math.min(Math.max(norm(sel.end), -1), n - 1);
    for (let i = upper; i > lower; i += sel.step) out.push(i);
  }
  return out;
}

function select(node: unknown, sel: Selector, root: unknown, out: unknown[]): void {
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
    case 'slice':
      if (Array.isArray(node)) for (const i of sliceIndices(node.length, sel)) out.push(node[i]);
      return;
    case 'wildcard':
      // Loops, not spread: huge arrays would overflow the argument limit
      for (const v of children(node)) out.push(v);
      return;
    case 'filter':
      for (const v of children(node)) if (test(sel.expr, v, root)) out.push(v);
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

function run(start: unknown, segments: Segment[], root: unknown): unknown[] {
  let nodes: unknown[] = [start];
  for (const { descendant, selectors } of segments) {
    let from = nodes;
    if (descendant) {
      from = [];
      for (const n of nodes) descendants(n, from);
    }
    const next: unknown[] = [];
    for (const n of from) for (const s of selectors) select(n, s, root, next);
    nodes = next;
  }
  return nodes;
}

const queryNodes = (q: Query, current: unknown, root: unknown) =>
  run(q.root === '@' ? current : root, q.segments, root);

function valueOf(c: Comparable, current: unknown, root: unknown): unknown {
  switch (c.t) {
    case 'literal':
      return c.value;
    case 'list':
      return c.items;
    case 'regex':
      return c.re;
    case 'query': {
      const nodes = queryNodes(c.query, current, root);
      // A non-singular query only reaches here as the right side of `in`: its nodes are the list
      if (!c.query.singular) return nodes;
      return nodes.length === 1 ? nodes[0] : NOTHING;
    }
    case 'fn':
      return callValue(c.call, current, root);
  }
}

const argValue = (c: Comparable | undefined, current: unknown, root: unknown) =>
  c ? valueOf(c, current, root) : NOTHING;

function argNodes(c: Comparable | undefined, current: unknown, root: unknown): unknown[] {
  return c?.t === 'query' ? queryNodes(c.query, current, root) : [];
}

function callValue(call: FnCall, current: unknown, root: unknown): unknown {
  const [a, b] = call.args;
  switch (call.name) {
    case 'length': {
      const v = argValue(a, current, root);
      if (typeof v === 'string') return [...v].length;
      if (Array.isArray(v)) return v.length;
      if (isRecord(v)) return Object.keys(v).length;
      return NOTHING;
    }
    case 'count':
      return argNodes(a, current, root).length;
    case 'value': {
      const nodes = argNodes(a, current, root);
      return nodes.length === 1 ? nodes[0] : NOTHING;
    }
    case 'match':
    case 'search': {
      const s = argValue(a, current, root);
      const re = argValue(b, current, root);
      if (typeof s !== 'string' || typeof re !== 'string') return false;
      const compiled = iRegexp(re, call.name === 'match');
      return compiled ? compiled.test(s) : false;
    }
  }
}

const regexCache = new Map<string, RegExp | null>();

/** An RFC 9485 I-Regexp as a JS RegExp; null when it isn't valid. */
function iRegexp(source: string, full: boolean): RegExp | null {
  const key = `${full ? 'm' : 's'}:${source}`;
  let re = regexCache.get(key);
  if (re === undefined) {
    try {
      re = new RegExp(full ? `^(?:${source})$` : source, 'u');
    } catch {
      re = null;
    }
    if (regexCache.size > 500) regexCache.clear();
    regexCache.set(key, re);
  }
  return re;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a);
    return (
      ka.length === Object.keys(b).length &&
      ka.every(k => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
    );
  }
  return false;
}

/** Code point order (JS `<` compares UTF-16 code units). */
function compareStrings(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i]?.codePointAt(0) ?? 0) - (y[i]?.codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

function less(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (typeof a === 'string' && typeof b === 'string') return compareStrings(a, b) < 0;
  return false;
}

function compare(op: CompareOp, l: unknown, r: unknown): boolean {
  const eq = () => (l === NOTHING || r === NOTHING ? l === r : deepEqual(l, r));
  switch (op) {
    case '==':
      return eq();
    case '!=':
      return !eq();
    case '<':
      return less(l, r);
    case '<=':
      return less(l, r) || eq();
    case '>':
      return less(r, l);
    case '>=':
      return less(r, l) || eq();
    case '=~':
      if (typeof l !== 'string') return false;
      if (r instanceof RegExp) return r.test(l);
      return typeof r === 'string' && (iRegexp(r, false)?.test(l) ?? false);
    case 'in':
      return l !== NOTHING && Array.isArray(r) && r.some(item => deepEqual(l, item));
  }
}

function test(e: Logical, current: unknown, root: unknown): boolean {
  switch (e.t) {
    case 'or':
      return e.of.some(x => test(x, current, root));
    case 'and':
      return e.of.every(x => test(x, current, root));
    case 'not':
      return !test(e.of, current, root);
    case 'exists':
      return queryNodes(e.query, current, root).length > 0;
    case 'test':
      return callValue(e.call, current, root) === true;
    case 'compare':
      return compare(e.op, valueOf(e.left, current, root), valueOf(e.right, current, root));
  }
}

/** Every value `path` selects in `root`, in document order. */
export function queryJsonPath(root: unknown, path: JsonPath): unknown[] {
  return run(root, path.segments, root);
}
