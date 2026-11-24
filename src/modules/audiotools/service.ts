/**
 * The audiotools module's service interface. No imports beyond guards: core action code imports
 * this to type and check the service without bundling the module.
 */
import { isRecord } from '../../core/guards';

export interface NormaliseOptions {
  /** Target integrated loudness, LUFS. */
  target: number;
  /** True-peak ceiling, dBTP. */
  ceiling: number;
  /** Use the lookahead limiter instead of capping the gain. */
  limit: boolean;
  /** Aborting stops at the next decoded chunk, rejecting with an AbortError. */
  signal?: AbortSignal;
  /** Per pass: decoded time over the duration (`TaskContext.progress`). */
  progress?(fraction: number | undefined, message?: string): void;
}

export interface LoudnessReading {
  /** Integrated loudness, LUFS. */
  integrated: number;
  /** True peak, dBTP. */
  truePeak: number;
}

export interface NormaliseResult {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  /** File extension for the output, without the dot. */
  extension: string;
  /** Whether the output keeps the input's container. */
  sameContainer: boolean;
  /** Audio codec of the output, e.g. 'opus', 'pcm-s16'. */
  codec: string;
  hasVideo: boolean;
  before: LoudnessReading;
  /** Measured on the processed audio before encoding. */
  after: LoudnessReading;
  /** Constant gain applied, dB (before any limiting). */
  gainDb: number;
  /** The gain was lowered to stay under the ceiling, so the output is quieter than the target. */
  capped: boolean;
  /** The limiter reduced peaks. */
  limited: boolean;
}

export interface AudioTools {
  normalise(bytes: Uint8Array<ArrayBuffer>, options: NormaliseOptions): Promise<NormaliseResult>;
}

export const isAudioTools = (s: unknown): s is AudioTools =>
  isRecord(s) && typeof s.normalise === 'function';

// --- Video frames ("Video frame as PNG") ---

export interface FrameOptions {
  /** Seconds from the start of the media, or a fraction (0–1) of the way through. */
  at: { seconds: number } | { fraction: number };
  signal?: AbortSignal;
  progress?(fraction: number | undefined, message?: string): void;
}

export interface FrameResult {
  /** PNG, at the video's display size. */
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  /** The decoded frame's presentation time, seconds. */
  timestamp: number;
}

export interface VideoFrameTool {
  videoFrame(bytes: Uint8Array<ArrayBuffer>, options: FrameOptions): Promise<FrameResult>;
}

export const isVideoFrameTool = (s: unknown): s is VideoFrameTool =>
  isRecord(s) && typeof s.videoFrame === 'function';

// --- Conversion ("Convert audio", "Extract audio track") ---

/** Output formats for "Convert audio": m4a is AAC in MP4, ogg and webm are Opus. */
export const CONVERT_FORMATS = ['mp3', 'm4a', 'ogg', 'webm', 'flac', 'wav'] as const;
export type ConvertFormat = (typeof CONVERT_FORMATS)[number];

/** Codecs an encoder module (`mp3encoder`, `aacencoder`) can add to Mediabunny. */
export type ExtensionCodec = 'mp3' | 'aac';

export interface ConvertOptions {
  format: ConvertFormat;
  /** Target bitrate for lossy formats, kbps; ignored for FLAC and WAV. */
  bitrate: number;
  /**
   * Registers an encoder for `codec` with Mediabunny when the browser has none (MP3 everywhere,
   * AAC on Linux). Resolves false when the encoder module can't load.
   */
  loadEncoder?(codec: ExtensionCodec): Promise<boolean>;
  /** Aborting cancels the conversion, rejecting with an AbortError. */
  signal?: AbortSignal;
  /** Encoded time over the duration (`TaskContext.progress`). */
  progress?(fraction: number | undefined, message?: string): void;
}

export interface ConvertResult {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  /** File extension for the output, without the dot. */
  extension: string;
  /** Audio codec of the output, e.g. 'mp3', 'pcm-s16'. */
  codec: string;
  /** The source already had this codec, so its packets were copied rather than re-encoded. */
  copied: boolean;
  /** What encoded the audio: WebCodecs, an encoder module, or nothing (copied). */
  encoder: 'native' | 'extension' | 'none';
}

export interface ExtractOptions {
  signal?: AbortSignal;
  progress?(fraction: number | undefined, message?: string): void;
}

export interface ExtractResult {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  /** File extension for the output, without the dot. */
  extension: string;
  /** The audio track's codec, copied as it is. */
  codec: string;
}

export interface AudioConverter {
  convert(bytes: Uint8Array<ArrayBuffer>, options: ConvertOptions): Promise<ConvertResult>;
  extractAudio(bytes: Uint8Array<ArrayBuffer>, options: ExtractOptions): Promise<ExtractResult>;
}

export const isAudioConverter = (s: unknown): s is AudioConverter =>
  isRecord(s) && typeof s.convert === 'function' && typeof s.extractAudio === 'function';

/** An encoder module's service: `register()` adds its encoder to the shared Mediabunny. */
export interface EncoderExtension {
  register(): void;
}

export const isEncoderExtension = (s: unknown): s is EncoderExtension =>
  isRecord(s) && typeof s.register === 'function';

// --- Trim ("Trim") ---

/** A point in the media: seconds from the start, a fraction (0–1) of it, or seconds before the end. */
export type TimePoint = { seconds: number } | { fraction: number } | { beforeEnd: number };

export interface TrimOptions {
  start: TimePoint;
  /** Omitted: to the end. */
  end?: TimePoint;
  /**
   * False copies the packets (fast and lossless), from the keyframe at or before `start`; where
   * the container can (MP4's edit lists), the frames before `start` are kept but not shown.
   * True cuts exactly, re-encoding tracks whose packets don't line up with the cut.
   */
  exact: boolean;
  /** Registers an MP3 or AAC encoder when an exact cut must re-encode one (see ConvertOptions). */
  loadEncoder?(codec: ExtensionCodec): Promise<boolean>;
  signal?: AbortSignal;
  progress?(fraction: number | undefined, message?: string): void;
}

export interface TrimResult {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  /** File extension for the output, without the dot. */
  extension: string;
  /** Whether the output keeps the input's container. */
  sameContainer: boolean;
  /** The requested range in the input, seconds. */
  start: number;
  end: number;
  /** How long the output plays, seconds: longer than `end - start` when a fast cut had to widen. */
  duration: number;
}

export interface Trimmer {
  trim(bytes: Uint8Array<ArrayBuffer>, options: TrimOptions): Promise<TrimResult>;
}

export const isTrimmer = (s: unknown): s is Trimmer => isRecord(s) && typeof s.trim === 'function';

// --- Crop ("Crop video") ---

/** A region of the video in display pixels (after rotation), from the top left. */
export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CropOptions {
  rect: CropRect;
  /** Encoder quality for the re-encoded video. */
  quality: 'medium' | 'high' | 'very-high';
  signal?: AbortSignal;
  progress?(fraction: number | undefined, message?: string): void;
}

export interface CropResult {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  /** File extension for the output, without the dot. */
  extension: string;
  /** Whether the output keeps the input's container. */
  sameContainer: boolean;
  /** The region used: clamped to the frame and rounded to even pixels. */
  rect: CropRect;
}

export interface Cropper {
  crop(bytes: Uint8Array<ArrayBuffer>, options: CropOptions): Promise<CropResult>;
}

export const isCropper = (s: unknown): s is Cropper => isRecord(s) && typeof s.crop === 'function';

// --- WebM ("Convert to WebM") ---

export interface WebmOptions {
  codec: 'vp9' | 'av1' | 'vp8';
  /** Encoder quality for the re-encoded video. */
  quality: 'medium' | 'high' | 'very-high';
  signal?: AbortSignal;
  progress?(fraction: number | undefined, message?: string): void;
}

export interface WebmResult {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  /** The video's packets were copied: the source already had the chosen codec. */
  videoCopied: boolean;
}

export interface WebmConverter {
  toWebm(bytes: Uint8Array<ArrayBuffer>, options: WebmOptions): Promise<WebmResult>;
}

export const isWebmConverter = (s: unknown): s is WebmConverter =>
  isRecord(s) && typeof s.toWebm === 'function';

// --- GIF ("Video to GIF") ---

export interface GifOptions {
  start: TimePoint;
  /** Omitted: to the end. */
  end?: TimePoint;
  /** Frames per second sampled from the video. */
  fps: number;
  /** Output width in px, never upscaled; 0 keeps the video's display width. */
  maxWidth: number;
  /** Colours per frame's palette, 2–256. */
  colours: number;
  /** Loop forever, or play once. */
  loop: boolean;
  signal?: AbortSignal;
  progress?(fraction: number | undefined, message?: string): void;
}

export interface GifResult {
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  frames: number;
  /** The range used, seconds in the input. */
  start: number;
  end: number;
}

export interface GifMaker {
  toGif(bytes: Uint8Array<ArrayBuffer>, options: GifOptions): Promise<GifResult>;
}

export const isGifMaker = (s: unknown): s is GifMaker =>
  isRecord(s) && typeof s.toGif === 'function';
