import { css, cx } from '@emotion/css';
import { useCallback, useEffect, useState } from 'react';
import { BUILD_DATE } from '../buildInfo';
import { formatBytes } from '../core/format';
import type { DownloadMode } from '../modules/downloadMode';
import { moduleInfo, modules } from '../modules/registry';
import type { ModuleInfo } from '../modules/types';
import {
  resumeBackgroundDownloads,
  useBackgroundDownloads,
  type BackgroundStatus,
} from '../state/backgroundDownloads';
import { useModuleStore } from '../state/moduleStore';
import { storageUsed, useHistoryStore, type KeepFor } from '../state/persistence';
import { useUiStore } from '../state/uiStore';
import { sw, type CacheState, type ModulesManifest } from '../swClient';
import { type SchemeId, schemeId, schemes, setScheme, theme } from '../theme';
import { InstallSection } from './InstallSection';
import { media, ui } from './ui';
import { SiteLinks } from './SiteLinks';
import { useAsync } from './useAsync';

const styles = {
  siteLinks: css`
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  `,
  backdrop: css`
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    z-index: 150;
    ${media.mobile} {
      padding: max(8px, env(safe-area-inset-top)) 8px max(8px, env(safe-area-inset-bottom));
    }
  `,
  dialog: css`
    width: min(860px, 94vw);
    max-height: 80vh;
    ${media.mobile} {
      width: 100%;
      max-height: 100%;
      padding: 12px;
    }
    overflow: auto;
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 6px;
    padding: 16px 20px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  `,
  header: css`
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 12px;
  `,
  h2: css`
    margin: 0;
    font-size: 15px;
  `,
  h3: css`
    margin: 0;
    font-size: 11px;
    letter-spacing: 0.06em;
    color: ${theme.muted};
  `,
  table: css`
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    th {
      text-align: left;
      font-weight: normal;
      color: ${theme.muted};
      padding: 4px 8px;
    }
    td {
      padding: 8px;
      border-top: 1px solid ${theme.subtle};
      vertical-align: middle;
    }
    /* Phones: no room for the Library column */
    ${media.mobile} {
      th:nth-child(2),
      td:nth-child(2) {
        display: none;
      }
      th,
      td {
        padding-left: 4px;
        padding-right: 4px;
      }
    }
  `,
  description: css`
    color: ${theme.muted};
    font-size: 12px;
  `,
  segmented: css`
    display: inline-flex;
    border: 1px solid ${theme.border};
    border-radius: 4px;
    overflow: hidden;
    button {
      padding: 2px 8px;
      background: none;
      border: none;
      cursor: pointer;
    }
    button + button {
      border-left: 1px solid ${theme.border};
    }
  `,
  activeOption: css`
    background: ${theme.accent} !important;
    color: ${theme.onAccent};
  `,
  section: css`
    margin-bottom: 20px;
  `,
  row: css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-top: 1px solid ${theme.subtle};
    label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }
    ${media.mobile} {
      flex-wrap: wrap;
    }
  `,
  rowLabel: css`
    width: 110px;
    flex-shrink: 0;
  `,
  end: css`
    margin-left: auto;
  `,
  confirm: css`
    display: flex;
    align-items: center;
    gap: 8px;
    color: ${theme.error};
  `,
  modes: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    label {
      display: flex;
      align-items: baseline;
      gap: 6px;
      cursor: pointer;
    }
    /* Phones: each option's description goes under its name */
    ${media.mobile} {
      label {
        flex-wrap: wrap;
      }
      label > span:last-child {
        flex-basis: 100%;
        padding-left: 22px;
      }
    }
  `,
  appearance: css`
    display: grid;
    gap: 8px;
    margin-bottom: 16px;
  `,
  schemes: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  scheme: css`
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 8px 10px;
    min-width: 128px;
    border: 1px solid;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
  `,
  schemeActive: css`
    outline: 2px solid ${theme.accent};
    outline-offset: 1px;
  `,
  schemeDots: css`
    display: flex;
    gap: 4px;
  `,
  schemeDot: css`
    width: 10px;
    height: 10px;
    border-radius: 50%;
  `,
  modeName: css`
    min-width: 110px;
  `,
  status: css`
    margin-top: 6px;
  `,
  alignTop: css`
    align-items: flex-start;
  `,
  nowrap: css`
    white-space: nowrap;
  `,
  appFooter: css`
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 12px;
    color: ${theme.muted};
  `,
};

export function SettingsDialog() {
  const open = useUiStore(s => s.settings.open);
  return open ? <Settings /> : null;
}

function Settings() {
  const close = useUiStore(s => s.closeSettings);
  const refresh = useModuleStore(s => s.refresh);
  const manifest = useAsync('manifest', () => sw.manifest());
  const built = manifest.status === 'ok' ? manifest.value : null;

  useEffect(() => {
    void refresh();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refresh, close]);

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="Settings"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.h2}>Settings</h2>
          <button className={ui.iconButton} onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        <InstallSection />
        <AppearanceSection />
        <HistorySection />
        <section aria-label="Modules">
          <h3 className={styles.h3}>MODULES</h3>
          <DownloadModeSetting />
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Module</th>
                <th>Library</th>
                <th>Size</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Core
                  <div className={styles.description}>
                    JSON, Records, Text, HTML, Image, YAML, XML, Markdown, NDJSON, Base64, JWT,
                    small values, zip/gzip/tar
                  </div>
                </td>
                <td className={ui.muted}>—</td>
                <td className={cx(ui.muted, styles.nowrap)}>built-in</td>
                <td>ready</td>
              </tr>
              {modules.map(m => (
                <ModuleRow key={m.id} info={m} built={built?.modules[m.id]} />
              ))}
            </tbody>
          </table>
          <AppFooter version={built?.version ?? null} />
        </section>
        <div className={styles.siteLinks}>
          <SiteLinks />
        </div>
      </div>
    </div>
  );
}

// ---- Modules -------------------------------------------------------------------------------

const DOWNLOAD_OPTIONS: { value: DownloadMode; label: string; description: string }[] = [
  {
    value: 'automatic',
    label: 'Automatic',
    description:
      'Download a module when a paste first needs it, and the rest in the background on fast, unmetered connections',
  },
  {
    value: 'onDemand',
    label: 'On demand',
    description: 'Download a module only when a paste needs it; best for metered connections',
  },
  {
    value: 'everything',
    label: 'Everything now',
    description: 'Download every module straight away, so the whole app works offline',
  },
];

function backgroundStatusText(s: BackgroundStatus): string {
  switch (s.state) {
    case 'unsupported':
      return 'The offline cache is only available in production builds';
    case 'off':
      return 'No background downloads';
    case 'waiting':
      return 'Waiting for the app to be idle';
    case 'paused':
      return `Background downloads paused: ${s.reason}`;
    case 'downloading':
      return `Downloading ${moduleInfo(s.module)?.title ?? s.module}…`;
    case 'done':
      return 'All modules downloaded';
  }
}

function DownloadModeSetting() {
  const mode = useBackgroundDownloads(s => s.mode);
  const status = useBackgroundDownloads(s => s.status);
  const setMode = useBackgroundDownloads(s => s.setMode);
  return (
    <div className={cx(styles.row, styles.alignTop)}>
      <span className={styles.rowLabel}>Module downloads</span>
      <div>
        <div className={styles.modes} role="radiogroup" aria-label="Module downloads">
          {DOWNLOAD_OPTIONS.map(o => (
            <label key={o.value}>
              <input
                type="radio"
                name="module-downloads"
                checked={mode === o.value}
                aria-describedby={`module-downloads-${o.value}`}
                onChange={() => setMode(o.value)}
              />
              <span className={styles.modeName}>{o.label}</span>
              <span id={`module-downloads-${o.value}`} className={styles.description}>
                {o.description}
              </span>
            </label>
          ))}
        </div>
        <div className={cx(styles.description, styles.status)} data-testid="background-status">
          {backgroundStatusText(status)}
        </div>
      </div>
    </div>
  );
}

function statusText(loaded: boolean, cache: CacheState | undefined): string {
  if (cache?.state === 'downloading') return `downloading ${Math.round(cache.progress * 100)}%`;
  const cached = cache?.state === 'cached';
  if (loaded && cached) return 'loaded · available offline';
  if (cached) return 'available offline';
  if (loaded) return 'loaded';
  return sw.supported ? 'not downloaded' : 'not loaded';
}

type BuiltModule = ModulesManifest['modules'][string];

function ModuleRow({ info, built }: { info: ModuleInfo; built: BuiltModule | undefined }) {
  const loaded = useModuleStore(
    s => s.workerStates[info.id] === 'loaded' || s.uiStates[info.id] === 'loaded',
  );
  const cache = useModuleStore(s => s.cache[info.id]);
  const library = [info.library?.name, built?.version].filter(Boolean).join(' ');
  return (
    <tr data-testid={`module-${info.id}`}>
      <td>
        {info.title}
        <div className={styles.description}>{info.description}</div>
      </td>
      <td data-testid="module-library">{library || '—'}</td>
      <td className={styles.nowrap}>{formatBytes(built?.bytes ?? info.approxBytes)}</td>
      <td className={styles.nowrap} data-testid="module-status">
        {statusText(loaded, cache)}
      </td>
    </tr>
  );
}

// ---- Version, updates and repair -----------------------------------------------------------

type UpdateState = 'idle' | 'checking' | 'current' | 'available' | 'failed';

const UPDATE_TEXT: Record<UpdateState, string> = {
  idle: '',
  checking: 'Checking for updates…',
  current: 'Up to date',
  available: 'Update found, installing…',
  failed: 'Couldn’t check for updates',
};

type RepairState =
  | { state: 'idle' }
  | { state: 'confirm' }
  | { state: 'repairing'; progress: number }
  | { state: 'done' }
  | { state: 'failed'; error: string };

function repairText(r: RepairState): string {
  switch (r.state) {
    case 'repairing':
      return `Repairing the offline cache… ${Math.round(r.progress * 100)}%`;
    case 'done':
      return 'Offline cache repaired';
    case 'failed':
      return `Repair failed: ${r.error}`;
    default:
      return '';
  }
}

function formatBuildDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function AppFooter({ version }: { version: string | null }) {
  const [update, setUpdate] = useState<UpdateState>('idle');
  const [repair, setRepair] = useState<RepairState>({ state: 'idle' });
  const busy = update === 'checking' || repair.state === 'repairing';

  // No service worker in dev: nothing to version, update or repair
  if (!sw.supported) {
    return (
      <div className={styles.appFooter} data-testid="app-version">
        Development build
      </div>
    );
  }

  const checkForUpdates = async () => {
    setRepair(r => (r.state === 'repairing' ? r : { state: 'idle' }));
    setUpdate('checking');
    try {
      setUpdate(await sw.checkForUpdate());
    } catch {
      setUpdate('failed');
    }
  };

  const runRepair = async () => {
    setUpdate('idle');
    setRepair({ state: 'repairing', progress: 0 });
    try {
      await sw.repair(progress => setRepair({ state: 'repairing', progress }));
      setRepair({ state: 'done' });
    } catch (err) {
      setRepair({ state: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
    await useModuleStore.getState().refresh();
    // Fetch whatever the download setting wants that the repair didn't bring back
    resumeBackgroundDownloads();
  };

  return (
    <>
      <div className={styles.appFooter}>
        <span data-testid="app-version">
          Version <span className={ui.mono}>{version ?? 'unknown'}</span> · built{' '}
          {formatBuildDate(BUILD_DATE)}
        </span>
        <span className={styles.end} data-testid="update-status">
          {UPDATE_TEXT[update] || repairText(repair)}
        </span>
        <button className={ui.button} disabled={busy} onClick={() => void checkForUpdates()}>
          Check for updates
        </button>
        <button
          className={ui.button}
          disabled={busy}
          onClick={() => setRepair({ state: 'confirm' })}
        >
          Repair offline cache
        </button>
      </div>
      {repair.state === 'confirm' && (
        <div className={cx(styles.row, styles.confirm)} role="alert">
          Delete the offline cache and download it again?
          <button className={ui.button} onClick={() => void runRepair()}>
            Repair
          </button>
          <button className={ui.button} onClick={() => setRepair({ state: 'idle' })}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}

// ---- History -------------------------------------------------------------------------------

const KEEP_FOR_OPTIONS: { value: KeepFor; label: string }[] = [
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'forever', label: 'Forever' },
];

type Confirming = null | 'disable' | 'clear';

const schemeIds: SchemeId[] = ['nord', 'tokyo-night', 'catppuccin-mocha', 'one-dark', 'gruvbox'];

function AppearanceSection() {
  return (
    <section className={styles.appearance} aria-label="Appearance">
      <h3 className={styles.h3}>APPEARANCE</h3>
      <div className={styles.schemes} role="radiogroup" aria-label="Colour scheme">
        {schemeIds.map(id => {
          const s = schemes[id];
          return (
            <button
              key={id}
              role="radio"
              aria-checked={id === schemeId}
              className={cx(styles.scheme, id === schemeId && styles.schemeActive)}
              style={{ background: s.bg, color: s.text, borderColor: s.border }}
              onClick={() => id !== schemeId && setScheme(id)}
            >
              <span className={styles.schemeDots}>
                {[s.hue.blue, s.hue.green, s.hue.orange, s.hue.purple, s.hue.red].map(c => (
                  <span key={c} className={styles.schemeDot} style={{ background: c }} />
                ))}
              </span>
              {s.label}
            </button>
          );
        })}
      </div>
      <p className={styles.description}>
        Changing the scheme reloads the page; your pastes are kept.
      </p>
    </section>
  );
}

function HistorySection() {
  const { keepHistory, keepFor } = useHistoryStore(s => s.settings);
  const { setKeepHistory, setKeepFor, clearAll } = useHistoryStore.getState();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [used, setUsed] = useState<number | null>(null);

  const refreshUsage = useCallback(() => {
    void storageUsed().then(setUsed);
  }, []);
  useEffect(refreshUsage, [refreshUsage]);

  const confirm = async () => {
    if (confirming === 'disable') await setKeepHistory(false);
    if (confirming === 'clear') await clearAll();
    setConfirming(null);
    refreshUsage();
  };

  return (
    <section className={styles.section} aria-label="History">
      <h3 className={styles.h3}>HISTORY</h3>
      <div className={styles.row}>
        <label>
          <input
            type="checkbox"
            checked={keepHistory}
            onChange={e => {
              if (e.target.checked) void setKeepHistory(true);
              else setConfirming('disable');
            }}
          />
          Keep history
        </label>
        <span className={styles.description}>Stored on this device only</span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Keep for</span>
        <span className={styles.segmented} role="radiogroup" aria-label="Keep for">
          {KEEP_FOR_OPTIONS.map(o => (
            <button
              key={o.value}
              role="radio"
              aria-checked={keepFor === o.value}
              disabled={!keepHistory}
              className={cx(keepFor === o.value && styles.activeOption)}
              onClick={() => setKeepFor(o.value)}
            >
              {o.label}
            </button>
          ))}
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Storage used</span>
        <span data-testid="storage-used">{used === null ? 'unknown' : formatBytes(used)}</span>
        <button className={cx(ui.button, styles.end)} onClick={() => setConfirming('clear')}>
          Clear all data
        </button>
      </div>
      {confirming && (
        <div className={cx(styles.row, styles.confirm)} role="alert">
          {confirming === 'disable'
            ? 'Turn off history and delete everything stored?'
            : 'Delete all pastes and stored history?'}
          <button className={ui.button} onClick={() => void confirm()}>
            {confirming === 'disable' ? 'Turn off' : 'Delete'}
          </button>
          <button className={ui.button} onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
