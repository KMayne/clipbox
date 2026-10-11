/** The media module's service, typed and checked without importing music-metadata. */
import { isRecord } from '../../core/guards';

export interface MediaService {
  /** Everything known about the file (container, streams, tags) as plain JSON data. */
  metadata(value: unknown): Promise<Record<string, unknown>>;
}

export const isMediaService = (s: unknown): s is MediaService =>
  isRecord(s) && typeof s.metadata === 'function';
