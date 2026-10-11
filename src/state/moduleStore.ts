import { z } from 'zod';
import { create } from 'zustand';
import { engine } from '../engine/engineClient';
import type { ModuleLoadState } from '../engine/engine';
import { defaultPolicies, modules, policyOf } from '../modules/registry';
import type { ModuleId, Policies, Policy, UiModule } from '../modules/types';
import { uiLoaders } from '../modules/uiLoaders';
import { sw, type CacheState } from '../swClient';

const STORAGE_KEY = 'clipbox.modules';

const storedPoliciesSchema = z.record(z.string(), z.enum(['auto', 'preload', 'off']));

function loadPolicies(): Policies {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    // Ignore anything malformed rather than failing startup
    const stored = storedPoliciesSchema.safeParse(raw);
    return { ...defaultPolicies(), ...(stored.success ? stored.data : {}) };
  } catch {
    return defaultPolicies();
  }
}

function savePolicies(policies: Policies) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(policies));
  } catch {
    // storage unavailable (private mode etc.): policies just won't persist
  }
}

interface ModuleState {
  policies: Policies;
  workerStates: Record<string, ModuleLoadState>;
  uiStates: Record<string, ModuleLoadState>;
  cache: Record<string, CacheState>;
  /** Module ids to call back when their policy changes (captureStore re-resolves chips). */
  init(): void;
  setPolicy(id: ModuleId, policy: Policy): void;
  refresh(): Promise<void>;
  download(id: ModuleId): Promise<void>;
  remove(id: ModuleId): Promise<void>;
  loadUi(id: ModuleId): Promise<UiModule>;
}

const uiModules = new Map<ModuleId, Promise<UiModule>>();
const policyListeners = new Set<(id: ModuleId, policy: Policy) => void>();

export const onPolicyChange = (fn: (id: ModuleId, policy: Policy) => void) => {
  policyListeners.add(fn);
  return () => policyListeners.delete(fn);
};

export const useModuleStore = create<ModuleState>((set, get) => ({
  policies: loadPolicies(),
  workerStates: {},
  uiStates: {},
  cache: {},

  init() {
    const { policies } = get();
    void engine.setPolicies(policies);
    for (const m of modules) {
      if (policyOf(policies, m.id) !== 'preload') continue;
      if (m.hasUi)
        void get()
          .loadUi(m.id)
          .catch(() => {});
      void get().download(m.id);
    }
    void get().refresh();
  },

  setPolicy(id, policy) {
    const policies = { ...get().policies, [id]: policy };
    set({ policies });
    savePolicies(policies);
    void engine.setPolicies(policies);
    if (policy === 'preload') {
      if (modules.find(m => m.id === id)?.hasUi)
        void get()
          .loadUi(id)
          .catch(() => {});
      void get().download(id);
    }
    policyListeners.forEach(fn => fn(id, policy));
    void get().refresh();
  },

  async refresh() {
    const [workerStates, cache] = await Promise.all([engine.moduleLoadStates(), sw.status()]);
    set({ workerStates, cache });
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

  async remove(id) {
    await sw.remove(id);
    void get().refresh();
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
