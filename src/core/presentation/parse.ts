/** Reads a .pptx (an OOXML zip): slide order, text, notes, media and deck metadata. */

import { checkGuard, guessMime } from '../archive/types';
import { extractZipEntry, type ZipListing } from '../archive/zip';
import {
  at,
  child,
  childrenNamed,
  paragraphText,
  parseRels,
  parseXml,
  relsPath,
  relType,
  textOf,
  type XmlNode,
} from './ooxml';
import type { PresentationMedia, PresentationMeta, PresentationValue, Slide } from './types';

export const PRESENTATION_PART = 'ppt/presentation.xml';
const MEDIA_DIR = 'ppt/media/';
const TITLE_TYPES = new Set(['title', 'ctrTitle']);
/** Placeholders whose text is boilerplate rather than slide content. */
const SKIPPED_TYPES = new Set(['sldNum', 'dt', 'ftr', 'hdr', 'sldImg']);

/** Whether a zip listing looks like a PowerPoint deck. */
export const isPresentationZip = (zip: ZipListing) => {
  const names = new Set(zip.entries.map(e => e.path));
  return names.has('[Content_Types].xml') && names.has(PRESENTATION_PART);
};

/** Reads parts by path (part names are case-insensitive); unreadable parts come back null. */
function partReader(bytes: Uint8Array<ArrayBuffer>, zip: ZipListing) {
  const index = new Map(zip.entries.map((e, i) => [e.path.toLowerCase(), i]));
  const decoder = new TextDecoder();
  const raw = (path: string): Uint8Array<ArrayBuffer> | null => {
    const i = index.get(path.toLowerCase());
    const entry = i === undefined ? undefined : zip.entries[i];
    const record = i === undefined ? undefined : zip.records[i];
    if (!entry || !record || entry.isDir) return null;
    try {
      checkGuard(entry, false);
      return extractZipEntry(bytes, entry, record, false);
    } catch {
      return null;
    }
  };
  return {
    raw,
    text: (path: string) => {
      const b = raw(path);
      return b ? decoder.decode(b) : null;
    },
    xml: (path: string) => {
      const b = raw(path);
      return b ? parseXml(decoder.decode(b)) : null;
    },
  };
}

type Reader = ReturnType<typeof partReader>;

const placeholderType = (sp: XmlNode) => {
  const ph = at(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph');
  // A placeholder without a type is a body placeholder
  return ph ? (ph.attrs.type ?? 'body') : null;
};

const nonEmpty = (paras: string[]) => paras.filter(p => p.trim() !== '');

/** Paragraphs under `node`, skipping shapes for which `skip` says so. */
function paragraphs(node: XmlNode, skip: (sp: XmlNode) => boolean): string[] {
  const out: string[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === 'p:sp' && skip(c)) continue;
      if (c.name === 'a:p') out.push(paragraphText(c));
      else walk(c);
    }
  };
  walk(node);
  return nonEmpty(out);
}

/** Shapes (also inside groups) in document order. */
function shapes(node: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === 'p:sp') out.push(c);
      else if (c.name === 'p:grpSp' || c.name === 'p:spTree') walk(c);
    }
  };
  walk(node);
  return out;
}

function slideText(root: XmlNode): { title: string | null; paragraphs: string[] } {
  const tree = at(root, 'p:cSld', 'p:spTree');
  if (!tree) return { title: null, paragraphs: [] };
  const titleShape = shapes(tree).find(sp => TITLE_TYPES.has(placeholderType(sp) ?? ''));
  const title = titleShape
    ? paragraphs(titleShape, () => false)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  return {
    title: title || null,
    paragraphs: paragraphs(tree, sp => {
      const type = placeholderType(sp);
      return sp === titleShape || (type !== null && SKIPPED_TYPES.has(type));
    }),
  };
}

/** Speaker notes: the notes page's body placeholder(s). */
function notesText(root: XmlNode | null): string[] {
  const tree = root && at(root, 'p:cSld', 'p:spTree');
  if (!tree) return [];
  return shapes(tree)
    .filter(sp => placeholderType(sp) === 'body')
    .flatMap(sp => paragraphs(sp, () => false));
}

/** Relationship ids referenced by a part (`r:embed`, `r:link`, `r:id`), in document order. */
function relIds(root: XmlNode): string[] {
  const out: string[] = [];
  const walk = (n: XmlNode) => {
    for (const key of ['r:embed', 'r:link', 'r:id']) {
      const id = n.attrs[key];
      if (id) out.push(id);
    }
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** Slide part paths in deck order (`sldIdLst`), falling back to the relationships' order. */
function slideOrder(read: Reader): string[] {
  const rels = parseRels(PRESENTATION_PART, read.text(relsPath(PRESENTATION_PART)));
  const root = read.xml(PRESENTATION_PART);
  const list = root && at(root, 'p:sldIdLst');
  const ordered = list
    ? childrenNamed(list, 'p:sldId').flatMap(s => {
        const r = rels.get(s.attrs['r:id'] ?? '');
        return r && !r.external && relType(r) === 'slide' ? [r.target] : [];
      })
    : [];
  if (ordered.length > 0) return ordered;
  const num = (p: string) => Number(/(\d+)\.xml$/.exec(p)?.[1] ?? 0);
  return [...rels.values()]
    .filter(r => !r.external && relType(r) === 'slide')
    .map(r => r.target)
    .sort((a, b) => num(a) - num(b));
}

function readMeta(read: Reader): PresentationMeta {
  const root = read.xml('docProps/core.xml');
  const field = (name: string) => {
    const node = root && child(root, name);
    const text = node ? textOf(node).trim() : '';
    return text || null;
  };
  return {
    title: field('dc:title'),
    author: field('dc:creator'),
    lastModifiedBy: field('cp:lastModifiedBy'),
    created: field('dcterms:created'),
    modified: field('dcterms:modified'),
  };
}

export function parsePresentation(
  bytes: Uint8Array<ArrayBuffer>,
  zip: ZipListing,
): PresentationValue {
  const read = partReader(bytes, zip);
  const pres = read.xml(PRESENTATION_PART);
  if (!pres) throw new Error('ppt/presentation.xml is missing or malformed');

  const media: PresentationMedia[] = zip.entries
    .filter(e => !e.isDir && e.path.startsWith(MEDIA_DIR))
    .map(e => ({ path: e.path, mime: guessMime(e.path), size: e.size }));
  const mediaIndex = new Map(media.map((m, i) => [m.path.toLowerCase(), i]));

  const slides: Slide[] = slideOrder(read).map((path, i) => {
    const root = read.xml(path);
    const rels = parseRels(path, read.text(relsPath(path)));
    // Media in the order the slide refers to it, then any other related media
    const used: number[] = [];
    for (const id of [...(root ? relIds(root) : []), ...rels.keys()]) {
      const r = rels.get(id);
      const m = r && !r.external ? mediaIndex.get(r.target.toLowerCase()) : undefined;
      if (m !== undefined && !used.includes(m)) used.push(m);
    }
    const notesRel = [...rels.values()].find(r => !r.external && relType(r) === 'notesSlide');
    const notes = notesRel ? notesText(read.xml(notesRel.target)) : [];
    return {
      number: i + 1,
      path,
      ...(root ? slideText(root) : { title: null, paragraphs: [] }),
      notes,
      media: used,
      hidden: root?.attrs.show === '0',
    };
  });

  const size = child(pres, 'p:sldSz');
  const cx = Number(size?.attrs.cx);
  const cy = Number(size?.attrs.cy);
  return {
    kind: 'presentation',
    meta: readMeta(read),
    slideSize: cx > 0 && cy > 0 ? { width: cx, height: cy } : null,
    slides,
    media,
    zip: { bytes, entries: zip.entries, records: zip.records },
  };
}

/** One media file's bytes, after the archive's size/ratio guard. */
export function readMedia(v: PresentationValue, index: number): Uint8Array<ArrayBuffer> {
  const m = v.media[index];
  if (!m) throw new Error(`No media file ${index}`);
  const i = v.zip.entries.findIndex(e => e.path === m.path);
  const entry = v.zip.entries[i];
  const record = v.zip.records[i];
  if (!entry || !record) throw new Error(`${m.path} is missing from the zip`);
  checkGuard(entry, false);
  return extractZipEntry(v.zip.bytes, entry, record, false);
}
