import { register } from '../../core/interpreter';
import { openLegacyImage } from './decode';
import { sniffLegacyImage } from './detect';
import { legacyImageInterpreter } from './interpreter';
import type { ImageFormatsService } from './types';

export const interpreters = [register(legacyImageInterpreter)];

/** Used by PowerPoint "Extract images" to convert EMF, WMF and TIFF media to PNG. */
export const service: ImageFormatsService = {
  async toPng(bytes, name) {
    const format = sniffLegacyImage(bytes, name);
    if (!format) return null;
    const image = await openLegacyImage(bytes, format);
    const pages: Uint8Array<ArrayBuffer>[] = [];
    for (let i = 0; i < image.pages.length; i++) pages.push(await image.render(i));
    return pages;
  },
};
