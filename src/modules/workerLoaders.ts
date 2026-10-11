import type { ModuleId, WorkerModule } from './types';

/** Worker-side lazy imports. Kept separate from the UI loaders so neither bundle builds the other's chunks. */
export const workerLoaders: Partial<Record<ModuleId, () => Promise<WorkerModule>>> = {
  langdetect: () => import('./langdetect/worker'),
  x509: () => import('./x509/worker'),
  media: () => import('./media/worker'),
  sheets: () => import('./sheets/worker'),
  sqlite: () => import('./sqlite/worker'),
  pdf: () => import('./pdf/worker'),
  libarchive: () => import('./libarchive/worker'),
  audiotools: () => import('./audiotools/worker'),
  imageformats: () => import('./imageformats/worker'),
};
