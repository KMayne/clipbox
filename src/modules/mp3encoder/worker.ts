import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import type { EncoderExtension } from '../audiotools/service';

/**
 * LAME as a Mediabunny encoder, for "Convert audio" to MP3 (WebCodecs has no MP3 encoder). It
 * owns no kinds. Registering only reaches audiotools because the build shares one Mediabunny.
 */
export const service: EncoderExtension = { register: registerMp3Encoder };
