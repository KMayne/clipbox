import { normalise } from './normalise';
import type { AudioTools } from './service';

/** Audio processing for actions (Normalise audio); it owns no kinds. */
export const service: AudioTools = { normalise };
