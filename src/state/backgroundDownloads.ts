import { z } from 'zod';
import { create } from 'zustand';
import { judgeConnection, nextToDownload, type ConnectionInfo } from '../modules/backgroundPolicy';
import {
  DEFAULT_DOWNLOAD_MODE,
  loadDownloadMode,
  saveDownloadMode,
  type DownloadMode,
} from '../modules/downloadMode';
import type { ModuleId } from '../modules/types';
import { sw } from '../swClient';
import { useModuleStore } from './moduleStore';

/*
 * Applies the global "Module downloads" setting (modules/downloadMode.ts):
 * - Automatic: downloads modules into the offline cache in the background, smallest first, when
 *   the connection looks fast and unmetered. Chrome's Network Information API gives an effective
 *   type, a downlink estimate (capped at ~10 Mbps) and the user's Data Saver flag; it can't tell
 *   whether a desktop connection is metered, so Data Saver and "cellular" are the signals used.
 * - On demand: nothing in the background.
 * - Everything now: downloads every module straight away, whatever the connection.
 * In every mode a module is also fetched the first time a paste needs it.
 */

export type BackgroundStatus =
  | { state: 'unsupported' }
  | { state: 'off' }
  | { state: 'waiting' }
  | { state: 'paused'; reason: string }
  | { state: 'downloading'; module: ModuleId }
  | { state: 'done' };

interface BackgroundState {
  mode: DownloadMode;
  status: BackgroundStatus;
  setMode(mode: DownloadMode): void;
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

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);

export const useBackgroundDownloads = create<BackgroundState>(set => ({
  mode: (() => {
    const s = storage();
    return s ? loadDownloadMode(s) : DEFAULT_DOWNLOAD_MODE;
  })(),
  status: { state: 'waiting' },
  setMode(mode) {
    const s = storage();
    if (s) saveDownloadMode(s, mode);
    if (!sw.supported) return set({ mode, status: { state: 'unsupported' } });
    set({ mode, status: mode === 'onDemand' ? { state: 'off' } : { state: 'waiting' } });
    if (mode !== 'onDemand') void run();
  },
}));

let running = false;
/** Modules that failed this session; not retried until the next page load. */
const failed = new Set<ModuleId>();

async function run(): Promise<void> {
  const bg = useBackgroundDownloads.getState;
  const setStatus = (status: BackgroundStatus) => useBackgroundDownloads.setState({ status });
  if (running || bg().mode === 'onDemand') return;
  running = true;
  try {
    // Automatic waits for the app to be idle; Everything now starts straight away
    if (bg().mode === 'automatic') await idle();
    const manifest = await sw.manifest();
    if (!manifest) return setStatus({ state: 'unsupported' });
    const sizes = Object.fromEntries(
      Object.entries(manifest.modules).map(([id, m]) => [id, m.bytes]),
    );
    await useModuleStore.getState().refresh();
    while (bg().mode !== 'onDemand') {
      if (bg().mode === 'automatic') {
        const verdict = judgeConnection(connection());
        if (!verdict.ok) return setStatus({ state: 'paused', reason: verdict.reason });
      }
      const id = nextToDownload(sizes, useModuleStore.getState().cache, failed);
      if (!id) return setStatus({ state: 'done' });
      setStatus({ state: 'downloading', module: id });
      await useModuleStore.getState().download(id);
      if (useModuleStore.getState().cache[id]?.state !== 'cached') failed.add(id);
    }
  } finally {
    running = false;
  }
}

/** Downloads again, retrying failures, e.g. after the offline cache was repaired. */
export function resumeBackgroundDownloads(): void {
  failed.clear();
  void run();
}

/** Starts background downloads and re-checks whenever the connection changes. */
export function startBackgroundDownloads(): void {
  if (!sw.supported) {
    useBackgroundDownloads.setState({ status: { state: 'unsupported' } });
    return;
  }
  // Listen even while On demand, so switching to Automatic later still reacts to changes
  connection()?.target?.addEventListener('change', () => void run());
  if (useBackgroundDownloads.getState().mode === 'onDemand') {
    useBackgroundDownloads.setState({ status: { state: 'off' } });
    return;
  }
  void run();
}
