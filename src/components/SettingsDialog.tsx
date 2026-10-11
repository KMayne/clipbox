import { css, cx } from '@emotion/css';
import { useCallback, useEffect, useState } from 'react';
import { formatBytes } from '../core/format';
import { modules } from '../modules/registry';
import type { ModuleInfo, Policy } from '../modules/types';
import { useModuleStore } from '../state/moduleStore';
import { storageUsed, useHistoryStore, type KeepFor } from '../state/persistence';
import { useUiStore } from '../state/uiStore';
import { sw, type CacheState } from '../swClient';
import { theme } from '../theme';
import { ui } from './ui';
import { useAsync } from './useAsync';

const POLICIES: { value: Policy; label: string; title: string }[] = [
  { value: 'auto', label: 'Auto', title: 'Load the first time it is needed' },
  { value: 'preload', label: 'Preload', title: 'Load at startup and keep available offline' },
  { value: 'off', label: 'Off', title: 'Never load' },
];

const styles = {
  backdrop: css`
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    z-index: 150;
  `,
  dialog: css`
    width: min(860px, 94vw);
    max-height: 80vh;
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
  `,
  focused: css`
    background: rgba(78, 161, 255, 0.1);
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
  activePolicy: css`
    background: ${theme.accent} !important;
    color: #111;
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
  `,
  rowLabel: css`
    width: 110px;
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
  footer: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 12px;
  `,
};

export function SettingsDialog() {
  const open = useUiStore(s => s.settings.open);
  return open ? <Settings /> : null;
}

function Settings() {
  const focus = useUiStore(s => s.settings.focus);
  const close = useUiStore(s => s.closeSettings);
  const refresh = useModuleStore(s => s.refresh);
  const download = useModuleStore(s => s.download);
  const manifest = useAsync('manifest', () => sw.manifest());

  useEffect(() => {
    void refresh();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refresh, close]);

  const sizeOf = (m: ModuleInfo) =>
    (manifest.status === 'ok' && manifest.value?.modules[m.id]?.bytes) || m.approxBytes;

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
        <HistorySection />
        <h3 className={styles.h3}>MODULES</h3>
        {!sw.supported && (
          <p className={styles.description}>
            Offline cache is only available in production builds.
          </p>
        )}
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Module</th>
              <th>Size</th>
              <th>Status</th>
              <th>Policy</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Core
                <div className={styles.description}>JSON, Records, Text, HTML, Image, Binary</div>
              </td>
              <td className={ui.muted}>built-in</td>
              <td>ready</td>
              <td className={ui.muted}>always on</td>
              <td />
            </tr>
            {modules.map(m => (
              <ModuleRow key={m.id} info={m} size={sizeOf(m)} focused={focus === m.id} />
            ))}
          </tbody>
        </table>
        {sw.supported && (
          <div className={styles.footer}>
            <span />
            <button className={ui.button} onClick={() => modules.forEach(m => void download(m.id))}>
              Download all
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function statusText(loaded: boolean, cache: CacheState | undefined): string {
  const parts: string[] = [];
  if (loaded) parts.push('loaded');
  if (cache?.state === 'cached') parts.push('✓ offline');
  if (cache?.state === 'downloading')
    parts.push(`downloading ${Math.round(cache.progress * 100)}%`);
  return parts.join(' · ') || 'not loaded';
}

function ModuleRow({ info, size, focused }: { info: ModuleInfo; size: number; focused: boolean }) {
  const policy = useModuleStore(s => s.policies[info.id] ?? info.defaultPolicy);
  const loaded = useModuleStore(
    s => s.workerStates[info.id] === 'loaded' || s.uiStates[info.id] === 'loaded',
  );
  const cache = useModuleStore(s => s.cache[info.id]);
  const { setPolicy, download, remove } = useModuleStore.getState();

  return (
    <tr className={cx(focused && styles.focused)} data-testid={`module-${info.id}`}>
      <td>
        {info.title}
        <div className={styles.description}>{info.description}</div>
      </td>
      <td>{formatBytes(size)}</td>
      <td data-testid="module-status">{statusText(loaded, cache)}</td>
      <td>
        <span className={styles.segmented} role="radiogroup" aria-label={`${info.title} policy`}>
          {POLICIES.map(p => (
            <button
              key={p.value}
              role="radio"
              aria-checked={policy === p.value}
              title={p.title}
              className={cx(policy === p.value && styles.activePolicy)}
              onClick={() => setPolicy(info.id, p.value)}
            >
              {p.label}
            </button>
          ))}
        </span>
      </td>
      <td>
        {sw.supported &&
          (cache?.state === 'cached' ? (
            <button className={ui.button} onClick={() => void remove(info.id)}>
              Remove
            </button>
          ) : (
            <button
              className={ui.button}
              disabled={cache?.state === 'downloading'}
              onClick={() => void download(info.id)}
            >
              Download
            </button>
          ))}
      </td>
    </tr>
  );
}

const KEEP_FOR_OPTIONS: { value: KeepFor; label: string }[] = [
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'forever', label: 'Forever' },
];

type Confirming = null | 'disable' | 'clear';

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
              className={cx(keepFor === o.value && styles.activePolicy)}
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
