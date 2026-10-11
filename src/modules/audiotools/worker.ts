import { videoFrame } from './frame';
import { normalise } from './normalise';
import type { AudioTools, VideoFrameTool } from './service';

/** Media processing for actions (Normalise audio, Video frame as PNG); it owns no kinds. */
export const service: AudioTools & VideoFrameTool = { normalise, videoFrame };
