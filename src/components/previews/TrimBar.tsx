/**
 * Top and tail under the player: mark the start and end at the playhead (or type them), then
 * Trim runs the `media.trim` action with those settings and adds the result as a new capture.
 */
import { css, cx } from '@emotion/css';
import { mdiContentCut, mdiPlay, mdiRayEndArrow, mdiRayStartArrow } from '@mdi/js';
import { Icon } from '@mdi/react';
import { useEffect, useState } from 'react';
import { isEditable } from '../../capture/sources';
import { mediaTrim } from '../../core/actions/catalog/media';
import { clock, parseTrimPoint, pointSeconds } from '../../core/mediaTime';
import { engine } from '../../engine/engineClient';
import { runAction } from '../../state/actions';
import type { Selection } from '../../state/captureStore';
import { useUiStore } from '../../state/uiStore';
import { theme } from '../../theme';
import { media, ui } from '../ui';
import { useAsync } from '../useAsync';

const styles = {
  bar: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 16px 12px;
    background: ${theme.panel};
    border-top: 1px solid ${theme.border};
  `,
  controls: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    font-size: var(--text-sm);
  `,
  point: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: ${theme.muted};
    & input {
      width: 8.5ch;
      padding: 3px 6px;
      background: ${theme.bg};
      color: ${theme.text};
      border: 1px solid ${theme.border};
      border-radius: 4px;
      font-family: ${theme.mono};
      font-size: var(--text-sm);
      ${media.touch} {
        min-height: 40px;
      }
    }
    & select {
      padding: 3px 6px;
      background: ${theme.bg};
      color: ${theme.text};
      border: 1px solid ${theme.border};
      border-radius: 4px;
      ${media.touch} {
        min-height: 40px;
      }
    }
  `,
  spacer: css`
    flex: 1;
  `,
  strip: css`
    position: relative;
    height: 14px;
    border-radius: 3px;
    background: ${theme.bg};
    border: 1px solid ${theme.border};
    cursor: pointer;
    overflow: hidden;
    ${media.touch} {
      height: 24px;
    }
  `,
  region: css`
    position: absolute;
    top: 0;
    bottom: 0;
    background: ${theme.accent};
    opacity: 0.45;
  `,
  pair: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;
  `,
  playhead: css`
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: ${theme.text};
    pointer-events: none;
  `,
  error: css`
    color: ${theme.error};
    font-size: var(--text-sm);
  `,
  summary: css`
    color: ${theme.muted};
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  `,
};

interface Props {
  selection: Selection;
  /** The player the marks are read from. */
  player: HTMLMediaElement | null;
}

/** The player's duration and playhead, following its events. */
function usePlayhead(player: HTMLMediaElement | null) {
  const [state, setState] = useState({ time: 0, duration: 0 });
  useEffect(() => {
    if (!player) return;
    const update = () =>
      setState({
        time: player.currentTime,
        duration: Number.isFinite(player.duration) ? player.duration : 0,
      });
    update();
    const events = ['timeupdate', 'seeked', 'durationchange', 'loadedmetadata'];
    for (const e of events) player.addEventListener(e, update);
    return () => {
      for (const e of events) player.removeEventListener(e, update);
    };
  }, [player]);
  return state;
}

function seekTo(el: HTMLMediaElement, seconds: number) {
  el.currentTime = seconds;
}

/** A setting as seconds, or null when it doesn't parse (the action reports why on Trim). */
function seconds(text: string, fallback: number, duration: number): number | null {
  try {
    const point = parseTrimPoint(text);
    return point ? pointSeconds(point, 0, duration) : fallback;
  } catch {
    return null;
  }
}

/** Shown only where the Trim action applies (containers Mediabunny reads). */
export function TrimBar({ selection, player }: Props) {
  const applies = useAsync(`trim:${selection.entryId}:${selection.kind}`, () =>
    engine.actions(selection.entryId, selection.kind),
  );
  if (applies.status !== 'ok' || !applies.value.includes(mediaTrim.id)) return null;
  return <TrimControls key={selection.entryId} selection={selection} player={player} />;
}

function TrimControls({ selection, player }: Props) {
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState('');
  const [mode, setMode] = useState<'fast' | 'exact'>('fast');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const { time, duration } = usePlayhead(player);

  const from = seconds(start, 0, duration);
  const to = seconds(end, duration, duration);
  const range = from !== null && to !== null && duration > 0 && to > from ? { from, to } : null;

  const markStart = () => {
    if (!player) return;
    setError(null);
    setStart(clock(player.currentTime));
  };
  const markEnd = () => {
    if (!player) return;
    setError(null);
    setEnd(clock(player.currentTime));
  };

  // [ and ] mark at the playhead, like the buttons
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      if (useUiStore.getState().paletteOpen || !player) return;
      if (e.key === '[') setStart(clock(player.currentTime));
      else if (e.key === ']') setEnd(clock(player.currentTime));
      else return;
      setError(null);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [player]);

  // Play range stops at the end mark
  const stopAt = range?.to ?? null;
  useEffect(() => {
    if (!player || !previewing) return;
    const stop = () => setPreviewing(false);
    const check = () => {
      if (stopAt !== null && player.currentTime >= stopAt) {
        player.pause();
        stop();
      }
    };
    player.addEventListener('timeupdate', check);
    player.addEventListener('pause', stop);
    return () => {
      player.removeEventListener('timeupdate', check);
      player.removeEventListener('pause', stop);
    };
  }, [player, previewing, stopAt]);

  const playRange = () => {
    if (!player || !range) return;
    seekTo(player, range.from);
    setPreviewing(true);
    void player.play().catch(() => setPreviewing(false));
  };

  const trim = async () => {
    const params = { start, end, mode };
    const parsed = mediaTrim.params.safeParse(params);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid times');
      return;
    }
    if (duration > 0 && !range) {
      setError('The end must be after the start');
      return;
    }
    setError(null);
    setRunning(true);
    player?.pause();
    try {
      await runAction(selection, mediaTrim, params);
    } finally {
      setRunning(false);
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!player || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo(player, ((e.clientX - rect.left) / rect.width) * duration);
  };

  const pct = (s: number) => `${Math.min(100, Math.max(0, (s / duration) * 100))}%`;

  return (
    <div className={styles.bar} data-testid="trim-bar">
      {duration > 0 && (
        <div
          className={styles.strip}
          data-testid="trim-strip"
          onClick={seek}
          title="Click to seek"
          role="presentation"
        >
          {range && (
            <div
              className={styles.region}
              style={{
                left: pct(range.from),
                width: `calc(${pct(range.to)} - ${pct(range.from)})`,
              }}
            />
          )}
          <div className={styles.playhead} style={{ left: pct(time) }} />
        </div>
      )}
      <form
        className={styles.controls}
        aria-label="Trim"
        onSubmit={e => {
          e.preventDefault();
          void trim();
        }}
      >
        <span className={styles.pair}>
          <button
            type="button"
            className={ui.button}
            onClick={markStart}
            disabled={!player}
            title="Set the start at the playhead ( [ )"
          >
            <Icon path={mdiRayStartArrow} size={0.65} />
            Set start
          </button>
          <label className={styles.point}>
            Start
            <input
              aria-label="Trim start"
              value={start}
              spellCheck={false}
              onChange={e => {
                setError(null);
                setStart(e.target.value);
              }}
            />
          </label>
        </span>
        <span className={styles.pair}>
          <label className={styles.point}>
            End
            <input
              aria-label="Trim end"
              value={end}
              placeholder={duration ? clock(duration) : 'end'}
              spellCheck={false}
              onChange={e => {
                setError(null);
                setEnd(e.target.value);
              }}
            />
          </label>
          <button
            type="button"
            className={ui.button}
            onClick={markEnd}
            disabled={!player}
            title="Set the end at the playhead ( ] )"
          >
            Set end
            <Icon path={mdiRayEndArrow} size={0.65} />
          </button>
        </span>
        {range && (
          <span className={styles.summary} data-testid="trim-length">
            {clock(range.to - range.from)} kept
          </span>
        )}
        <span className={styles.spacer} />
        <button
          type="button"
          className={ui.button}
          onClick={playRange}
          disabled={!player || !range}
          title="Play from the start mark to the end mark"
        >
          <Icon path={mdiPlay} size={0.65} />
          Play range
        </button>
        <label className={styles.point}>
          <select
            aria-label="Cut"
            value={mode}
            onChange={e => setMode(e.target.value === 'exact' ? 'exact' : 'fast')}
            title="Fast copies without re-encoding, so video may start at the keyframe before the start. Exact re-encodes when the cut needs it."
          >
            <option value="fast">Fast</option>
            <option value="exact">Exact</option>
          </select>
        </label>
        <button type="submit" className={cx(ui.button, ui.primary)} disabled={running}>
          <Icon path={mdiContentCut} size={0.65} />
          {running ? 'Trimming…' : 'Trim'}
        </button>
      </form>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
