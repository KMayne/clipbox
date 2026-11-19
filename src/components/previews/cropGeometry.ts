/**
 * Crop box geometry for the video crop overlay, in video pixels. Pure, so it's unit-tested.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Corners and edges of the box, by compass direction. */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The smallest box, in video pixels. */
export const MIN_SIZE = 16;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const rounded = (r: Rect): Rect => ({
  left: Math.round(r.left),
  top: Math.round(r.top),
  width: Math.round(r.width),
  height: Math.round(r.height),
});

/** `p` clamped into the frame. */
export const inFrame = (p: Point, frame: Size): Point => ({
  x: clamp(p.x, 0, frame.width),
  y: clamp(p.y, 0, frame.height),
});

/**
 * The box from `anchor` towards `p`, at `aspect` (width / height) when given, kept inside the
 * frame and at least MIN_SIZE (or as big as the frame allows).
 */
export function spanFrom(anchor: Point, p: Point, aspect: number | null, frame: Size): Rect {
  const q = inFrame(p, frame);
  const dirX = q.x >= anchor.x ? 1 : -1;
  const dirY = q.y >= anchor.y ? 1 : -1;
  const maxW = dirX > 0 ? frame.width - anchor.x : anchor.x;
  const maxH = dirY > 0 ? frame.height - anchor.y : anchor.y;
  let w = Math.max(Math.abs(q.x - anchor.x), Math.min(MIN_SIZE, maxW));
  let h = Math.max(Math.abs(q.y - anchor.y), Math.min(MIN_SIZE, maxH));
  if (aspect) {
    if (w / h > aspect) w = h * aspect;
    else h = w / aspect;
    if (w > maxW) [w, h] = [maxW, maxW / aspect];
    if (h > maxH) [w, h] = [maxH * aspect, maxH];
  } else {
    w = Math.min(w, maxW);
    h = Math.min(h, maxH);
  }
  return rounded({
    left: dirX > 0 ? anchor.x : anchor.x - w,
    top: dirY > 0 ? anchor.y : anchor.y - h,
    width: w,
    height: h,
  });
}

/** `rect` moved by `dx`, `dy`, kept inside the frame. */
export function moveBy(rect: Rect, dx: number, dy: number, frame: Size): Rect {
  return rounded({
    ...rect,
    left: clamp(rect.left + dx, 0, frame.width - rect.width),
    top: clamp(rect.top + dy, 0, frame.height - rect.height),
  });
}

/** `rect` with `handle` dragged to `p`; the opposite corner or edge stays put. */
export function resize(
  rect: Rect,
  handle: Handle,
  p: Point,
  aspect: number | null,
  frame: Size,
): Rect {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  // Corners span from the opposite corner
  if (handle.length === 2) {
    const anchor = {
      x: handle.includes('w') ? right : rect.left,
      y: handle.includes('n') ? bottom : rect.top,
    };
    return spanFrom(anchor, p, aspect, frame);
  }
  const q = inFrame(p, frame);
  const horizontal = handle === 'e' || handle === 'w';
  if (!aspect) {
    if (handle === 'w') {
      const left = Math.min(q.x, right - MIN_SIZE);
      return rounded({ ...rect, left, width: right - left });
    }
    if (handle === 'e')
      return rounded({ ...rect, width: Math.max(q.x, rect.left + MIN_SIZE) - rect.left });
    if (handle === 'n') {
      const top = Math.min(q.y, bottom - MIN_SIZE);
      return rounded({ ...rect, top, height: bottom - top });
    }
    return rounded({ ...rect, height: Math.max(q.y, rect.top + MIN_SIZE) - rect.top });
  }
  // With an aspect, the other dimension follows, centred on the box's middle
  if (horizontal) {
    const fixed = handle === 'w' ? right : rect.left;
    const maxH = frame.height;
    let w = Math.max(MIN_SIZE, Math.abs(q.x - fixed));
    w = Math.min(w, handle === 'w' ? fixed : frame.width - fixed, maxH * aspect);
    const h = w / aspect;
    const cy = rect.top + rect.height / 2;
    const top = clamp(cy - h / 2, 0, frame.height - h);
    return rounded({ left: handle === 'w' ? fixed - w : fixed, top, width: w, height: h });
  }
  const fixed = handle === 'n' ? bottom : rect.top;
  let h = Math.max(MIN_SIZE, Math.abs(q.y - fixed));
  h = Math.min(h, handle === 'n' ? fixed : frame.height - fixed, frame.width / aspect);
  const w = h * aspect;
  const cx = rect.left + rect.width / 2;
  const left = clamp(cx - w / 2, 0, frame.width - w);
  return rounded({ left, top: handle === 'n' ? fixed - h : fixed, width: w, height: h });
}

/** The largest box at `aspect` inside `rect`, centred on it. */
export function fitAspect(rect: Rect, aspect: number): Rect {
  const w = rect.width / rect.height > aspect ? rect.height * aspect : rect.width;
  const h = w / aspect;
  return rounded({
    left: rect.left + (rect.width - w) / 2,
    top: rect.top + (rect.height - h) / 2,
    width: w,
    height: h,
  });
}

/** Which part of the box a point (video pixels) is on: a handle, inside, or outside. */
export function hitTest(rect: Rect, p: Point, slop: number): Handle | 'inside' | null {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const near = (a: number, b: number) => Math.abs(a - b) <= slop;
  const inX = p.x >= rect.left - slop && p.x <= right + slop;
  const inY = p.y >= rect.top - slop && p.y <= bottom + slop;
  if (!inX || !inY) return null;
  const n = near(p.y, rect.top);
  const s = near(p.y, bottom);
  const w = near(p.x, rect.left);
  const e = near(p.x, right);
  if (n && w) return 'nw';
  if (n && e) return 'ne';
  if (s && w) return 'sw';
  if (s && e) return 'se';
  if (n) return 'n';
  if (s) return 's';
  if (w) return 'w';
  if (e) return 'e';
  return p.x > rect.left && p.x < right && p.y > rect.top && p.y < bottom ? 'inside' : null;
}

/** Aspect presets: width / height, or the frame's own. */
export const ASPECTS = [
  { id: 'free', label: 'Free' },
  { id: 'original', label: 'Original' },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
] as const;
export type AspectId = (typeof ASPECTS)[number]['id'];

export function aspectRatio(id: AspectId, frame: Size): number | null {
  if (id === 'free') return null;
  if (id === 'original') return frame.width / frame.height;
  const preset = ASPECTS.find(a => a.id === id);
  return preset && 'ratio' in preset ? preset.ratio : null;
}

export const isAspectId = (s: string): s is AspectId => ASPECTS.some(a => a.id === s);
