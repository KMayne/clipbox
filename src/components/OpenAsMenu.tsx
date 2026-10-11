import { css } from '@emotion/css';
import { useEffect, useRef } from 'react';
import type { Derivation } from '../core/types';
import { useCaptureStore, type Selection } from '../state/captureStore';
import { useUiStore } from '../state/uiStore';
import { theme } from '../theme';
import { ui } from './ui';

const styles = {
  wrap: css`
    position: relative;
  `,
  menu: css`
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 50;
    min-width: 160px;
    padding: 4px 0;
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  `,
  item: css`
    display: block;
    width: 100%;
    padding: 5px 12px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    &:hover,
    &:focus {
      background: ${theme.hover};
      outline: none;
    }
  `,
};

/** Runs a derivation, reporting failures as a notice. */
async function runDerivation(selection: Selection, derivation: Derivation): Promise<void> {
  try {
    await useCaptureStore.getState().derive(selection, derivation);
  } catch (err) {
    useUiStore.getState().notify(`${derivation.label} failed: ${String(err)}`, 'error');
  }
}

export function OpenAsMenu({
  selection,
  derivations,
}: {
  selection: Selection;
  derivations: Derivation[];
}) {
  const open = useUiStore(s => s.openAsOpen);
  const setOpen = useUiStore(s => s.setOpenAsOpen);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close when this inspector goes away (selection changed)
  useEffect(() => () => setOpen(false), [setOpen]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, setOpen]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') return;
    // Keep j/k, digits etc. from reaching the global shortcuts while the menu is open
    e.stopPropagation();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const i = items.findIndex(el => el === document.activeElement);
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') items[Math.max(0, i - 1)]?.focus();
    else return;
    e.preventDefault();
  };

  return (
    <span className={styles.wrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        className={ui.button}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Open as ▾
      </button>
      {open && (
        <div ref={menuRef} className={styles.menu} role="menu" onKeyDown={onKeyDown}>
          {derivations.map(d => (
            <button
              key={d.id}
              role="menuitem"
              className={styles.item}
              onClick={() => {
                setOpen(false);
                void runDerivation(selection, d);
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
