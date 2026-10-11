import {
  InvalidPDFException,
  PasswordException,
  PDFDateString,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import { formatBytes, formatCount, plural } from '../../core/format';
import { hasKind, isRecord } from '../../core/guards';
import { unsupportedSlice, type Interpreter } from '../../core/interpreter';
import type { Derivation, StatRow } from '../../core/types';
import { openDocument, renderPage } from './pdfjs';
import type { PageSize, PdfLayout } from './types';

export interface OutlineNode {
  title: string;
  /** 0-based page the entry points at, if it could be resolved. */
  page: number | null;
  children: OutlineNode[];
}

export interface PdfMeta {
  title: string | null;
  author: string | null;
  subject: string | null;
  producer: string | null;
  creator: string | null;
  /** ISO 8601 */
  created: string | null;
  modified: string | null;
}

export interface PdfInfo {
  pageCount: number;
  /** From the header, e.g. "1.7"; pdf.js's value once opened. */
  version: string | null;
  meta: PdfMeta;
  encrypted: boolean;
  pageSizes: PageSize[];
  hasText: boolean;
  outline: OutlineNode[];
  attachments: number;
  /** Set when the document couldn't be opened (password required, damaged). */
  error: string | null;
}

export interface PdfValue {
  kind: 'pdf';
  name?: string;
  info: PdfInfo;
  /** Null when the document couldn't be opened. */
  doc: PDFDocumentProxy | null;
}

/** Derived page images are rendered at 144 dpi. */
const DERIVED_SCALE = 2;
const MAX_DERIVED_PAGES = 10;
/** Keeps a rendered page to ~16 megapixels whatever scale is asked for. */
const MAX_PIXELS = 16_000_000;
const TEXT_SAMPLE_PAGES = 5;
const MAX_OUTLINE_DEPTH = 8;

const NO_META: PdfMeta = {
  title: null,
  author: null,
  subject: null,
  producer: null,
  creator: null,
  created: null,
  modified: null,
};

// --- Page sizes ---

const PAPER: [string, number, number][] = [
  ['A3', 842, 1191],
  ['A4', 595, 842],
  ['A5', 420, 595],
  ['Letter', 612, 792],
  ['Legal', 612, 1008],
  ['Tabloid', 792, 1224],
];

/** e.g. "A4", "Letter landscape", "300×200 pt". */
export function paperName({ width, height }: PageSize): string {
  const [short, long] = width <= height ? [width, height] : [height, width];
  const match = PAPER.find(([, w, h]) => Math.abs(short - w) <= 3 && Math.abs(long - h) <= 3);
  if (!match) return `${Math.round(width)}×${Math.round(height)} pt`;
  return width > height ? `${match[0]} landscape` : match[0];
}

/** Distinct paper names with their page counts, most common first. */
function sizeCounts(sizes: PageSize[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const s of sizes) counts.set(paperName(s), (counts.get(paperName(s)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function sizeSummary(sizes: PageSize[]): string | null {
  const counts = sizeCounts(sizes);
  if (counts.length === 0) return null;
  return counts.length === 1 ? (counts[0]?.[0] ?? null) : 'mixed sizes';
}

// --- Parsing ---

const str = (r: Record<string, unknown>, key: string): string | null => {
  const v = r[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

const isoDate = (raw: string | null): string | null => {
  if (!raw) return null;
  const d = PDFDateString.toDateObject(raw);
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : raw;
};

function headerVersion(bytes: Uint8Array): string | null {
  const head = String.fromCharCode(...bytes.subarray(0, 16));
  return /^%PDF-(\d+\.\d+)/.exec(head)?.[1] ?? null;
}

/** Byte search for an ASCII token, e.g. the trailer's `/Encrypt` key. */
export function containsAscii(bytes: Uint8Array, token: string): boolean {
  const t = [...token].map(c => c.charCodeAt(0));
  const first = t[0];
  if (first === undefined) return false;
  for (let i = bytes.indexOf(first); i !== -1; i = bytes.indexOf(first, i + 1)) {
    if (t.every((b, j) => bytes[i + j] === b)) return true;
  }
  return false;
}

async function destPage(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) return null;
    const [target]: unknown[] = explicit;
    if (typeof target === 'number') return target;
    if (isRecord(target) && typeof target.num === 'number' && typeof target.gen === 'number') {
      return await doc.getPageIndex({ num: target.num, gen: target.gen });
    }
  } catch {
    // Broken destinations just lose their page number
  }
  return null;
}

async function outlineNodes(
  doc: PDFDocumentProxy,
  items: unknown,
  depth = 0,
): Promise<OutlineNode[]> {
  if (!Array.isArray(items) || depth > MAX_OUTLINE_DEPTH) return [];
  const out: OutlineNode[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    out.push({
      title: typeof item.title === 'string' ? item.title : '(untitled)',
      page: await destPage(doc, item.dest),
      children: await outlineNodes(doc, item.items, depth + 1),
    });
  }
  return out;
}

async function pageText(doc: PDFDocumentProxy, index: number): Promise<string> {
  const page = await doc.getPage(index + 1);
  const content = await page.getTextContent();
  let text = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text.trimEnd();
}

async function describe(doc: PDFDocumentProxy, bytes: Uint8Array): Promise<PdfInfo> {
  const { info } = await doc.getMetadata();
  const meta = isRecord(info) ? info : {};
  const pageSizes: PageSize[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    const { width, height } = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
    pageSizes.push({ width, height });
  }
  let hasText = false;
  for (let i = 0; i < Math.min(doc.numPages, TEXT_SAMPLE_PAGES) && !hasText; i++) {
    hasText = (await pageText(doc, i)).trim() !== '';
  }
  const attachments = await doc.getAttachments();
  return {
    pageCount: doc.numPages,
    version: str(meta, 'PDFFormatVersion') ?? headerVersion(bytes),
    meta: {
      title: str(meta, 'Title'),
      author: str(meta, 'Author'),
      subject: str(meta, 'Subject'),
      producer: str(meta, 'Producer'),
      creator: str(meta, 'Creator'),
      created: isoDate(str(meta, 'CreationDate')),
      modified: isoDate(str(meta, 'ModDate')),
    },
    encrypted: containsAscii(bytes, '/Encrypt'),
    pageSizes,
    hasText,
    outline: await outlineNodes(doc, await doc.getOutline()),
    // A Map in current pdf.js; a plain object in older versions
    attachments:
      attachments instanceof Map
        ? attachments.size
        : isRecord(attachments)
          ? Object.keys(attachments).length
          : 0,
    error: null,
  };
}

/** Never throws for content with a PDF header: failures become an `error` the UI shows. */
export async function parsePdf(bytes: Uint8Array, name?: string): Promise<PdfValue> {
  const failed = (error: string, encrypted: boolean): PdfValue => ({
    kind: 'pdf',
    name,
    doc: null,
    info: {
      pageCount: 0,
      version: headerVersion(bytes),
      meta: NO_META,
      encrypted,
      pageSizes: [],
      hasText: false,
      outline: [],
      attachments: 0,
      error,
    },
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await openDocument(bytes);
  } catch (err) {
    if (err instanceof PasswordException) return failed('Encrypted: a password is required', true);
    const detail = err instanceof Error ? err.message : String(err);
    const prefix = err instanceof InvalidPDFException ? 'Damaged PDF' : 'Could not open PDF';
    return failed(`${prefix}: ${detail}`, containsAscii(bytes, '/Encrypt'));
  }
  try {
    return { kind: 'pdf', name, doc, info: await describe(doc, bytes) };
  } catch (err) {
    void doc.loadingTask.destroy();
    return failed(`Damaged PDF: ${err instanceof Error ? err.message : String(err)}`, false);
  }
}

// --- Text ---

const texts = new WeakMap<PDFDocumentProxy, Promise<string>>();

/** All pages' text, separated by form feeds. Memoised per document. */
export function extractText(doc: PDFDocumentProxy): Promise<string> {
  let text = texts.get(doc);
  if (!text) {
    text = (async () => {
      const pages: string[] = [];
      for (let i = 0; i < doc.numPages; i++) pages.push(await pageText(doc, i));
      return pages.join('\n\f\n');
    })();
    text.catch(() => texts.delete(doc));
    texts.set(doc, text);
  }
  return text;
}

// --- Presentation ---

export function pdfLabel(info: PdfInfo): string {
  if (info.error) return info.encrypted ? 'PDF · encrypted' : 'PDF · damaged';
  const size = sizeSummary(info.pageSizes);
  return ['PDF', plural(info.pageCount, 'page'), ...(size ? [size] : [])].join(' · ');
}

const entries = (n: number) => `${formatCount(n)} ${n === 1 ? 'entry' : 'entries'}`;

const countOutline = (nodes: OutlineNode[]): number =>
  nodes.reduce((n, o) => n + 1 + countOutline(o.children), 0);

const outlineRows = (nodes: OutlineNode[]): StatRow[] =>
  nodes.map(o => ({
    label: o.title,
    value: o.page === null ? '' : `p. ${o.page + 1}`,
    ...(o.children.length > 0 && { children: outlineRows(o.children) }),
  }));

export function pdfStats(info: PdfInfo, bytes: number): StatRow[] {
  const m = info.meta;
  const dash = (s: string | null) => s ?? '—';
  const counts = sizeCounts(info.pageSizes);
  const rows: StatRow[] = [
    ...(info.error ? [{ label: 'Error', value: info.error }] : []),
    { label: 'Pages', value: formatCount(info.pageCount) },
    { label: 'PDF version', value: dash(info.version) },
    { label: 'Title', value: dash(m.title) },
    { label: 'Author', value: dash(m.author) },
    ...(m.subject ? [{ label: 'Subject', value: m.subject }] : []),
    { label: 'Producer', value: dash(m.producer) },
    { label: 'Creator', value: dash(m.creator) },
    { label: 'Created', value: dash(m.created) },
    { label: 'Modified', value: dash(m.modified) },
    { label: 'Encrypted', value: info.encrypted ? 'yes' : 'no' },
  ];
  if (!info.error) {
    rows.push(
      {
        label: 'Page size',
        value: sizeSummary(info.pageSizes) ?? '—',
        ...(counts.length > 1 && {
          children: counts.map(([name, n]) => ({ label: name, value: plural(n, 'page') })),
        }),
      },
      { label: 'Text layer', value: info.hasText ? 'yes' : 'no' },
      {
        label: 'Outline',
        value: info.outline.length > 0 ? entries(countOutline(info.outline)) : 'none',
        ...(info.outline.length > 0 && { children: outlineRows(info.outline) }),
      },
      { label: 'Attachments', value: formatCount(info.attachments) },
    );
  }
  rows.push({ label: 'Bytes', value: formatBytes(bytes) });
  return rows;
}

export function pdfDerivations(info: PdfInfo): Derivation[] {
  if (info.error) return [];
  const pages = Array.from({ length: Math.min(info.pageCount, MAX_DERIVED_PAGES) }, (_, i) => ({
    id: `page-${i + 1}`,
    label: `Page ${i + 1} as PNG`,
  }));
  return [{ id: 'text', label: 'Extract text' }, ...pages];
}

/** Clamps a requested render scale to something sane for the page's size. */
export function clampScale(size: PageSize, scale: number): number {
  const s = Number.isFinite(scale) && scale > 0 ? Math.min(scale, 8) : 1;
  const max = Math.sqrt(MAX_PIXELS / Math.max(1, size.width * size.height));
  return Math.max(0.05, Math.min(s, max));
}

const baseName = (name?: string) => (name ? name.replace(/\.pdf$/i, '') : 'document');

function openDoc(v: PdfValue): PDFDocumentProxy {
  if (!v.doc) throw new Error(v.info.error ?? 'PDF is not open');
  return v.doc;
}

async function pagePng(v: PdfValue, index: number, scale: number) {
  const size = v.info.pageSizes[index];
  if (!Number.isInteger(index) || !size) throw new Error(`No page ${index + 1}`);
  return renderPage(openDoc(v), index, clampScale(size, scale));
}

// Lives in the worker only, so `bytes` aren't kept on the value: the engine keeps the entry's.
const sizes = new WeakMap<PdfValue, number>();

export const pdfInterpreter: Interpreter<PdfValue> = {
  kind: 'pdf',
  isValue: (v): v is PdfValue => hasKind(v, 'pdf'),
  // Real detection is the cheap core detector in ./detect.ts
  detect: c => (c.magic === 'pdf' ? 1 : 0),
  async parse(c) {
    const v = await parsePdf(c.bytes, c.name);
    sizes.set(v, c.size);
    return v;
  },
  label: v => pdfLabel(v.info),
  summarise: v => ({
    stats: pdfStats(v.info, sizes.get(v) ?? 0),
    extent: v.info.pageCount,
  }),
  async slice(v, req) {
    switch (req.type) {
      case 'page':
        return { bytes: await pagePng(v, req.index, req.scale), mime: 'image/png' };
      case 'json':
        return { pages: v.info.pageSizes, error: v.info.error } satisfies PdfLayout;
      case 'text':
        return extractText(openDoc(v));
      default:
        return unsupportedSlice('pdf', req);
    }
  },
  async export(v) {
    return v.doc ? { text: await extractText(v.doc) } : {};
  },
  derivations: v => pdfDerivations(v.info),
  async derive(v, id) {
    const base = baseName(v.name);
    if (id === 'text') {
      return {
        mime: 'text/plain',
        name: `${base}.txt`,
        bytes: new TextEncoder().encode(await extractText(openDoc(v))),
      };
    }
    const page = /^page-(\d+)$/.exec(id)?.[1];
    if (!page) throw new Error(`Unknown derivation '${id}'`);
    return {
      mime: 'image/png',
      name: `${base}-page-${page}.png`,
      bytes: await pagePng(v, Number(page) - 1, DERIVED_SCALE),
    };
  },
};
