/** Text and JSON renderings of a deck, shared by the interpreter (copy) and the actions. */

import { sha256 } from '../hash';
import { MAGIC_EXTENSION, MAGIC_MIME, detectMagic, isImageMagic } from '../magic';
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

/**
 * Every distinct image in `ppt/media`, in order of first use by the slides in `slides` (1-based
 * numbers; all when omitted), then the unused ones (only when extracting every slide). Formats
 * a browser can't show (EMF, WMF, TIFF) are skipped; duplicates are dropped by content.
 */
export async function deckImages(
  v: PresentationValue,
  slides?: Set<number>,
  limit = Infinity,
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
  for (const { media, prefix } of order) {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = readMedia(v, media);
    } catch {
      continue; // damaged or guarded entries are skipped
    }
    const magic = detectMagic(bytes);
    if (!magic || !isImageMagic(magic)) continue;
    const hash = await sha256(bytes);
    if (hashes.has(hash)) continue;
    if (images.length >= limit) return { images, truncated: true };
    hashes.add(hash);
    const n = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, n);
    images.push({
      name: `${prefix}-image${n}.${MAGIC_EXTENSION[magic]}`,
      mime: MAGIC_MIME[magic],
      bytes,
    });
  }
  return { images, truncated: false };
}
