/** Pure planning for "Video to GIF": output size, frame times and their delays. */

/** More frames than this is refused: lower the frame rate or trim the range. */
export const MAX_GIF_FRAMES = 1500;

/**
 * The output size: `maxWidth` (0 for the video's own) without upscaling, the height kept to
 * the aspect ratio, both at least 1 px.
 */
export function gifSize(
  displayWidth: number,
  displayHeight: number,
  maxWidth: number,
): { width: number; height: number } {
  const width = Math.max(
    1,
    Math.round(maxWidth > 0 ? Math.min(maxWidth, displayWidth) : displayWidth),
  );
  const height = Math.max(1, Math.round((displayHeight * width) / displayWidth));
  return { width, height };
}

export interface GifFrame {
  /** When to sample the video, seconds. */
  at: number;
  /** How long the frame shows, ms: a whole number of hundredths, as GIF stores it. */
  delay: number;
}

/**
 * One frame every 1/`fps` s from `start` until `end`. Delays are rounded on the running total,
 * so the GIF's length stays within a hundredth of the range's (15 fps alternates 70 and 60 ms).
 * Throws when there would be more than MAX_GIF_FRAMES.
 */
export function gifFrames(start: number, end: number, fps: number): GifFrame[] {
  const length = end - start;
  // A hair under, so 2 s at 10 fps is 20 frames, not 21 from floating-point error
  const count = Math.max(1, Math.ceil(length * fps - 1e-6));
  if (count > MAX_GIF_FRAMES) {
    throw new Error(
      `That's ${count} frames; the most is ${MAX_GIF_FRAMES}. Lower the frame rate or shorten the range`,
    );
  }
  const cs = (t: number) => Math.round(t * 100);
  const frames: GifFrame[] = [];
  for (let i = 0; i < count; i++) {
    const from = i / fps;
    const to = Math.min(length, (i + 1) / fps);
    // At least 2 hundredths: browsers show shorter delays as 100 ms
    frames.push({ at: start + from, delay: Math.max(2, cs(to) - cs(from)) * 10 });
  }
  return frames;
}
