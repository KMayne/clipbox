/**
 * "Crop video": re-encodes the primary video track to one region of the frame, copying the audio,
 * in the same container where Mediabunny can write it (else Matroska).
 */
import {
  MkvOutputFormat,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  type Quality,
} from 'mediabunny';
import { throwIfAborted } from '../../core/progress';
import { convertInto, outputMime, sameFormat, withInput } from './conversion';
import type { CropOptions, CropRect, CropResult } from './service';

const QUALITIES: Record<CropOptions['quality'], Quality> = {
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  'very-high': QUALITY_VERY_HIGH,
};

/** Down to an even number: 4:2:0 encoders (H.264, VP9, AV1) need even sizes. */
const even = (n: number) => Math.max(0, Math.floor(n / 2) * 2);

/**
 * Clamps `rect` to a `frameWidth`×`frameHeight` frame and rounds it to even pixels. A width or
 * height of 0 runs to the frame's edge. Throws when less than 2×2 pixels are left.
 */
export function fitCrop(rect: CropRect, frameWidth: number, frameHeight: number): CropRect {
  const left = even(Math.min(Math.max(0, rect.left), frameWidth));
  const top = even(Math.min(Math.max(0, rect.top), frameHeight));
  const width = even(Math.min(rect.width > 0 ? rect.width : frameWidth, frameWidth - left));
  const height = even(Math.min(rect.height > 0 ? rect.height : frameHeight, frameHeight - top));
  if (width < 2 || height < 2) {
    throw new Error(`The crop is outside the ${frameWidth}×${frameHeight} frame`);
  }
  return { left, top, width, height };
}

export function crop(bytes: Uint8Array<ArrayBuffer>, options: CropOptions): Promise<CropResult> {
  const { quality, signal, progress } = options;
  return withInput(bytes, async input => {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('There is no video track');
    if (!(await video.canDecode())) {
      throw new Error(`This browser can't decode ${video.codec ?? 'this'} video`);
    }
    const rect = fitCrop(options.rect, video.displayWidth, video.displayHeight);
    const audio = await input.getPrimaryAudioTrack();

    const same = sameFormat(await input.getFormat());
    const format = same ? same() : new MkvOutputFormat();
    throwIfAborted(signal);
    progress?.(undefined, 'Encoding');
    const out = await convertInto(
      input,
      format,
      {
        video: t =>
          t.id === video.id
            ? { crop: rect, quality: QUALITIES[quality], forceTranscode: true }
            : { discard: true },
        audio: t => (audio && t.id === audio.id ? {} : { discard: true }),
      },
      {
        signal,
        onProgress: fraction => progress?.(fraction, 'Encoding'),
        needs: t => t.id === video.id || t.id === audio?.id,
      },
    );
    return {
      bytes: out,
      mime: outputMime(format, true),
      extension: same ? format.fileExtension.slice(1) : 'mkv',
      sameContainer: !!same,
      rect,
    };
  });
}
