import type { EntryContent } from '../../core/content';
import type { Detector } from '../types';

/** "SQLite format 3\0" */
const HEADER = [...'SQLite format 3'].map(c => c.charCodeAt(0)).concat(0);

export const isSqlite = (c: EntryContent) =>
  c.bytes.length >= 100 && HEADER.every((v, i) => c.bytes[i] === v);

/** Cheap core-side detector; parsing lives in the lazily-loaded worker half. */
export const sqliteDetector: Detector = {
  kind: 'sqlite',
  module: 'sqlite',
  detect: c => (isSqlite(c) ? 0.98 : 0),
};
