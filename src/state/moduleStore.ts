import { create } from 'zustand';
import { engine } from '../engine/engineClient';
import type { ModuleLoadState } from '../engine/engine';
import type { ModuleId, UiModule } from '../modules/types';
import { uiLoaders } from '../modules/uiLoaders';
import { sw, type CacheState } from '../swClient';

interface ModuleState {
  workerStates: Record<string, ModuleLoadState>;
  uiStates: Record<string, ModuleLoadState>;
  cache: Record<string, CacheState>;
  init(): void;
  refresh(): Promise<void>;
  /** Downloads a module into the offline cache (driven by the Module downloads setting). */
  download(id: ModuleId): Promise<void>;
  loadUi(id: ModuleId): Promise<UiModule>;
}

const uiModules = new Map<ModuleId, Promise<UiModule>>();

export const useModuleStore = create<ModuleState>((set, get) => ({
  workerStates: {},
  uiStates: {},
  cache: {},

  init() {
    void get().refresh();
  },

  async refresh() {
    const [workerStates, cache] = await Promise.all([engine.moduleLoadStates(), sw.status()]);
    // The service worker only reports finished downloads; keep the progress of running ones
    set(s => ({
      workerStates,
      cache: Object.fromEntries(
        Object.entries(cache).map(([id, c]) => {
          const current = s.cache[id];
          return [id, current?.state === 'downloading' && c.state !== 'cached' ? current : c];
        }),
      ),
    }));
  },

  async download(id) {
    if (!sw.supported) return;
    const setCache = (state: CacheState) => set(s => ({ cache: { ...s.cache, [id]: state } }));
    setCache({ state: 'downloading', progress: 0 });
    try {
      await sw.download(id, progress => setCache({ state: 'downloading', progress }));
      setCache({ state: 'cached' });
    } catch {
      setCache({ state: 'none' });
    }
  },

  loadUi(id) {
    let mod = uiModules.get(id);
    if (!mod) {
      const loader = uiLoaders[id];
      if (!loader) return Promise.reject(new Error(`Module '${id}' has no UI part`));
      const setState = (state: ModuleLoadState) =>
        set(s => ({ uiStates: { ...s.uiStates, [id]: state } }));
      setState('loading');
      mod = loader();
      uiModules.set(id, mod);
      mod.then(
        () => setState('loaded'),
        () => {
          setState('failed');
          uiModules.delete(id);
        },
      );
    }
    return mod;
  },
}));
