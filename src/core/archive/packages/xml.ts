/** Small helpers over the OOXML element tree for package manifests (nuspec, vsixmanifest, OPF). */

import type { XmlNode } from '../../presentation/ooxml';

/** Local name without its prefix: "dc:title" → "title". */
export const localName = (name: string) => name.slice(name.indexOf(':') + 1);

/** First child whose local name is `name`. */
export const childLocal = (n: XmlNode | null | undefined, name: string): XmlNode | undefined =>
  n?.children.find(c => localName(c.name) === name);

export const childrenLocal = (n: XmlNode | null | undefined, name: string): XmlNode[] =>
  n?.children.filter(c => localName(c.name) === name) ?? [];

/** The element's own text (direct text children only), trimmed; null when empty. */
export function ownText(n: XmlNode | null | undefined): string | null {
  if (!n) return null;
  const t = n.children
    .map(c => c.text ?? '')
    .join('')
    .trim();
  return t === '' ? null : t;
}

/** An attribute by local name (namespaced attributes keep their prefix in the tree). */
export function attrLocal(n: XmlNode | null | undefined, name: string): string | null {
  if (!n) return null;
  for (const [k, v] of Object.entries(n.attrs)) if (localName(k) === name) return v;
  return null;
}
