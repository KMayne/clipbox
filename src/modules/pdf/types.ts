import { z } from 'zod';
import { isRecord } from '../../core/guards';
import type { DerivedContent } from '../../core/types';

/** Display data for a PDF; shared by the worker interpreter and the core PdfView preview. */

/** Page size in points (1/72 in), after rotation. */
export interface PageSize {
  width: number;
  height: number;
}

/** What the preview needs to lay out its page list: the `json` slice of a pdf value. */
export interface PdfLayout {
  pages: PageSize[];
  /** Why the document can't be shown (encrypted, damaged), if so. */
  error: string | null;
}

export const pdfLayoutSchema: z.ZodType<PdfLayout> = z.object({
  pages: z.array(z.object({ width: z.number(), height: z.number() })),
  error: z.string().nullable(),
});

// --- Image extraction (the module's service; the core action reaches it via ctx.service) ---

export interface PdfImageOptions {
  /** 1-based page numbers, or null for every page. */
  pages: number[] | null;
  /** Images narrower or shorter than this (in image pixels) are skipped. */
  minSize: number;
  /** Stop after this many images (and say so with `truncated`). */
  max: number;
}

export interface PdfImageResult {
  /** PNGs named like "page-03-image1.png". */
  images: DerivedContent[];
  truncated: boolean;
}

export interface PdfImageService {
  extractImages(value: unknown, options: PdfImageOptions): Promise<PdfImageResult>;
}

export const isPdfImageService = (s: unknown): s is PdfImageService =>
  isRecord(s) && typeof s.extractImages === 'function';

/** The part of a pdf value the core action reads, checked without importing pdf.js. */
export interface PdfValueInfo {
  kind: 'pdf';
  info: { pageCount: number; error: string | null };
}

export const isPdfValueInfo = (v: unknown): v is PdfValueInfo =>
  isRecord(v) &&
  v.kind === 'pdf' &&
  isRecord(v.info) &&
  typeof v.info.pageCount === 'number' &&
  (v.info.error === null || typeof v.info.error === 'string');
