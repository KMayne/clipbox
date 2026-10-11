import { css, cx } from '@emotion/css';
import Fuse from 'fuse.js';
import { useMemo, useState } from 'react';
import { commands, installCommand, selectionCommands, type Command } from '../commands';
import { useCaptureStore } from '../state/captureStore';
import { canInstall, useInstallStore } from '../state/install';
import { useUiStore } from '../state/uiStore';
import { theme } from '../theme';
import { media, TOUCH_TARGET, ui } from './ui';
import { useAsync } from './useAsync';

/** An action's own title ranks above its group, so "Format" finds Format before Minify. */
const searchKeys = [
  { name: 'name', weight: 2 },
  { name: 'title', weight: 1 },
];

const NO_COMMANDS: Command[] = [];

const styles = {
  backdrop: css`
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 15vh;
    z-index: 150;
    ${media.mobile} {
      padding-top: max(12px, env(safe-area-inset-top));
    }
  `,
  dialog: css`
    width: min(520px, 90vw);
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 6px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-height: 70vh;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  `,
  input: css`
    width: 100%;
    padding: 10px 12px;
    background: ${theme.bg};
    color: ${theme.text};
    border: none;
    border-bottom: 1px solid ${theme.subtle};
    outline: none;
    font-size: 14px;
  `,
  item: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    cursor: pointer;
    ${media.touch} {
      min-height: ${TOUCH_TARGET};
    }
  `,
  list: css`
    overflow-y: auto;
  `,
  active: css`
    background: ${theme.hover};
  `,
};

export function CommandPalette() {
  const open = useUiStore(s => s.paletteOpen);
  return open ? <Palette /> : null;
}

function Palette() {
  const close = () => useUiStore.getState().setPaletteOpen(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selection = useCaptureStore(s => s.selection);
  const key = selection ? `${selection.entryId}:${selection.kind}` : '';
  const dynamic = useAsync(key, () =>
    selection ? selectionCommands(selection) : Promise.resolve(NO_COMMANDS),
  );
  const installable = useInstallStore(canInstall);
  const all = useMemo(
    () => [
      ...(installable ? [installCommand] : []),
      ...commands,
      ...(dynamic.status === 'ok' ? dynamic.value : []),
    ],
    [dynamic, installable],
  );
  const fuse = useMemo(
    () =>
      new Fuse(
        all.map(c => ({ ...c, name: c.name ?? c.title })),
        { keys: searchKeys, threshold: 0.4 },
      ),
    [all],
  );
  const results = useMemo(
    () => (query ? fuse.search(query).map(r => r.item) : all),
    [query, fuse, all],
  );

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    close();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') setActive(a => Math.min(results.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive(a => Math.max(0, a - 1));
    else if (e.key === 'Enter') run(results[active]);
    else return;
    e.preventDefault();
  };

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div className={styles.dialog} role="dialog" onMouseDown={e => e.stopPropagation()}>
        <input
          autoFocus
          className={styles.input}
          placeholder="Type a command…"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div role="listbox" className={styles.list}>
          {results.map((cmd, i) => (
            <div
              key={cmd.id}
              role="option"
              aria-selected={i === active}
              className={cx(styles.item, i === active && styles.active)}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(cmd)}
            >
              {cmd.title}
              {cmd.shortcut && <kbd className={ui.kbd}>{cmd.shortcut}</kbd>}
            </div>
          ))}
          {results.length === 0 && <div className={ui.empty}>No matching commands</div>}
        </div>
      </div>
    </div>
  );
}
