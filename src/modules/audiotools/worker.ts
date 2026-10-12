import { convert } from './convert';
import { extractAudio } from './extract';
import { videoFrame } from './frame';
import { normalise } from './normalise';
import type { AudioConverter, AudioTools, VideoFrameTool } from './service';

/**
 * Media processing for actions (Normalise audio, Convert audio, Extract audio track, Video frame
 * as PNG); it owns no kinds.
 */
export const service: AudioTools & VideoFrameTool & AudioConverter = {
  normalise,
  videoFrame,
  convert,
  extractAudio,
};
