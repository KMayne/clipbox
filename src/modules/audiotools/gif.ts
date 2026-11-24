/**
 * "Video to GIF": samples the primary video track at a fixed frame rate (Mediabunny decodes with
 * WebCodecs and scales into a canvas) and encodes an animated GIF with gifenc, one 256-colour
 * (or fewer) palette per frame. Frames are encoded as they're decoded, so only one is held.
 */
import { CanvasSink } from 'mediabunny';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { throwIfAborted } from '../../core/progress';
import { withInput } from './conversion';
import { gifFrames, gifSize } from './gifPlan';
import type { GifOptions, GifResult } from './service';
import { resolveRange } from './trim';

export function toGif(bytes: Uint8Array<ArrayBuffer>, options: GifOptions): Promise<GifResult> {
  const { fps, maxWidth, colours, loop, signal, progress } = options;
  return withInput(bytes, async input => {
    progress?.(undefined, 'Opening the video');
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('There is no video track');
    if (!(await video.canDecode())) {
      throw new Error(`This browser can't decode ${video.codec ?? 'this'} video`);
    }
    const first = await video.getFirstTimestamp();
    const duration = await video.computeDuration();
    const range = resolveRange(options.start, options.end, first, duration);
    const frames = gifFrames(range.start, range.end, fps);
    const { width, height } = gifSize(video.displayWidth, video.displayHeight, maxWidth);
    throwIfAborted(signal);

    // Drawn at the output size, rotation applied; one pooled canvas, read before the next frame
    const sink = new CanvasSink(video, { width, height, fit: 'fill', poolSize: 1 });
    const gif = GIFEncoder();
    let i = 0;
    let written = 0;
    for await (const frame of sink.canvasesAtTimestamps(frames.map(f => f.at))) {
      throwIfAborted(signal);
      const plan = frames[i];
      if (!plan) break;
      progress?.(i / frames.length, `Frame ${i + 1} of ${frames.length}`);
      // Null only before the track's first timestamp, which the range is clamped to
      if (frame) {
        const { canvas } = frame;
        if (!(canvas instanceof OffscreenCanvas)) throw new Error('Expected an OffscreenCanvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2D canvas context');
        const { data } = ctx.getImageData(0, 0, width, height);
        const palette = quantize(data, colours);
        gif.writeFrame(applyPalette(data, palette), width, height, {
          palette,
          delay: plan.delay,
          repeat: loop ? 0 : -1,
        });
        written++;
      }
      i++;
    }
    if (!written) throw new Error('No frames were decoded');
    gif.finish();
    const out = gif.bytes();
    const result = new Uint8Array(out.length);
    result.set(out);
    return {
      bytes: result,
      width,
      height,
      frames: written,
      start: range.start,
      end: range.end,
    };
  });
}
