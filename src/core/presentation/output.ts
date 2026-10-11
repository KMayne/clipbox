/** Text and JSON renderings of a deck, shared by the interpreter (copy) and the actions. */

import { throwIfAborted, type TaskContext } from '../progress';
import { sha256 } from '../hash';
import { MAGIC_EXTENSION, MAGIC_MIME, detectMagic, isImageMagic } from '../magic';
import { LEGACY_IMAGE_INFO, sniffLegacyImage } from '../../modules/imageformats/detect';
import { readMedia } from './parse';
import type { PresentationValue, Slide } from './types';

/** "## Slide 3: Title" plus its text, and its notes under "### Notes". */
export function slidesMarkdown(v: PresentationValue, includeNotes = true): string {
  const block = (paras: string[]) => paras.map(p => p.replace(/\n/g, '  \n')).join('\n\n');
  const parts: string[] = [];
  if (v.meta.title) parts.push(`# ${v.meta.title}`);
  for (const s of v.slides) {
    const heading = `## Slide ${s.number}${s.title ? `: ${s.title}` : ''}${s.hidden ? ' (hidden)' : ''}`;
    parts.push(heading);
    if (s.paragraphs.length > 0) parts.push(block(s.paragraphs));
    if (includeNotes && s.notes.length > 0) parts.push('### Notes', block(s.notes));
  }
  return `${parts.join('\n\n')}\n`;
}

/** The structured value for "Slides as JSON": metadata plus each slide's text, notes and media paths. */
export function slidesJson(v: PresentationValue) {
  return {
    ...v.meta,
    slideSize: v.slideSize && { widthEmu: v.slideSize.width, heightEmu: v.slideSize.height },
    slides: v.slides.map((s: Slide) => ({
      number: s.number,
      title: s.title,
      hidden: s.hidden,
      text: s.paragraphs,
      notes: s.notes,
      media: s.media.flatMap(i => v.media[i]?.path ?? []),
    })),
    unusedMedia: unusedMedia(v).flatMap(i => v.media[i]?.path ?? []),
  };
}

/** Indexes of media no slide refers to. */
function unusedMedia(v: PresentationValue): number[] {
  const used = new Set(v.slides.flatMap(s => s.media));
  return v.media.flatMap((_, i) => (used.has(i) ? [] : [i]));
}

export interface DeckImage {
  /** e.g. "slide-03-image2.png", or "unused-image1.png" for media no slide uses. */
  name: string;
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** Renders an EMF, WMF or TIFF (etc.) to one PNG per page; null if it can't. */
export type LegacyConverter = (
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
) => Promise<Uint8Array<ArrayBuffer>[] | null>;

/**
 * Every distinct image in `ppt/media`, in order of first use by the slides in `slides` (1-based
 * numbers; all when omitted), then the unused ones (only when extracting every slide).
 * Duplicates are dropped by content. Formats a browser can't show (EMF, WMF, TIFF) come out as
 * the original files, or as PNG renders when `convert` is given.
 */
export async function deckImages(
  v: PresentationValue,
  slides?: Set<number>,
  limit = Infinity,
  convert?: LegacyConverter,
  task?: TaskContext,
): Promise<{ images: DeckImage[]; truncated: boolean }> {
  const order: { media: number; prefix: string }[] = [];
  const seen = new Set<number>();
  for (const s of v.slides) {
    if (slides && !slides.has(s.number)) continue;
    for (const m of s.media) {
      if (seen.has(m)) continue;
      seen.add(m);
      order.push({ media: m, prefix: `slide-${String(s.number).padStart(2, '0')}` });
    }
  }
  if (!slides) {
    for (const m of unusedMedia(v)) order.push({ media: m, prefix: 'unused' });
  }

  const hashes = new Set<string>();
  const counts = new Map<string, number>();
  const images: DeckImage[] = [];
  for (const [i, { media, prefix }] of order.entries()) {
    throwIfAborted(task?.signal);
    task?.progress(i / order.length, `Image ${i + 1} of ${order.length}`);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = readMedia(v, media);
    } catch {
      continue; // damaged or guarded entries are skipped
    }
    const path = v.media[media]?.path ?? '';
    const magic = detectMagic(bytes);
    const web = magic && isImageMagic(magic) ? magic : null;
    const legacy = web ? null : sniffLegacyImage(bytes, path);
    if (!web && !legacy) continue;
    const hash = await sha256(bytes);
    if (hashes.has(hash)) continue;
    if (images.length >= limit) return { images, truncated: true };
    hashes.add(hash);
    const n = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, n);
    const stem = `${prefix}-image${n}`;
    if (web) {
      images.push({ name: `${stem}.${MAGIC_EXTENSION[web]}`, mime: MAGIC_MIME[web], bytes });
      continue;
    }
    const info = legacy ? LEGACY_IMAGE_INFO[legacy] : null;
    if (!info) continue;
    const pngs = convert ? await convert(bytes, path).catch(() => null) : null;
    if (!pngs?.length) {
      images.push({ name: `${stem}.${info.extension}`, mime: info.mime, bytes });
      continue;
    }
    pngs.forEach((png, i) => {
      const page = pngs.length > 1 ? `-page${i + 1}` : '';
      images.push({ name: `${stem}${page}.png`, mime: 'image/png', bytes: png });
    });
  }
  return { images, truncated: false };
}
