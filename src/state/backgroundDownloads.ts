import { z } from 'zod';
import { create } from 'zustand';
import { judgeConnection, nextToDownload, type ConnectionInfo } from '../modules/backgroundPolicy';
import type { ModuleId } from '../modules/types';
import { sw } from '../swClient';
import { useModuleStore } from './moduleStore';

/*
 * Downloads Auto-policy modules into the offline cache in the background, smallest first, when
 * the connection looks fast and unmetered. Chrome's Network Information API gives an effective
 * type, a downlink estimate (capped at ~10 Mbps) and the user's Data Saver flag; it can't tell
 * whether a desktop connection is metered, so Data Saver and "cellular" are the signals used.
 */

// ---- Settings ----------------------------------------------------------------------------

const STORAGE_KEY = 'clipbox.backgroundDownloads';

const settingsSchema = z.object({
  enabled: z.boolean(),
  /** Modules the user removed by hand; never re-downloaded in the background. */
  skipped: z.array(z.string()),
});

type Settings = z.infer<typeof settingsSchema>;

const DEFAULTS: Settings = { enabled: true, skipped: [] };

function loadSettings(): Settings {
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
    return parsed.success ? parsed.data : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: the setting just won't persist
  }
}

// ---- Store and runner --------------------------------------------------------------------

export type BackgroundStatus =
  | { state: 'unsupported' }
  | { state: 'off' }
  | { state: 'waiting' }
  | { state: 'paused'; reason: string }
  | { state: 'downloading'; module: ModuleId }
  | { state: 'done' };

interface BackgroundState extends Settings {
  status: BackgroundStatus;
  setEnabled(enabled: boolean): void;
  /** Call when the user removes a module so it isn't fetched again in the background. */
  skip(id: ModuleId): void;
  /** Call when the user downloads a module by hand, undoing an earlier skip. */
  unskip(id: ModuleId): void;
}

const connectionSchema = z.object({
  effectiveType: z.string().optional(),
  downlink: z.number().optional(),
  saveData: z.boolean().optional(),
  type: z.string().optional(),
});

/** `navigator.connection`, which isn't in TypeScript's DOM lib. */
function connection(): (ConnectionInfo & { target: EventTarget | null }) | null {
  const conn: unknown = Reflect.get(navigator, 'connection');
  const parsed = connectionSchema.safeParse(conn);
  if (!parsed.success) return null;
  return { ...parsed.data, target: conn instanceof EventTarget ? conn : null };
}

const idle = () =>
  new Promise<void>(resolve => {
    if ('requestIdleCallback' in window) requestIdleCallback(() => resolve(), { timeout: 5000 });
    else setTimeout(resolve, 2000);
  });

export const useBackgroundDownloads = create<BackgroundState>((set, get) => {
  const persist = () => saveSettings({ enabled: get().enabled, skipped: get().skipped });
  return {
    ...loadSettings(),
    status: { state: 'waiting' },
    setEnabled(enabled) {
      set({ enabled, status: enabled ? { state: 'waiting' } : { state: 'off' } });
      persist();
      if (enabled) void run();
    },
    skip(id) {
      if (get().skipped.includes(id)) return;
      set({ skipped: [...get().skipped, id] });
      persist();
    },
    unskip(id) {
      set({ skipped: get().skipped.filter(s => s !== id) });
      persist();
    },
  };
});

let running = false;
/** Modules that failed this session; not retried until the next page load. */
const failed = new Set<ModuleId>();

async function run(): Promise<void> {
  const bg = useBackgroundDownloads.getState;
  const setStatus = (status: BackgroundStatus) => useBackgroundDownloads.setState({ status });
  if (running || !bg().enabled) return;
  running = true;
  try {
    await idle();
    const manifest = await sw.manifest();
    if (!manifest) return setStatus({ state: 'unsupported' });
    const sizes = Object.fromEntries(
      Object.entries(manifest.modules).map(([id, m]) => [id, m.bytes]),
    );
    await useModuleStore.getState().refresh();
    while (bg().enabled) {
      const verdict = judgeConnection(connection());
      if (!verdict.ok) return setStatus({ state: 'paused', reason: verdict.reason });
      const { policies, cache } = useModuleStore.getState();
      const id = nextToDownload(sizes, policies, cache, new Set([...failed, ...bg().skipped]));
      if (!id) return setStatus({ state: 'done' });
      setStatus({ state: 'downloading', module: id });
      await useModuleStore.getState().download(id);
      if (useModuleStore.getState().cache[id]?.state !== 'cached') failed.add(id);
    }
  } finally {
    running = false;
  }
}

/** Starts background downloads and re-checks whenever the connection changes. */
export function startBackgroundDownloads(): void {
  if (!sw.supported) {
    useBackgroundDownloads.setState({ status: { state: 'unsupported' } });
    return;
  }
  // Listen even while disabled, so turning it on later still reacts to connection changes
  connection()?.target?.addEventListener('change', () => void run());
  if (!useBackgroundDownloads.getState().enabled) {
    useBackgroundDownloads.setState({ status: { state: 'off' } });
    return;
  }
  void run();
}
