import { registerAacEncoder } from '@mediabunny/aac-encoder';
import type { EncoderExtension } from '../audiotools/service';

/**
 * FFmpeg's AAC-LC encoder as a Mediabunny encoder, for "Convert audio" to M4A where WebCodecs
 * can't encode AAC (Chromium on Linux). It owns no kinds. Registering only reaches audiotools
 * because the build shares one Mediabunny.
 */
export const service: EncoderExtension = { register: registerAacEncoder };
