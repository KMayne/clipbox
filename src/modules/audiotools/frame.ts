/** One video frame as a PNG: Mediabunny seeks and decodes (WebCodecs), OffscreenCanvas encodes. */
import { ALL_FORMATS, BufferSource, CanvasSink, Input } from 'mediabunny';
import type { FrameOptions, FrameResult } from './service';

const fmt = (s: number) => `${Math.round(s * 100) / 100} s`;

export async function videoFrame(
  bytes: Uint8Array<ArrayBuffer>,
  { at, signal }: FrameOptions,
): Promise<FrameResult> {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('There is no video track');
    if (!(await track.canDecode())) {
      throw new Error(`This browser can't decode ${track.codec ?? 'this'} video`);
    }
    const start = await track.getFirstTimestamp();
    const end = await track.computeDuration();
    const wanted = 'fraction' in at ? start + (end - start) * at.fraction : at.seconds;
    if (wanted > end) throw new Error(`${fmt(wanted)} is past the end of the video (${fmt(end)})`);
    if (signal?.aborted) throw new Error('Cancelled');

    // Frames are drawn at display size, rotation applied
    const sink = new CanvasSink(track, { poolSize: 0 });
    const frame = (await sink.getCanvas(Math.max(start, wanted))) ?? (await sink.getCanvas(start));
    if (!frame) throw new Error(`No frame at ${fmt(wanted)}`);
    const { canvas } = frame;
    if (!(canvas instanceof OffscreenCanvas)) throw new Error('Expected an OffscreenCanvas');
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
      timestamp: frame.timestamp,
    };
  } finally {
    input.dispose();
  }
}
