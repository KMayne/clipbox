import { z } from 'zod';

/**
 * The global "Module downloads" setting (Settings → Modules):
 * - automatic: a module downloads when a paste first needs it, and on fast, unmetered connections
 *   the rest download in the background while the app is idle
 * - onDemand: only when a paste needs it; nothing in the background (for metered connections)
 * - everything: download every module straight away, whatever the connection, for offline use
 */
export const DOWNLOAD_MODES = ['automatic', 'onDemand', 'everything'] as const;
export type DownloadMode = (typeof DOWNLOAD_MODES)[number];

export const DEFAULT_DOWNLOAD_MODE: DownloadMode = 'automatic';

export const DOWNLOAD_MODE_KEY = 'clipbox.moduleDownloads';
/** The old background-download toggle: `{ enabled, skipped }`. Migrated, then removed. */
export const LEGACY_BACKGROUND_KEY = 'clipbox.backgroundDownloads';
/** The old per-module Auto/Preload/Off policies. No longer used; removed on load. */
export const LEGACY_POLICIES_KEY = 'clipbox.modules';

const storedSchema = z.object({ mode: z.enum(DOWNLOAD_MODES) });
const legacyBackgroundSchema = z.object({ enabled: z.boolean() });

function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Works out the mode from the stored setting, falling back to the old background-download
 * toggle (saved as off → On demand), then the default. Malformed values are ignored.
 */
export function parseDownloadMode(stored: string | null, legacy: string | null): DownloadMode {
  const current = storedSchema.safeParse(parseJson(stored));
  if (current.success) return current.data.mode;
  const old = legacyBackgroundSchema.safeParse(parseJson(legacy));
  if (old.success && !old.data.enabled) return 'onDemand';
  return DEFAULT_DOWNLOAD_MODE;
}

export const serialiseDownloadMode = (mode: DownloadMode) => JSON.stringify({ mode });

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Reads the mode, migrating and removing the legacy keys. Never throws. */
export function loadDownloadMode(storage: Storage): DownloadMode {
  try {
    const stored = storage.getItem(DOWNLOAD_MODE_KEY);
    const legacy = storage.getItem(LEGACY_BACKGROUND_KEY);
    const mode = parseDownloadMode(stored, legacy);
    if (legacy !== null) {
      storage.setItem(DOWNLOAD_MODE_KEY, serialiseDownloadMode(mode));
      storage.removeItem(LEGACY_BACKGROUND_KEY);
    }
    storage.removeItem(LEGACY_POLICIES_KEY);
    return mode;
  } catch {
    return DEFAULT_DOWNLOAD_MODE; // storage unavailable (private mode etc.)
  }
}

export function saveDownloadMode(storage: Storage, mode: DownloadMode): void {
  try {
    storage.setItem(DOWNLOAD_MODE_KEY, serialiseDownloadMode(mode));
  } catch {
    // storage unavailable: the setting just won't persist
  }
}
