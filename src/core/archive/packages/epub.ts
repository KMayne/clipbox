/** EPUB: mimetype, then META-INF/container.xml, then the OPF package document. */

import { parseXml, resolvePart, type XmlNode } from '../../presentation/ooxml';
import type { EntryReader } from './reader';
import type { EpubChapter, EpubInfo } from './types';
import { attrLocal, childLocal, childrenLocal, localName, ownText } from './xml';

const MIMETYPE = 'application/epub+zip';
/** Spine entries kept; very long books list the first ones. */
const MAX_CHAPTERS = 2_000;

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const withoutFragment = (href: string) => safeDecode(href.replace(/#.*$/, ''));

/** NCX navPoint titles by resolved path (first one wins), walked with an explicit stack. */
function ncxTitles(ncx: XmlNode | null, ncxPath: string): Map<string, string> {
  const titles = new Map<string, string>();
  const navMap = childLocal(ncx, 'navMap');
  const stack = [...childrenLocal(navMap, 'navPoint')].reverse();
  while (stack.length > 0) {
    const p = stack.pop();
    if (!p) break;
    const label = ownText(childLocal(childLocal(p, 'navLabel'), 'text'));
    const src = attrLocal(childLocal(p, 'content'), 'src');
    if (label && src) {
      const path = resolvePart(ncxPath, withoutFragment(src));
      if (!titles.has(path)) titles.set(path, label);
    }
    const kids = childrenLocal(p, 'navPoint');
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      if (k) stack.push(k);
    }
  }
  return titles;
}

export function recogniseEpub(r: EntryReader): EpubInfo | null {
  if (!r.has('mimetype') || r.text('mimetype', 1024)?.trim() !== MIMETYPE) return null;
  const container = parseXml(r.text('META-INF/container.xml') ?? '');
  const rootfile = childLocal(childLocal(container, 'rootfiles'), 'rootfile');
  const opfPath = safeDecode(attrLocal(rootfile, 'full-path') ?? '');
  const opf = opfPath ? parseXml(r.text(opfPath) ?? '') : null;
  const meta = childLocal(opf, 'metadata');
  const dc = (name: string) =>
    (meta?.children ?? [])
      .filter(c => localName(c.name) === name)
      .flatMap(c => {
        const t = ownText(c);
        return t ? [t] : [];
      });

  const items = new Map<string, { href: string; type: string | null }>();
  for (const item of childrenLocal(childLocal(opf, 'manifest'), 'item')) {
    const id = attrLocal(item, 'id');
    const href = attrLocal(item, 'href');
    if (id && href) {
      items.set(id, {
        href: resolvePart(opfPath, withoutFragment(href)),
        type: attrLocal(item, 'media-type'),
      });
    }
  }
  const spine = childLocal(opf, 'spine');
  const tocId = attrLocal(spine, 'toc');
  const ncxItem =
    (tocId ? items.get(tocId) : undefined) ??
    [...items.values()].find(i => i.type === 'application/x-dtbncx+xml');
  const titles = ncxItem
    ? ncxTitles(parseXml(r.text(ncxItem.href) ?? ''), ncxItem.href)
    : new Map<string, string>();

  const chapters: EpubChapter[] = [];
  for (const ref of childrenLocal(spine, 'itemref')) {
    if (chapters.length >= MAX_CHAPTERS) break;
    const item = items.get(attrLocal(ref, 'idref') ?? '');
    if (item) chapters.push({ href: item.href, title: titles.get(item.href) ?? null });
  }
  return {
    type: 'epub',
    title: dc('title')[0] ?? null,
    authors: dc('creator'),
    language: dc('language')[0] ?? null,
    publisher: dc('publisher')[0] ?? null,
    date: dc('date')[0] ?? null,
    identifier: dc('identifier')[0] ?? null,
    version: attrLocal(opf, 'version'),
    chapters,
  };
}
