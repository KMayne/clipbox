import type { Interpreter } from '../../core/interpreter';
import { imageInterpreter, type ImageValue } from '../../core/interpreters/image';
import { imageDimensions } from '../../core/magic';
import { openLegacyImage } from './decode';
import { imageformatsDetector, LEGACY_IMAGE_INFO, sniffLegacyImage } from './detect';

/**
 * The `image` kind for formats the browser can't decode: the value's `bytes` are a PNG of the
 * first page, and `decoded` describes the source and renders the other pages. Everything else
 * (label, stats, slices, copy, actions) is the core image interpreter's.
 */
export const legacyImageInterpreter: Interpreter<ImageValue> = {
  ...imageInterpreter,
  detect: c => imageformatsDetector.detect(c),
  async parse(c) {
    const format = sniffLegacyImage(c.bytes, c.name);
    if (!format) throw new Error('Not a TIFF, EMF, WMF, PSD, TGA or PCX image');
    const image = await openLegacyImage(c.bytes, format);
    const bytes = await image.render(0);
    const info = LEGACY_IMAGE_INFO[format];
    return {
      kind: 'image',
      format: 'png',
      mime: 'image/png',
      dims: imageDimensions('png', bytes),
      bytes,
      decoded: {
        format: info.name,
        mime: info.mime,
        vector: image.vector,
        pages: image.pages,
        stats: image.stats,
        renderPage: index => image.render(index),
      },
    };
  },
};
