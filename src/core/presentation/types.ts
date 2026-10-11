/**
 * PowerPoint (.pptx) values, and the display model the preview reads (validated with Zod, since
 * it arrives from the worker). No heavy imports: the UI loads this file too.
 */

import { z } from 'zod';
import type { ArchiveEntry, ZipRecord } from '../archive/types';

/** A file under `ppt/media/`, referenced by slides (or not at all). */
export interface PresentationMedia {
  /** Zip path, e.g. "ppt/media/image1.png". */
  path: string;
  /** From the extension; the magic bytes decide when the file is served. */
  mime: string;
  size: number;
}

export interface Slide {
  /** 1-based position in the deck. */
  number: number;
  /** Zip path of the slide part. */
  path: string;
  /** Text of the title (or centred title) placeholder. */
  title: string | null;
  /** Text paragraphs in document order, the title's excluded. */
  paragraphs: string[];
  /** Speaker notes, one string per paragraph. */
  notes: string[];
  /** Indexes into `PresentationValue.media`, in first-reference order. */
  media: number[];
  /** `show="0"`: skipped in a slideshow. */
  hidden: boolean;
}

export interface PresentationMeta {
  title: string | null;
  author: string | null;
  lastModifiedBy: string | null;
  /** ISO 8601 */
  created: string | null;
  modified: string | null;
}

/** EMU (914,400 per inch). */
export interface SlideSize {
  width: number;
  height: number;
}

export interface PresentationValue {
  kind: 'presentation';
  meta: PresentationMeta;
  slideSize: SlideSize | null;
  slides: Slide[];
  media: PresentationMedia[];
  /** Zip contents, for reading media on demand. */
  zip: { bytes: Uint8Array<ArrayBuffer>; entries: ArchiveEntry[]; records: ZipRecord[] };
}

/** The `json` slice: everything but the zip. */
export type PresentationLayout = Omit<PresentationValue, 'kind' | 'zip'>;

const nullableString = z.string().nullable();

export const presentationLayoutSchema: z.ZodType<PresentationLayout> = z.object({
  meta: z.object({
    title: nullableString,
    author: nullableString,
    lastModifiedBy: nullableString,
    created: nullableString,
    modified: nullableString,
  }),
  slideSize: z.object({ width: z.number(), height: z.number() }).nullable(),
  slides: z.array(
    z.object({
      number: z.number(),
      path: z.string(),
      title: nullableString,
      paragraphs: z.array(z.string()),
      notes: z.array(z.string()),
      media: z.array(z.number().int().nonnegative()),
      hidden: z.boolean(),
    }),
  ),
  media: z.array(z.object({ path: z.string(), mime: z.string(), size: z.number() })),
});

const EMU_PER_INCH = 914_400;

const RATIOS: [string, number][] = [
  ['16:9', 16 / 9],
  ['16:10', 16 / 10],
  ['4:3', 4 / 3],
  ['3:2', 3 / 2],
  ['1:1', 1],
];

/** The aspect ratio when it has a common name, e.g. "16:9". */
export function slideRatio({ width, height }: SlideSize): string | null {
  const ratio = height > 0 ? width / height : 0;
  return RATIOS.find(([, r]) => Math.abs(r - ratio) < 0.01)?.[0] ?? null;
}

/** e.g. "13.33 × 7.5 in (16:9)". */
export function slideSizeText(size: SlideSize): string {
  const inches = (emu: number) => String(Number((emu / EMU_PER_INCH).toFixed(2)));
  const named = slideRatio(size);
  return `${inches(size.width)} × ${inches(size.height)} in${named ? ` (${named})` : ''}`;
}
