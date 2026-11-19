import { convert } from './convert';
import { extractAudio } from './extract';
import { videoFrame } from './frame';
import { normalise } from './normalise';
import type { AudioConverter, AudioTools, Trimmer, VideoFrameTool } from './service';
import { trim } from './trim';

/**
 * Media processing for actions (Normalise audio, Convert audio, Extract audio track, Video frame
 * as PNG, Trim); it owns no kinds.
 */
export const service: AudioTools & VideoFrameTool & AudioConverter & Trimmer = {
  normalise,
  videoFrame,
  convert,
  extractAudio,
  trim,
};
