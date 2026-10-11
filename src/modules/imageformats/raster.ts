/** Shared types and limits for the raster decoders (TIFF, PSD, TGA, PCX, DIB). */

/** Decoded pixels, 8-bit RGBA, row-major. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** Previews are scaled down (by whole-pixel sampling) to stay under this many pixels. */
export const MAX_PREVIEW_PIXELS = 32_000_000;

/** The sampling step that brings `width × height` under the preview cap (1 = full size). */
export function previewStep(width: number, height: number, max = MAX_PREVIEW_PIXELS): number {
  return Math.max(1, Math.ceil(Math.sqrt((width * height) / max)));
}

/** Size of the preview after sampling every `step`th pixel. */
export const scaled = (n: number, step: number) => Math.max(1, Math.ceil(n / step));

export function newRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export class DecodeError extends Error {}

/** Throws a DecodeError when a read would run past the end of the file. */
export function need(bytes: Uint8Array, end: number, what: string): void {
  if (end > bytes.length) throw new DecodeError(`Truncated ${what}`);
}
