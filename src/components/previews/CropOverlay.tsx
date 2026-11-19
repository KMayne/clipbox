/**
 * Video cropping: a box drawn over the player (drag to draw, move or resize it) and a bar with
 * its exact size, aspect presets and Crop, which runs the `media.crop` action.
 */
import { css, cx } from '@emotion/css';
import { mdiCrop } from '@mdi/js';
import { Icon } from '@mdi/react';
import { useEffect, useRef, useState } from 'react';
import { mediaCrop } from '../../core/actions/catalog/media';
import { clock } from '../../core/mediaTime';
import { runAction } from '../../state/actions';
import type { Selection } from '../../state/captureStore';
import { theme, withAlpha } from '../../theme';
import { media, ui } from '../ui';
import {
  aspectRatio,
  ASPECTS,
  fitAspect,
  isAspectId,
  HANDLES,
  hitTest,
  inFrame,
  moveBy,
  resize,
  spanFrom,
  type AspectId,
  type Handle,
  type Point,
  type Rect,
  type Size,
} from './cropGeometry';

const CURSORS: Record<Handle | 'inside', string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  inside: 'move',
};

/** Where each handle sits on the box, as fractions of its width and height. */
const HANDLE_AT: Record<Handle, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

const styles = {
  overlay: css`
    position: absolute;
    overflow: hidden;
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  `,
  box: css`
    position: absolute;
    outline: 1px solid ${theme.accent};
    box-shadow: 0 0 0 100vmax ${withAlpha(theme.bg, 0.7)};
    pointer-events: none;
  `,
  thirds: css`
    position: absolute;
    inset: 0;
    background:
      linear-gradient(
        to right,
        transparent calc(33.33% - 0.5px),
        ${withAlpha(theme.text, 0.35)} calc(33.33% - 0.5px),
        ${withAlpha(theme.text, 0.35)} calc(33.33% + 0.5px),
        transparent calc(33.33% + 0.5px),
        transparent calc(66.67% - 0.5px),
        ${withAlpha(theme.text, 0.35)} calc(66.67% - 0.5px),
        ${withAlpha(theme.text, 0.35)} calc(66.67% + 0.5px),
        transparent calc(66.67% + 0.5px)
      ),
      linear-gradient(
        to bottom,
        transparent calc(33.33% - 0.5px),
        ${withAlpha(theme.text, 0.35)} calc(33.33% - 0.5px),
        ${withAlpha(theme.text, 0.35)} calc(33.33% + 0.5px),
        transparent calc(33.33% + 0.5px),
        transparent calc(66.67% - 0.5px),
        ${withAlpha(theme.text, 0.35)} calc(66.67% - 0.5px),
        ${withAlpha(theme.text, 0.35)} calc(66.67% + 0.5px),
        transparent calc(66.67% + 0.5px)
      );
  `,
  handle: css`
    position: absolute;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    background: ${theme.accent};
    border: 1px solid ${theme.bg};
    border-radius: 2px;
    ${media.touch} {
      width: 18px;
      height: 18px;
      margin: -9px 0 0 -9px;
    }
  `,
  size: css`
    position: absolute;
    left: 4px;
    top: 4px;
    padding: 1px 5px;
    border-radius: 3px;
    background: ${withAlpha(theme.bg, 0.8)};
    color: ${theme.text};
    font-family: ${theme.mono};
    font-size: var(--text-xs);
    white-space: nowrap;
  `,
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
  field: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: ${theme.muted};
    & input,
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
    & input {
      width: 7ch;
      font-family: ${theme.mono};
      font-size: var(--text-sm);
    }
  `,
  seek: css`
    flex: 1;
    min-width: 120px;
    accent-color: ${theme.accent};
  `,
  time: css`
    color: ${theme.muted};
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  `,
  spacer: css`
    flex: 1;
  `,
  hint: css`
    color: ${theme.faint};
    font-size: var(--text-xs);
  `,
};

/** The video element's box inside its offset parent, in CSS pixels. */
function useElementBox(el: HTMLElement): Rect {
  const read = () => ({
    left: el.offsetLeft,
    top: el.offsetTop,
    width: el.offsetWidth,
    height: el.offsetHeight,
  });
  const [box, setBox] = useState(read);
  useEffect(() => {
    const update = () => setBox(read());
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.parentElement) observer.observe(el.parentElement);
    update();
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `read` only reads `el`
  }, [el]);
  return box;
}

type Drag =
  | { kind: 'draw'; anchor: Point }
  | { kind: 'move'; from: Point; start: Rect }
  | { kind: 'resize'; handle: Handle; start: Rect };

interface OverlayProps {
  video: HTMLVideoElement;
  frame: Size;
  /** Null until a box is drawn. */
  rect: Rect | null;
  aspect: number | null;
  onChange(rect: Rect): void;
}

/** Sits exactly over the video element; the stage must be its offset parent. */
export function CropOverlay({ video, frame, rect, aspect, onChange }: OverlayProps) {
  const box = useElementBox(video);
  const drag = useRef<Drag | null>(null);
  const [cursor, setCursor] = useState('crosshair');
  const scale = box.width / frame.width || 1;

  const toVideo = (e: React.PointerEvent<HTMLDivElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  // Grab distance: 8 CSS px, more on touch screens
  const slop = (e: React.PointerEvent) => (e.pointerType === 'touch' ? 16 : 8) / scale;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const p = toVideo(e);
    const hit = rect ? hitTest(rect, p, slop(e)) : null;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (!rect || !hit) {
      // Outside the box (or no box yet): draw a new one
      const anchor = inFrame(p, frame);
      drag.current = { kind: 'draw', anchor };
      onChange(spanFrom(anchor, anchor, aspect, frame));
    } else if (hit === 'inside') drag.current = { kind: 'move', from: p, start: rect };
    else drag.current = { kind: 'resize', handle: hit, start: rect };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toVideo(e);
    const d = drag.current;
    if (!d) {
      const hit = rect && hitTest(rect, p, slop(e));
      setCursor(hit ? CURSORS[hit] : 'crosshair');
      return;
    }
    if (d.kind === 'draw') onChange(spanFrom(d.anchor, p, aspect, frame));
    else if (d.kind === 'move') onChange(moveBy(d.start, p.x - d.from.x, p.y - d.from.y, frame));
    else onChange(resize(d.start, d.handle, p, aspect, frame));
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div
      className={styles.overlay}
      data-testid="crop-overlay"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {rect && (
        <div
          className={styles.box}
          data-testid="crop-box"
          style={{
            left: rect.left * scale,
            top: rect.top * scale,
            width: rect.width * scale,
            height: rect.height * scale,
          }}
        >
          <div className={styles.thirds} />
          {HANDLES.map(h => (
            <div
              key={h}
              className={styles.handle}
              style={{ left: `${HANDLE_AT[h][0] * 100}%`, top: `${HANDLE_AT[h][1] * 100}%` }}
            />
          ))}
          <span className={styles.size}>
            {rect.width} × {rect.height}
          </span>
        </div>
      )}
    </div>
  );
}

type Quality = 'medium' | 'high' | 'very-high';
const isQuality = (s: string): s is Quality => ['medium', 'high', 'very-high'].includes(s);

interface BarProps {
  selection: Selection;
  video: HTMLVideoElement;
  frame: Size;
  /** Null until a box is drawn: the fields show the full frame. */
  rect: Rect | null;
  aspect: AspectId;
  onRect(rect: Rect): void;
  onAspect(aspect: AspectId): void;
  onClose(): void;
}

/** The playhead, following the video's events. */
function usePlayhead(video: HTMLVideoElement) {
  const [state, setState] = useState({ time: 0, duration: 0 });
  useEffect(() => {
    const update = () =>
      setState({
        time: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
      });
    update();
    const events = ['timeupdate', 'seeked', 'durationchange', 'loadedmetadata'];
    for (const e of events) video.addEventListener(e, update);
    return () => {
      for (const e of events) video.removeEventListener(e, update);
    };
  }, [video]);
  return state;
}

function seekTo(el: HTMLMediaElement, seconds: number) {
  el.currentTime = seconds;
}

/** Size fields, aspect, quality and Crop. Escape closes it. */
export function CropBar({
  selection,
  video,
  frame,
  rect,
  aspect,
  onRect,
  onAspect,
  onClose,
}: BarProps) {
  const [quality, setQuality] = useState<Quality>('high');
  const [running, setRunning] = useState(false);
  const { time, duration } = usePlayhead(video);
  const full = { left: 0, top: 0, width: frame.width, height: frame.height };
  const shown = rect ?? full;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const setField = (key: keyof Rect, text: string) => {
    const n = Math.round(Number(text));
    if (!Number.isFinite(n)) return;
    const next = { ...shown, [key]: Math.max(0, n) };
    // Keep the box inside the frame: position first, then size
    next.left = Math.min(next.left, frame.width - 2);
    next.top = Math.min(next.top, frame.height - 2);
    next.width = Math.max(2, Math.min(next.width, frame.width - next.left));
    next.height = Math.max(2, Math.min(next.height, frame.height - next.top));
    onRect(next);
  };

  const chooseAspect = (id: AspectId) => {
    onAspect(id);
    const ratio = aspectRatio(id, frame);
    if (ratio) onRect(fitAspect(shown, ratio));
  };

  const crop = async () => {
    if (!rect) return;
    setRunning(true);
    video.pause();
    try {
      const ok = await runAction(selection, mediaCrop, { ...rect, quality });
      if (ok) onClose();
    } finally {
      setRunning(false);
    }
  };

  const field = (key: keyof Rect, label: string) => (
    <label className={styles.field}>
      {label}
      <input
        aria-label={`Crop ${key}`}
        type="number"
        min={0}
        step={2}
        value={shown[key]}
        onChange={e => setField(key, e.target.value)}
      />
    </label>
  );

  return (
    <div className={styles.bar} data-testid="crop-bar">
      <div className={styles.controls}>
        <input
          className={styles.seek}
          type="range"
          aria-label="Seek"
          min={0}
          max={duration || 0}
          step="any"
          value={time}
          onChange={e => seekTo(video, Number(e.target.value))}
        />
        <span className={styles.time}>
          {clock(time)} / {clock(duration)}
        </span>
        <span className={styles.hint}>Drag on the video to draw the crop · Esc to cancel</span>
      </div>
      <form
        className={styles.controls}
        aria-label="Crop"
        onSubmit={e => {
          e.preventDefault();
          void crop();
        }}
      >
        {field('left', 'X')}
        {field('top', 'Y')}
        {field('width', 'W')}
        {field('height', 'H')}
        <label className={styles.field}>
          Aspect
          <select
            aria-label="Aspect"
            value={aspect}
            onChange={e => isAspectId(e.target.value) && chooseAspect(e.target.value)}
          >
            {ASPECTS.map(a => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={ui.button} onClick={() => onRect(full)}>
          Full frame
        </button>
        <span className={styles.spacer} />
        <label className={styles.field}>
          Quality
          <select
            aria-label="Quality"
            value={quality}
            onChange={e => isQuality(e.target.value) && setQuality(e.target.value)}
          >
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very-high">Very high</option>
          </select>
        </label>
        <button type="button" className={ui.button} onClick={onClose} disabled={running}>
          Cancel
        </button>
        <button
          type="submit"
          className={cx(ui.button, ui.primary)}
          disabled={running || !rect}
          title={rect ? 'Make a new video of the boxed area' : 'Draw a box on the video first'}
        >
          <Icon path={mdiCrop} size={0.65} />
          {running ? 'Cropping…' : 'Crop'}
        </button>
      </form>
    </div>
  );
}
