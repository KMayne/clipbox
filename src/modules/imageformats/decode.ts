/** Opens any legacy format: its pages, stats, and PNG renders (cached) of each page. */

import type { Dimensions } from '../../core/magic';
import type { StatRow } from '../../core/types';
import { CanvasPainter, rasterToPng } from './canvasPainter';
import { LEGACY_IMAGE_INFO, type LegacyImageFormat } from './detect';
import { emfLayout, emfStats, readEmfHeader, renderEmf } from './emf';
import { decodePcx, pcxStats, readPcx } from './pcx';
import { decodePsd, psdStats, readPsd } from './psd';
import { previewStep, type Raster } from './raster';
import { decodeTga, readTga, tgaStats } from './tga';
import { decodeTiffPage, readTiff, tiffStats } from './tiff';
import { playWmf, readWmfHeader, wmfLayout, wmfStats } from './wmf';

export interface LegacyImage {
  format: LegacyImageFormat;
  vector: boolean;
  /** Source size of each page (rendered size for metafiles). */
  pages: Dimensions[];
  stats: StatRow[];
  /** PNG of a page; renders once, then cached. */
  render(index: number): Promise<Uint8Array<ArrayBuffer>>;
}

const scaleNote = (pages: Dimensions[]): StatRow[] => {
  const steps = pages.map(p => previewStep(p.width, p.height));
  const step = Math.max(...steps);
  return step > 1
    ? [{ label: 'Preview', value: `Sampled at 1/${step} size (very large image)` }]
    : [];
};

function cached(render: (index: number) => Promise<Uint8Array<ArrayBuffer>>) {
  const pages = new Map<number, Promise<Uint8Array<ArrayBuffer>>>();
  return (index: number) => {
    let png = pages.get(index);
    if (!png) {
      png = render(index);
      png.catch(() => pages.delete(index));
      pages.set(index, png);
    }
    return png;
  };
}

function raster(
  format: LegacyImageFormat,
  size: Dimensions,
  stats: StatRow[],
  decode: () => Raster,
): LegacyImage {
  return {
    format,
    vector: false,
    pages: [size],
    stats: [...stats, ...scaleNote([size])],
    render: cached(async () => rasterToPng(decode())),
  };
}

/** Parses the headers (cheap); pages render on demand. Throws a DecodeError on bad data. */
export async function openLegacyImage(
  bytes: Uint8Array<ArrayBuffer>,
  format: LegacyImageFormat,
): Promise<LegacyImage> {
  switch (format) {
    case 'tiff': {
      const file = readTiff(bytes);
      const pages = file.pages.map(p => ({ width: p.width, height: p.height }));
      return {
        format,
        vector: false,
        pages,
        stats: [...tiffStats(file), ...scaleNote(pages)],
        render: cached(async i => rasterToPng(decodeTiffPage(file, i))),
      };
    }
    case 'psd': {
      const info = readPsd(bytes);
      return raster(format, info, psdStats(info), () => decodePsd(bytes, info));
    }
    case 'tga': {
      const info = readTga(bytes);
      return raster(format, info, tgaStats(info), () => decodeTga(bytes, info));
    }
    case 'pcx': {
      const info = readPcx(bytes);
      return raster(format, info, pcxStats(info), () => decodePcx(bytes, info));
    }
    case 'emf': {
      const header = readEmfHeader(bytes);
      const layout = emfLayout(header);
      const stats = emfStats(header);
      return {
        format,
        vector: true,
        pages: [{ width: layout.width, height: layout.height }],
        stats,
        render: cached(async () => {
          const { painter, from } = await renderEmf(
            bytes,
            header,
            () => new CanvasPainter(layout.width, layout.height, layout.base),
          );
          if (from === 'EMF fallback') {
            stats.push({
              label: 'Rendered from',
              value: 'EMF records (EMF+ had unsupported parts)',
            });
          } else if (from === 'EMF+') {
            stats.push({ label: 'Rendered from', value: 'EMF+ records' });
          }
          return painter.png();
        }),
      };
    }
    case 'wmf': {
      const header = readWmfHeader(bytes);
      const layout = wmfLayout(header);
      return {
        format,
        vector: true,
        pages: [{ width: layout.width, height: layout.height }],
        stats: wmfStats(header),
        render: cached(async () => {
          const painter = new CanvasPainter(layout.width, layout.height, layout.base);
          await playWmf(bytes, painter, header, layout);
          return painter.png();
        }),
      };
    }
  }
}

export const formatName = (f: LegacyImageFormat) => LEGACY_IMAGE_INFO[f].name;
