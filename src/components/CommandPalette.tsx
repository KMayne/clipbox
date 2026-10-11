import { css, cx } from '@emotion/css';
import Fuse from 'fuse.js';
import { useMemo, useState } from 'react';
import { commands, type Command } from '../commands';
import { useUiStore } from '../state/uiStore';
import { theme } from '../theme';
import { ui } from './ui';

const fuse = new Fuse(commands, { keys: ['title'], threshold: 0.4 });

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
  `,
  dialog: css`
    width: min(520px, 90vw);
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 6px;
    overflow: hidden;
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
    padding: 6px 12px;
    cursor: pointer;
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
  const results = useMemo(() => (query ? fuse.search(query).map(r => r.item) : commands), [query]);

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
        <div role="listbox">
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
