import type { PDFDocumentProxy } from 'pdfjs-dist';
import { isRecord } from '../../core/guards';
import { paperName, type OutlineNode, type PdfValue } from './pdf';

type Metadata = Awaited<ReturnType<PDFDocumentProxy['getMetadata']>>['metadata'];

/** JSON-friendly copy of pdf.js values: Name objects become their name, bytes their length. */
function plain(v: unknown, depth = 0): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    return v;
  if (depth > 6) return null;
  if (v instanceof Uint8Array) return `<${v.byteLength} bytes>`;
  if (Array.isArray(v)) return v.map(x => plain(x, depth + 1));
  if (v instanceof Map) return plain(Object.fromEntries(v), depth);
  if (isRecord(v)) {
    // pdf.js Name objects: { name: 'Foo' }
    const keys = Object.keys(v);
    if (keys.length === 1 && typeof v.name === 'string') return v.name;
    return Object.fromEntries(keys.map(k => [k, plain(v[k], depth + 1)]));
  }
  return null;
}

/** The XMP packet's properties (dc:title, xmp:CreateDate…), as pdf.js parsed them. */
function xmpOf(metadata: Metadata | null): Record<string, unknown> | null {
  // pdf.js types it as always present, but it's null without an XMP stream
  if (!metadata) return null;
  const out: Record<string, unknown> = {};
  for (const entry of metadata) {
    const pair: unknown = entry;
    if (Array.isArray(pair) && typeof pair[0] === 'string') out[pair[0]] = plain(pair[1]);
  }
  return Object.keys(out).length ? out : null;
}

const outline = (nodes: OutlineNode[]): unknown[] =>
  nodes.map(n => ({
    title: n.title,
    page: n.page === null ? null : n.page + 1,
    ...(n.children.length > 0 && { children: outline(n.children) }),
  }));

async function attachments(doc: PDFDocumentProxy) {
  const found: unknown = await doc.getAttachments();
  const list =
    found instanceof Map ? [...found.values()] : isRecord(found) ? Object.values(found) : [];
  return list.filter(isRecord).map(a => ({
    name: typeof a.filename === 'string' ? a.filename : '',
    ...(typeof a.description === 'string' && a.description && { description: a.description }),
    ...(a.content instanceof Uint8Array && { bytes: a.content.byteLength }),
  }));
}

/** Everything the document says about itself, for "Metadata as JSON". */
export async function pdfMetadata(v: PdfValue): Promise<Record<string, unknown>> {
  const { info } = v;
  const base = {
    ...(v.name && { file: v.name }),
    version: info.version,
    pageCount: info.pageCount,
    encrypted: info.encrypted,
    ...(info.error && { error: info.error }),
    document: info.meta,
  };
  const doc = v.doc;
  if (!doc) return base;
  const { info: dict, metadata } = await doc.getMetadata();
  const labels = await doc.getPageLabels().catch(() => null);
  return {
    ...base,
    info: plain(dict),
    xmp: xmpOf(metadata),
    pages: info.pageSizes.map((s, i) => ({
      page: i + 1,
      ...(labels?.[i] && labels[i] !== String(i + 1) && { label: labels[i] }),
      width: Math.round(s.width * 100) / 100,
      height: Math.round(s.height * 100) / 100,
      size: paperName(s),
    })),
    outline: outline(info.outline),
    attachments: await attachments(doc),
  };
}
