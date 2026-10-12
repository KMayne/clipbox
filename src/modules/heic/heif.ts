/**
 * libheif (with libde265 for HEVC) compiled to WebAssembly, from libheif-js, run directly in the
 * engine worker. Everything here is synchronous once instantiated; every context, handle and
 * decoded image is freed before a call returns.
 */
import libheif, {
  type heif_context,
  type heif_image,
  type heif_image_handle,
  type MainModule,
} from 'libheif-js/libheif-wasm/libheif.js';
import { z } from 'zod';
import { isRecord } from '../../core/guards';
import { DecodeError, newRaster, previewStep, scaled, type Raster } from '../imageformats/raster';

/** One top-level image of a HEIF file (burst frames, or the primary image and its siblings). */
export interface HeifImageInfo {
  /** libheif's item ID, used to decode it again. */
  id: number;
  width: number;
  height: number;
  primary: boolean;
  alpha: boolean;
  /** Luma bit depth of the coded image (8, 10, 12), or null if libheif doesn't say. */
  bitDepth: number | null;
}

export interface Heif {
  /** The top-level images, primary first, then in file order. Throws a DecodeError on bad data. */
  read(bytes: Uint8Array<ArrayBuffer>): HeifImageInfo[];
  /** Decodes one image (by item ID) to 8-bit RGBA, sampled down to `maxPixels` when larger. */
  decode(bytes: Uint8Array<ArrayBuffer>, id: number, maxPixels?: number): Raster;
}

/**
 * Larger images aren't decoded at all: libheif needs the full-size RGBA (4 bytes a pixel) plus
 * the YCbCr planes in a WASM heap capped at 2 GB. 100 MP still covers 48 MP phone photos.
 */
export const MAX_HEIF_PIXELS = 100_000_000;

const errorSchema = z.object({
  code: z.object({ value: z.number() }),
  message: z.string().optional(),
});
const idsSchema = z.array(z.number());
const decodedSchema = z.object({
  channels: z.array(
    z.object({
      stride: z.number(),
      width: z.number(),
      height: z.number(),
      data: z.instanceof(Uint8Array),
    }),
  ),
});

/** libheif reports failures as a `{ code, message }` object in place of the result. */
function failure(result: unknown): string | null {
  const err = errorSchema.safeParse(result);
  if (!err.success || err.data.code.value === 0) return null;
  return err.data.message || `libheif error ${err.data.code.value}`;
}

// Embind wraps libheif's opaque structs in objects with a `delete` method
const isEmbindObject = (v: unknown): v is { delete(): void } =>
  isRecord(v) && typeof v.delete === 'function';
const isHandle = (v: unknown): v is heif_image_handle => isEmbindObject(v) && !failure(v);
const isImage = (v: unknown): v is heif_image => isEmbindObject(v);

/** The native pointer behind an embind object, for the raw C functions embind doesn't wrap. */
function pointer(v: unknown): number | null {
  if (!isRecord(v)) return null;
  const internal = v.$$;
  return isRecord(internal) && typeof internal.ptr === 'number' ? internal.ptr : null;
}

/** Instantiates libheif from its WASM bytes (fetched in the worker, read from disk in tests). */
export async function createHeif(wasm: ArrayBuffer | Uint8Array): Promise<Heif> {
  let lib: MainModule | null = null;
  await new Promise<void>((resolve, reject) => {
    try {
      // The build compiles the WASM synchronously, so this usually resolves inside the call
      lib = libheif({
        wasmBinary: wasm,
        print: () => {},
        printErr: () => {},
        onRuntimeInitialized: resolve,
        onAbort: (what: unknown) => reject(new Error(`libheif failed to start: ${String(what)}`)),
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
  if (!lib) throw new Error('libheif failed to start');
  const heif: MainModule = lib;

  function withContext<T>(bytes: Uint8Array<ArrayBuffer>, run: (ctx: heif_context) => T): T {
    const ctx = heif.heif_context_alloc();
    try {
      const message = failure(heif.heif_context_read_from_memory(ctx, bytes));
      if (message) throw new DecodeError(`Not a readable HEIF file: ${message}`);
      return run(ctx);
    } finally {
      heif.heif_context_free(ctx);
    }
  }

  function withHandle<T>(ctx: heif_context, id: number, run: (h: heif_image_handle) => T): T {
    const handle: unknown = heif.heif_js_context_get_image_handle(ctx, id);
    if (!isHandle(handle)) {
      throw new DecodeError(`Can't open image ${id}: ${failure(handle) ?? 'no handle'}`);
    }
    try {
      return run(handle);
    } finally {
      heif.heif_image_handle_release(handle);
    }
  }

  function info(h: heif_image_handle, id: number): HeifImageInfo {
    const ptr = pointer(h);
    const depth = ptr === null ? -1 : heif._heif_image_handle_get_luma_bits_per_pixel(ptr);
    return {
      id,
      width: heif.heif_image_handle_get_width(h),
      height: heif.heif_image_handle_get_height(h),
      primary: heif.heif_image_handle_is_primary_image(h) !== 0,
      alpha: heif.heif_image_handle_has_alpha_channel(h) !== 0,
      bitDepth: depth > 0 ? depth : null,
    };
  }

  return {
    read: bytes =>
      withContext(bytes, ctx => {
        const ids = idsSchema.safeParse(heif.heif_js_context_get_list_of_top_level_image_IDs(ctx));
        if (!ids.success) throw new DecodeError("Can't list the images in this HEIF file");
        if (!ids.data.length) {
          throw new DecodeError('No still images in this HEIF file (an image sequence?)');
        }
        const images = ids.data.map(id => withHandle(ctx, id, h => info(h, id)));
        const primary = images.findIndex(i => i.primary);
        return primary > 0
          ? [...images.slice(primary, primary + 1), ...images.filter((_, i) => i !== primary)]
          : images;
      }),

    decode: (bytes, id, maxPixels) =>
      withContext(bytes, ctx =>
        withHandle(ctx, id, h => {
          const width = heif.heif_image_handle_get_width(h);
          const height = heif.heif_image_handle_get_height(h);
          if (width * height > MAX_HEIF_PIXELS) {
            throw new DecodeError(`Image too large to decode (${width} × ${height})`);
          }
          const result: unknown = heif.heif_js_decode_image2(
            h,
            heif.heif_colorspace.heif_colorspace_RGB,
            heif.heif_chroma.heif_chroma_interleaved_RGBA,
          );
          const image = isRecord(result) ? result.image : undefined;
          try {
            const message = failure(result);
            if (message) throw new DecodeError(`Can't decode image ${id}: ${message}`);
            const decoded = decodedSchema.safeParse(result);
            const plane = decoded.success ? decoded.data.channels[0] : undefined;
            if (!plane || plane.stride < plane.width * 4) {
              throw new DecodeError(`Can't decode image ${id}`);
            }
            return toRaster(plane, previewStep(plane.width, plane.height, maxPixels));
          } finally {
            if (isImage(image)) heif.heif_image_release(image);
          }
        }),
      ),
  };
}

interface Plane {
  width: number;
  height: number;
  stride: number;
  data: Uint8Array;
}

/** Copies interleaved RGBA rows out of libheif's buffer, taking every `step`th pixel. */
function toRaster(p: Plane, step: number): Raster {
  const out = newRaster(scaled(p.width, step), scaled(p.height, step));
  const rowBytes = p.width * 4;
  for (let y = 0; y < out.height; y++) {
    const from = y * step * p.stride;
    if (from + rowBytes > p.data.length) throw new DecodeError('Truncated image data');
    if (step === 1) {
      out.data.set(p.data.subarray(from, from + rowBytes), y * rowBytes);
      continue;
    }
    for (let x = 0; x < out.width; x++) {
      const s = from + x * step * 4;
      const d = (y * out.width + x) * 4;
      out.data[d] = p.data[s] ?? 0;
      out.data[d + 1] = p.data[s + 1] ?? 0;
      out.data[d + 2] = p.data[s + 2] ?? 0;
      out.data[d + 3] = p.data[s + 3] ?? 0;
    }
  }
  return out;
}
