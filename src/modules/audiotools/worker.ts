import { convert } from './convert';
import { crop } from './crop';
import { extractAudio } from './extract';
import { videoFrame } from './frame';
import { toGif } from './gif';
import { normalise } from './normalise';
import type {
  AudioConverter,
  AudioTools,
  Cropper,
  GifMaker,
  Trimmer,
  VideoFrameTool,
  WebmConverter,
} from './service';
import { trim } from './trim';
import { toWebm } from './webm';

/**
 * Media processing for actions (Normalise audio, Convert audio, Extract audio track, Video frame
 * as PNG, Trim, Crop video, Convert to WebM, Video to GIF); it owns no kinds.
 */
export const service: AudioTools &
  VideoFrameTool &
  AudioConverter &
  Trimmer &
  Cropper &
  WebmConverter &
  GifMaker = {
  normalise,
  videoFrame,
  convert,
  extractAudio,
  trim,
  crop,
  toWebm,
  toGif,
};
