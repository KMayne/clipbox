/** Just enough Office Open XML: an ordered element tree, relationships and part paths. */

import { XMLParser } from 'fast-xml-parser';
import { isRecord } from '../guards';

/** An element with its attributes and children in document order; text nodes have name '#text'. */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Set on '#text' nodes only. */
  text?: string;
}

// preserveOrder keeps runs and paragraphs in document order; text keeps its spaces
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  htmlEntities: true,
});

const ATTRS = ':@';
const TEXT = '#text';

function toNodes(items: unknown): XmlNode[] {
  if (!Array.isArray(items)) return [];
  const out: XmlNode[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const raw = item[ATTRS];
    const attrs: Record<string, string> = {};
    if (isRecord(raw)) {
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') attrs[k] = v;
    }
    for (const [name, value] of Object.entries(item)) {
      if (name === ATTRS) continue;
      if (name === TEXT) {
        out.push({ name, attrs: {}, children: [], text: String(value) });
      } else {
        out.push({ name, attrs, children: toNodes(value) });
      }
    }
  }
  return out;
}

/** Parses an XML part into its root element; null if it isn't well-formed. */
export function parseXml(source: string): XmlNode | null {
  try {
    return toNodes(parser.parse(source)).find(n => n.name !== TEXT) ?? null;
  } catch {
    return null;
  }
}

/** Child elements called `name` (qualified, e.g. "p:sldId"). */
export const childrenNamed = (node: XmlNode, name: string) =>
  node.children.filter(c => c.name === name);

export const child = (node: XmlNode, name: string): XmlNode | undefined =>
  node.children.find(c => c.name === name);

/** Follows a path of child names, e.g. `at(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph')`. */
export function at(node: XmlNode, ...names: string[]): XmlNode | undefined {
  let current: XmlNode | undefined = node;
  for (const name of names) current = current && child(current, name);
  return current;
}

/** Every descendant called `name`, in document order. */
export function descendants(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === name) out.push(c);
      else walk(c);
    }
  };
  walk(node);
  return out;
}

/** Concatenated text of all descendants. */
export function textOf(node: XmlNode): string {
  if (node.text !== undefined) return node.text;
  return node.children.map(textOf).join('');
}

/** A DrawingML paragraph's text: its runs and fields, with line breaks as '\n'. */
export function paragraphText(p: XmlNode): string {
  let s = '';
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === 'a:t') s += textOf(c);
      else if (c.name === 'a:br') s += '\n';
      else if (c.name !== 'a:pPr' && c.name !== 'a:rPr' && c.name !== 'a:endParaRPr') walk(c);
    }
  };
  walk(p);
  return s;
}

export interface Relationship {
  type: string;
  /** Resolved zip path (no leading slash), or the raw target for external ones. */
  target: string;
  external: boolean;
}

/** `relationships` type suffixes, e.g. ".../relationships/slide" → "slide". */
export const relType = (r: Relationship) => r.type.slice(r.type.lastIndexOf('/') + 1);

/** The folder holding a part, e.g. "ppt/slides/slide1.xml" → "ppt/slides". */
const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** Resolves a relationship target against the folder of the part that owns it. */
export function resolvePart(from: string, target: string): string {
  const parts = target.startsWith('/') ? [] : dirname(from).split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Where a part's relationships live: "ppt/slides/slide1.xml" → "ppt/slides/_rels/slide1.xml.rels". */
export function relsPath(part: string): string {
  const dir = dirname(part);
  const base = part.slice(part.lastIndexOf('/') + 1);
  return `${dir ? `${dir}/` : ''}_rels/${base}.rels`;
}

/** Relationships by id from a `.rels` part. */
export function parseRels(part: string, source: string | null): Map<string, Relationship> {
  const rels = new Map<string, Relationship>();
  const root = source === null ? null : parseXml(source);
  if (!root) return rels;
  for (const r of childrenNamed(root, 'Relationship')) {
    const { Id: id, Type: type, Target: target, TargetMode: mode } = r.attrs;
    if (!id || !type || target === undefined) continue;
    const external = mode === 'External';
    rels.set(id, { type, target: external ? target : resolvePart(part, target), external });
  }
  return rels;
}
