import type { Interpreter } from '../../core/interpreter';
import { imageInterpreter, type ImageValue } from '../../core/interpreters/image';
import { imageDimensions } from '../../core/magic';
import type { StatRow } from '../../core/types';
import { rasterToPng } from '../imageformats/canvasPainter';
import { previewStep } from '../imageformats/raster';
import { heicDetector, sniffHeif } from './detect';
import type { Heif, HeifImageInfo } from './heif';

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');
const size = (i: HeifImageInfo) => `${i.width} × ${i.height}`;

export function heifStats(images: HeifImageInfo[]): StatRow[] {
  const [first] = images;
  if (!first) return [];
  const steps = images.map(i => previewStep(i.width, i.height));
  const sampled = steps.some(s => s > 1);
  return [
    ...(images.length > 1
      ? [
          {
            label: 'Images',
            value: String(images.length),
            children: images.map((i, n) => ({
              label: `Image ${n + 1}`,
              value: `${size(i)}${i.primary ? ' · primary' : ''}${i.alpha ? ' · alpha' : ''}`,
            })),
          },
        ]
      : []),
    ...(first.bitDepth ? [{ label: 'Bit depth', value: `${first.bitDepth}-bit` }] : []),
    { label: 'Alpha', value: yesNo(first.alpha) },
    ...(sampled ? [{ label: 'Preview', value: 'Sampled down (very large image)' }] : []),
  ];
}

/**
 * The `image` kind for HEIC/HEIF, like `imageformats`: the value's `bytes` are a PNG of the
 * primary image, and `decoded` describes the source and renders the other top-level images
 * (burst frames) as pages. Everything else is the core image interpreter's.
 */
export function createHeicInterpreter(load: () => Promise<Heif>): Interpreter<ImageValue> {
  return {
    ...imageInterpreter,
    detect: c => heicDetector.detect(c),
    async parse(c) {
      const sniff = sniffHeif(c.bytes);
      if (!sniff) throw new Error('Not a HEIC or HEIF image');
      const heif = await load();
      const images = heif.read(c.bytes);
      const renders = new Map<number, Promise<Uint8Array<ArrayBuffer>>>();
      // PNG of a page; rendered once, then cached (a failure is retried next time)
      const render = (index: number) => {
        let png = renders.get(index);
        if (!png) {
          const image = images[index];
          if (!image) return Promise.reject(new Error(`No image ${index + 1}`));
          png = (async () => rasterToPng(heif.decode(c.bytes, image.id)))();
          png.catch(() => renders.delete(index));
          renders.set(index, png);
        }
        return png;
      };
      const bytes = await render(0);
      return {
        kind: 'image',
        format: 'png',
        mime: 'image/png',
        dims: imageDimensions('png', bytes),
        bytes,
        decoded: {
          format: sniff.format,
          mime: sniff.mime,
          vector: false,
          pages: images.map(i => ({ width: i.width, height: i.height })),
          stats: heifStats(images),
          renderPage: render,
        },
      };
    },
  };
}
