import { css, cx, keyframes } from '@emotion/css';
import { mdiClose } from '@mdi/js';
import { Icon } from '@mdi/react';
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { cancelRun, dockRun, progressText, useRunStore, type RunView } from '../state/runs';
import { theme } from '../theme';
import { media, TOUCH_TARGET } from './ui';

const slide = keyframes`
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
`;

const styles = {
  run: css`
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    column-gap: 8px;
    row-gap: 3px;
    min-width: 0;
  `,
  title: css`
    font-size: var(--text-sm);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  text: css`
    grid-column: 1;
    font-size: var(--text-xs);
    color: ${theme.muted};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  `,
  track: css`
    grid-column: 1;
    position: relative;
    height: 4px;
    border-radius: 2px;
    background: ${theme.subtle};
    overflow: hidden;
  `,
  fill: css`
    position: absolute;
    inset: 0 auto 0 0;
    background: ${theme.accent};
    border-radius: 2px;
    transition: width 0.15s linear;
  `,
  indeterminate: css`
    width: 40%;
    animation: ${slide} 1.2s ease-in-out infinite;
    @media (prefers-reduced-motion: reduce) {
      animation: none;
      width: 100%;
      opacity: 0.5;
    }
  `,
  cancel: css`
    grid-column: 2;
    grid-row: 1 / span 2;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 6px;
    background: none;
    border: 1px solid ${theme.border};
    border-radius: 4px;
    color: ${theme.muted};
    font-size: var(--text-sm);
    cursor: pointer;
    &:hover:not(:disabled) {
      color: ${theme.text};
      background: ${theme.hover};
    }
    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
    ${media.touch} {
      min-height: ${TOUCH_TARGET};
      min-width: ${TOUCH_TARGET};
      justify-content: center;
    }
  `,
  inline: css`
    padding: 2px 10px 8px 24px;
  `,
  strip: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 12px;
    width: 300px;
    max-width: 100%;
    background: ${theme.raised};
    border: 1px solid ${theme.border};
    border-radius: 4px;
    pointer-events: auto;
    ${media.mobile} {
      width: auto;
    }
  `,
};

/** One run: title (optional), bar, "message · 43%" and Cancel. */
export function RunBar({ run, showTitle }: { run: RunView; showTitle?: boolean }) {
  const text = progressText(run);
  const pct = run.fraction === undefined ? undefined : Math.round(run.fraction * 100);
  return (
    <div className={styles.run}>
      {showTitle && <div className={styles.title}>{run.title}</div>}
      <div
        className={styles.track}
        role="progressbar"
        aria-label={`${run.title} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={text}
      >
        <div
          className={cx(styles.fill, pct === undefined && styles.indeterminate)}
          style={pct === undefined ? undefined : { width: `${pct}%` }}
        />
      </div>
      <div className={styles.text}>{text}</div>
      <button
        className={styles.cancel}
        style={showTitle ? { gridRow: '1 / span 3' } : undefined}
        onClick={() => cancelRun(run.id)}
        disabled={run.cancelling}
        aria-label={`Cancel ${run.title}`}
        title={`Cancel ${run.title}`}
      >
        <Icon path={mdiClose} size={0.55} />
        Cancel
      </button>
    </div>
  );
}

/**
 * A run's bar under its sidebar row. While it's on screen the running-actions strip leaves the
 * run out; scrolled away (or the sidebar closed), the strip shows it instead.
 */
export function InlineRun({ run }: { run: RunView }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let docked = false;
    const set = (next: boolean) => {
      if (next === docked) return;
      docked = next;
      dockRun(run.id, next);
    };
    const observer = new IntersectionObserver(([e]) => set(e?.isIntersecting ?? false));
    observer.observe(el);
    return () => {
      observer.disconnect();
      set(false);
    };
  }, [run.id]);
  return (
    <div ref={ref} className={styles.inline}>
      <RunBar run={run} />
    </div>
  );
}

/** Runs not visible in the sidebar (palette-started, scrolled away, sidebar closed). */
export function RunsStrip() {
  const runs = useRunStore(useShallow(s => s.runs.filter(r => r.shown && !s.docked[r.id])));
  if (!runs.length) return null;
  return (
    <div className={styles.strip} role="group" aria-label="Running actions">
      {runs.map(r => (
        <RunBar key={r.id} run={r} showTitle />
      ))}
    </div>
  );
}
