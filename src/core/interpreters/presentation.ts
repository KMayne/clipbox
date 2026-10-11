import { formatBytes, formatCount, plural } from '../format';
import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { detectMagic, MAGIC_MIME } from '../magic';
import { slidesMarkdown } from '../presentation/output';
import { isPresentationZip, parsePresentation, readMedia } from '../presentation/parse';
import {
  slideRatio,
  slideSizeText,
  type PresentationLayout,
  type PresentationValue,
} from '../presentation/types';
import type { StatRow } from '../types';
import { zipListing } from './archive';

/** Above the generic archive kind (0.5 for Office zips), which stays on offer. */
const CONFIDENCE = 0.95;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|bmp|webp|svg|tiff?|emf|wmf|ico|wdp|jxr)$/i;

const isImage = (path: string) => IMAGE_EXTENSIONS.test(path);

function presentationStats(v: PresentationValue): StatRow[] {
  const m = v.meta;
  const dash = (s: string | null) => s ?? '—';
  const hidden = v.slides.filter(s => s.hidden).length;
  const images = v.media.filter(x => isImage(x.path));
  const mediaBytes = v.media.reduce((n, x) => n + x.size, 0);
  const used = new Set(v.slides.flatMap(s => s.media));
  const unused = v.media.length - v.media.filter((_, i) => used.has(i)).length;
  const words = v.slides
    .flatMap(s => [s.title ?? '', ...s.paragraphs])
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return [
    { label: 'Slides', value: formatCount(v.slides.length) },
    ...(hidden > 0 ? [{ label: 'Hidden slides', value: formatCount(hidden) }] : []),
    { label: 'Title', value: dash(m.title) },
    { label: 'Author', value: dash(m.author) },
    ...(m.lastModifiedBy ? [{ label: 'Last modified by', value: m.lastModifiedBy }] : []),
    { label: 'Created', value: dash(m.created) },
    { label: 'Modified', value: dash(m.modified) },
    { label: 'Slide size', value: v.slideSize ? slideSizeText(v.slideSize) : '—' },
    { label: 'Words', value: formatCount(words) },
    {
      label: 'Slides with notes',
      value: formatCount(v.slides.filter(s => s.notes.length > 0).length),
    },
    { label: 'Images', value: formatCount(images.length) },
    {
      label: 'Media files',
      value:
        v.media.length > 0 ? `${plural(v.media.length, 'file')} · ${formatBytes(mediaBytes)}` : '0',
      ...(v.media.length > 0 && {
        children: v.media.map(x => ({
          label: x.path.slice(x.path.lastIndexOf('/') + 1),
          value: formatBytes(x.size),
        })),
      }),
    },
    ...(unused > 0 ? [{ label: 'Unused media', value: formatCount(unused) }] : []),
    { label: 'File size', value: formatBytes(v.zip.bytes.byteLength) },
  ];
}

/** PowerPoint 2007+ (.pptx, .ppsx, .potx): slide text, notes and pictures; nothing is rendered. */
export const presentationInterpreter: Interpreter<PresentationValue> = {
  kind: 'presentation',
  isValue: (v): v is PresentationValue => hasKind(v, 'presentation'),
  detect(c) {
    const zip = zipListing(c);
    return zip && isPresentationZip(zip) ? CONFIDENCE : 0;
  },
  parse(c) {
    const zip = zipListing(c);
    if (!zip || !isPresentationZip(zip)) throw new Error('Not a PowerPoint file');
    return parsePresentation(c.bytes, zip);
  },
  label(v) {
    const ratio = v.slideSize && slideRatio(v.slideSize);
    return ['PowerPoint', plural(v.slides.length, 'slide'), ...(ratio ? [ratio] : [])].join(' · ');
  },
  summarise: v => ({ stats: presentationStats(v), extent: v.slides.length }),
  slice(v, req) {
    switch (req.type) {
      case 'json':
        return {
          meta: v.meta,
          slideSize: v.slideSize,
          slides: v.slides,
          media: v.media,
        } satisfies PresentationLayout;
      case 'asset': {
        const bytes = readMedia(v, req.index);
        const magic = detectMagic(bytes);
        return { bytes, mime: magic ? MAGIC_MIME[magic] : (v.media[req.index]?.mime ?? '') };
      }
      case 'text':
        return slidesMarkdown(v);
      default:
        return unsupportedSlice('presentation', req);
    }
  },
  export: v => ({ text: slidesMarkdown(v) }),
};
