import { isRecord } from '../../core/guards';

/**
 * The `imageformats` module's service, used by core actions through
 * `ctx.service('imageformats', isImageFormatsService)`. No heavy imports.
 */
export interface ImageFormatsService {
  /** Renders every page of a TIFF, EMF, WMF, PSD, TGA or PCX file to PNG; null if it isn't one. */
  toPng(bytes: Uint8Array<ArrayBuffer>, name?: string): Promise<Uint8Array<ArrayBuffer>[] | null>;
}

export const isImageFormatsService = (s: unknown): s is ImageFormatsService =>
  isRecord(s) && typeof s.toPng === 'function';
