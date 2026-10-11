import { register } from '../../core/interpreter';
import { audioInterpreter, videoInterpreter, type MediaValue } from './media';
import { mediaMetadata } from './metadata';
import type { MediaService } from './service';

export const interpreters = [register(audioInterpreter), register(videoInterpreter)];

const isMediaValue = (v: unknown): v is MediaValue =>
  audioInterpreter.isValue(v) || videoInterpreter.isValue(v);

/** Used by the core "Metadata as JSON" action through `ctx.service('media', isMediaService)`. */
export const service: MediaService = {
  async metadata(value) {
    if (!isMediaValue(value)) throw new Error('Not an audio or video value');
    return mediaMetadata(value);
  },
};
