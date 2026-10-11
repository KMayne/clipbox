/** Links and tables out of parsed HTML, and an allowlist sanitiser. */
import { gridCsv } from '../csvGrid';
import { convertTree, tableRows } from './convert';
import { baseHref, collapsedText, findAll, walk, type HtmlElement, type HtmlNode } from './dom';

// --- Links ---

export interface Link {
  text: string;
  href: string;
  title: string;
}

/** `href` resolved against `base` when that's an absolute URL; else as written. */
export function resolveHref(href: string, base: string | null): string {
  if (!base) return href;
  try {
    return new URL(href, new URL(base)).href;
  } catch {
    return href;
  }
}

/**
 * Every `<a href>` (and `<area href>`), in document order. `base` (a setting) wins over the
 * document's own `<base href>`; relative links stay relative when there's neither.
 */
export function extractLinks(root: HtmlElement, base = ''): Link[] {
  const own = baseHref(root);
  const resolvedBase = base.trim() || (own && resolveHref(own, null)) || null;
  const links: Link[] = [];
  for (const e of walk(root)) {
    if ((e.name !== 'a' && e.name !== 'area') || e.attrs.href === undefined) continue;
    const href = e.attrs.href.trim();
    const img = findAll(e, 'img')[0];
    links.push({
      text: collapsedText(e) || (e.attrs.alt ?? img?.attrs.alt ?? '').trim(),
      href: resolveHref(href, resolvedBase),
      title: e.attrs.title ?? '',
    });
  }
  return links;
}

export const linksCsv = (links: Link[]) =>
  gridCsv([['text', 'href', 'title'], ...links.map(l => [l.text, l.href, l.title])]);

// --- Tables ---

/** Each table's cells as plain text (nested tables are their own entries, after their parent). */
export function extractTables(root: HtmlElement): string[][][] {
  return findAll(root, 'table').map(t =>
    tableRows(t).map(row =>
      row.map(cell =>
        cell ? convertTree(cell, { mode: 'text' }).replace(/\s+/g, ' ').trim() : '',
      ),
    ),
  );
}

// --- Sanitising ---

/** Elements kept (with their content); anything else is unwrapped to its content. */
const ALLOWED = new Set(
  (
    'a abbr article aside b bdi bdo blockquote br caption cite code col colgroup dd del details ' +
    'dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img input ins kbd ' +
    'li main mark nav ol p picture pre q rp rt ruby s samp section small source span strong sub ' +
    'summary sup table tbody td tfoot th thead time tr u ul var wbr'
  ).split(' '),
);
/** Elements dropped with everything inside them. */
const DROPPED = new Set(
  (
    'script style template iframe frame frameset object embed applet form textarea select ' +
    'button noscript head title meta link base svg math audio video canvas dialog portal'
  ).split(' '),
);
const ATTRS = new Set(
  (
    'href src alt title width height colspan rowspan align start reversed type checked ' +
    'disabled id class lang dir datetime cite open scope abbr headers srcset sizes'
  ).split(' '),
);
const URL_ATTRS = new Set(['href', 'src', 'cite']);
const SAFE_URL = /^(?:(?:https?|mailto|tel|ftp):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;
const SAFE_IMAGE = /^data:image\/(?:png|gif|jpe?g|webp|avif|bmp);/i;

function safeUrl(name: string, value: string, element: string): boolean {
  // Browsers ignore control characters and whitespace inside schemes, e.g. "java\tscript:"
  const v = [...value].filter(c => c.charCodeAt(0) > 0x20).join('');
  if (element === 'img' && name === 'src' && SAFE_IMAGE.test(v)) return true;
  return SAFE_URL.test(v);
}

/** One element with its children already sanitised (an explicit stack does the walk). */
function sanitiseElement(node: HtmlElement, children: HtmlNode[]): HtmlNode[] {
  if (!ALLOWED.has(node.name)) return children;
  if (node.name === 'input' && node.attrs.type?.toLowerCase() !== 'checkbox') return [];
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(node.attrs)) {
    if (!ATTRS.has(k)) continue;
    if (URL_ATTRS.has(k) && !safeUrl(k, v, node.name)) continue;
    if (k === 'srcset' && /javascript:|data:(?!image\/)/i.test(v.replace(/\s/g, ''))) continue;
    attrs[k] = v;
  }
  // Links to elsewhere don't leak the page or let it be scripted through window.opener
  if (node.name === 'a' && attrs.href && /^https?:/i.test(attrs.href)) {
    attrs.rel = 'noopener noreferrer';
  }
  return [{ ...node, attrs, children }];
}

/**
 * Keeps safe markup only: an element and attribute allowlist, no event handlers or styles, and
 * only http(s)/mailto/tel/relative URLs (plus `data:image/…` for images).
 */
export function sanitiseTree(root: HtmlElement): HtmlElement {
  // Post-order without recursion: each frame collects its element's sanitised children
  interface Frame {
    node: HtmlElement;
    next: number;
    out: HtmlNode[];
  }
  const top: Frame = { node: root, next: 0, out: [] };
  const stack: Frame[] = [top];
  for (let f = stack.at(-1); f; f = stack.at(-1)) {
    const child = f.node.children[f.next++];
    if (child === undefined) {
      stack.pop();
      const parent = stack.at(-1);
      // Not push(...): an unwrapped element can have too many children to spread
      if (parent) for (const n of sanitiseElement(f.node, f.out)) parent.out.push(n);
    } else if (child.type === 'text') f.out.push(child);
    else if (!DROPPED.has(child.name)) stack.push({ node: child, next: 0, out: [] });
  }
  return { ...root, children: top.out };
}
