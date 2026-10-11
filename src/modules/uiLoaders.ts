import type { ModuleId, UiModule } from './types';

/** Main-thread lazy imports. */
export const uiLoaders: Partial<Record<ModuleId, () => Promise<UiModule>>> = {
  editor: () => import('./editor/ui'),
};
