import { describe, expect, it } from 'vitest';
import { parseJsonPath, queryJsonPath } from '../../src/core/jsonPath';
import { isRecord } from '../../src/core/guards';

const q = (doc: unknown, path: string) => queryJsonPath(doc, parseJsonPath(path));

describe('JSONPath filters (RFC 9535 §2.3.5.3 examples)', () => {
  const doc = {
    a: [3, 5, 1, 2, 4, 6, { b: 'j' }, { b: 'k' }, { b: {} }, { b: 'kilo' }],
    o: { p: 1, q: 2, r: 3, s: 5, t: { u: 6 } },
    e: 'f',
  };
  const cases: [string, unknown[]][] = [
    ["$.a[?@.b == 'kilo']", [{ b: 'kilo' }]],
    ["$.a[?(@.b == 'kilo')]", [{ b: 'kilo' }]],
    ['$.a[?@>3.5]', [5, 4, 6]],
    ['$.a[?@.b]', [{ b: 'j' }, { b: 'k' }, { b: {} }, { b: 'kilo' }]],
    ['$[?@.*]', [doc.a, doc.o]],
    ['$[?@[?@.b]]', [doc.a]],
    ['$.o[?@<3, ?@<3]', [1, 2, 1, 2]],
    ['$.a[?@<2 || @.b == "k"]', [1, { b: 'k' }]],
    ['$.a[?match(@.b, "[jk]")]', [{ b: 'j' }, { b: 'k' }]],
    ['$.a[?search(@.b, "[jk]")]', [{ b: 'j' }, { b: 'k' }, { b: 'kilo' }]],
    ['$.o[?@>1 && @<4]', [2, 3]],
    ['$.o[?@.u || @.x]', [{ u: 6 }]],
    ['$.a[?@.b == $.x]', [3, 5, 1, 2, 4, 6]],
    ['$.a[?@ == @]', doc.a],
  ];
  it.each(cases)('%s', (path, expected) => expect(q(doc, path)).toEqual(expected));
});

describe('JSONPath comparisons (RFC 9535 Table 11)', () => {
  const doc = { obj: { x: 'y' }, arr: [2, 3] };
  // `@` is the document here (RFC 9535 uses `$` for it)
  const holds = (expr: string) => q([doc], `$[?${expr.replaceAll('$', '@')}]`).length === 1;
  it.each([
    ['$.absent1 == $.absent2', true],
    ['$.absent1 <= $.absent2', true],
    ["$.absent == 'g'", false],
    ['$.absent1 != $.absent2', false],
    ["$.absent != 'g'", true],
    ['1 <= 2', true],
    ['1 > 2', false],
    ['13 == "13"', false],
    ["'a' <= 'b'", true],
    ["'a' > 'b'", false],
    ['$.obj == $.arr', false],
    ['$.obj != $.arr', true],
    ['$.obj == $.obj', true],
    ['$.obj != $.obj', false],
    ['$.arr == $.arr', true],
    ['$.arr != $.arr', false],
    ['$.obj == 17', false],
    ['$.obj != 17', true],
    ['$.obj <= $.arr', false],
    ['$.obj < $.arr', false],
    ['$.obj <= $.obj', true],
    ['$.arr <= $.arr', true],
    ['1 <= $.arr', false],
    ['1 >= $.arr', false],
    ['1 > $.arr', false],
    ['1 < $.arr', false],
    ['true <= true', true],
    ['true > true', false],
  ])('%s is %s', (expr, expected) => expect(holds(expr)).toBe(expected));
});

describe('JSONPath functions and extensions', () => {
  const books = [
    { title: 'Sayings', price: 8.95, tags: ['quotes'], author: 'Nigel' },
    { title: 'Sword', price: 12.99, tags: [], author: 'Evelyn' },
    { title: 'Moby Dick', price: 8.99, isbn: '0-553', author: 'Herman' },
    { title: 'Rings', price: 22.99, tags: ['fantasy', 'epic'], author: 'Tolkien' },
  ];
  const titles = (path: string) => q(books, path).map(b => (isRecord(b) ? b.title : b));

  it('combines comparisons, existence and negation', () => {
    expect(titles('$[?(@.price < 10 && @.tags)]')).toEqual(['Sayings']);
    expect(titles('$[?!@.tags]')).toEqual(['Moby Dick']);
    expect(titles('$[?!(@.price < 10)]')).toEqual(['Sword', 'Rings']);
    expect(titles('$[?@.price >= 12.99 || @.isbn]')).toEqual(['Sword', 'Moby Dick', 'Rings']);
  });

  it('supports length(), count(), value(), match() and search()', () => {
    expect(titles('$[?length(@.tags) > 1]')).toEqual(['Rings']);
    expect(titles('$[?length(@.title) == 5]')).toEqual(['Sword', 'Rings']);
    expect(titles('$[?count(@.tags[*]) == 0]')).toEqual(['Sword', 'Moby Dick']);
    expect(titles("$[?value(@..tags[0]) == 'epic']")).toEqual([]);
    expect(titles("$[?value(@.tags[1]) == 'epic']")).toEqual(['Rings']);
    expect(titles('$[?match(@.author, "[A-Z].*n")]')).toEqual(
      ['Evelyn', 'Herman', 'Tolkien'].map(a => books.find(b => b.author === a)?.title ?? ''),
    );
    expect(titles('$[?search(@.title, "ing")]')).toEqual(['Sayings', 'Rings']);
    expect(titles('$[?match(@.title, "ing")]')).toEqual([]);
  });

  it('supports =~ regex and in membership', () => {
    expect(titles('$[?@.title =~ /^s/i]')).toEqual(['Sayings', 'Sword']);
    expect(titles("$[?@.author in ['Nigel', 'Tolkien']]")).toEqual(['Sayings', 'Rings']);
    expect(titles("$[?'epic' in @.tags]")).toEqual(['Rings']);
    expect(titles("$[?'fantasy' in @.tags[*]]")).toEqual(['Rings']);
  });

  it('filters under descendants and in nested queries', () => {
    const doc = { store: { book: books, bike: { price: 5 } } };
    expect(q(doc, '$..[?@.price < 9].title')).toEqual(['Sayings', 'Moby Dick']);
    expect(q(doc, '$.store[?@.price]')).toEqual([{ price: 5 }]);
  });

  it('follows RFC slice rules, including negative steps', () => {
    const a = [0, 1, 2, 3, 4, 5, 6];
    expect(q(a, '$[5:1:-2]')).toEqual([5, 3]);
    expect(q(a, '$[-100:2:-1]')).toEqual([]);
    expect(q(a, '$[::-3]')).toEqual([6, 3, 0]);
    expect(q(a, '$[1:100]')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('reads string escapes and spaces', () => {
    expect(q({ "a'b": 1, 'c\nd': 2 }, "$['a\\'b', \"c\\nd\"]")).toEqual([1, 2]);
    expect(q({ a: [{ b: 1 }] }, '$ .a [ ?@.b == 1 ] .b')).toEqual([1]);
  });

  it('reports clear errors', () => {
    expect(() => parseJsonPath('$[?@.a ==]')).toThrow('position');
    expect(() => parseJsonPath('$[?@.a[*] == 1]')).toThrow('single-value query');
    expect(() => parseJsonPath('$[?length(@.a)]')).toThrow('gives a value');
    expect(() => parseJsonPath('$[?foo(@.a)]')).toThrow('Unknown function foo()');
    expect(() => parseJsonPath('$[?count(1) == 1]')).toThrow('needs a query');
    expect(() => parseJsonPath('$[?@.a =~ /[/]')).toThrow('Unclosed regex');
    expect(() => parseJsonPath('$[?@.a')).toThrow('Unclosed [');
    expect(() => parseJsonPath('$[?1]')).toThrow('Expected a comparison');
    expect(parseJsonPath('$.a[?@.b]').definite).toBe(false);
  });
});
