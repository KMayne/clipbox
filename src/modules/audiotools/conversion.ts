/**
 * The Mediabunny plumbing that Normalise, Convert and Extract share: open the input, run one
 * Conversion into an in-memory file, refuse a result that lost a track it needed, and cancel on
 * the run's signal.
 */
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  Conversion,
  Input,
  Output,
  type ConversionOptions,
  type InputTrack,
  type OutputFormat,
} from 'mediabunny';
import { throwIfAborted } from '../../core/progress';

/** Opens `bytes` with every format Mediabunny reads, and disposes of the input afterwards. */
export async function withInput<T>(
  bytes: Uint8Array<ArrayBuffer>,
  body: (input: Input) => Promise<T>,
): Promise<T> {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  try {
    return await body(input);
  } finally {
    input.dispose();
  }
}

export interface ConvertTask {
  /** Aborting cancels the conversion (the engine reports the rejection as an AbortError). */
  signal?: AbortSignal;
  /** Mediabunny's own progress, 0..1 of the input's duration. */
  onProgress?(fraction: number): void;
  /**
   * Tracks the result can't do without: dropping one is an error. Defaults to every track the
   * options didn't discard themselves.
   */
  needs?(track: InputTrack): boolean;
}

/** Runs one Conversion of `input` into a new in-memory file of `format`, returning its bytes. */
export async function convertInto(
  input: Input,
  format: OutputFormat,
  options: Omit<ConversionOptions, 'input' | 'output' | 'showWarnings'>,
  { signal, onProgress, needs = () => true }: ConvertTask = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const output = new Output({ format, target: new BufferTarget() });
  const conversion = await Conversion.init({ ...options, input, output, showWarnings: false });
  const dropped = conversion.discardedTracks.filter(
    d => d.reason !== 'discarded_by_user' && needs(d.track),
  );
  if (!conversion.isValid || dropped.length) {
    const what = dropped.map(d => `${d.track.type} (${d.reason.replace(/_/g, ' ')})`).join(', ');
    throw new Error(`Can't write this file${what ? `: ${what}` : ''}`);
  }
  if (onProgress) conversion.onProgress = fraction => onProgress(fraction);
  throwIfAborted(signal);
  const abort = () => void conversion.cancel();
  signal?.addEventListener('abort', abort);
  try {
    await conversion.execute();
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('The encoder produced no output');
  return new Uint8Array(buffer);
}

/**
 * Marks an audio-only MP4 as M4A: Mediabunny always writes the major brand `isom`, which readers
 * (ours included) take for video. The `ftyp` box comes first with `fastStart: 'in-memory'`.
 */
export function asM4a(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const type = String.fromCharCode(...bytes.subarray(4, 8));
  if (type === 'ftyp' && bytes.length >= 12) bytes.set([0x4d, 0x34, 0x41, 0x20], 8); // 'M4A '
  return bytes;
}

/** The format's MIME type, as audio/… when the file holds no video (Mediabunny says video/…). */
export const outputMime = (format: OutputFormat, hasVideo: boolean) =>
  hasVideo ? format.mimeType : format.mimeType.replace(/^video\//, 'audio/');
