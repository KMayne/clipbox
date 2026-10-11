/**
 * What the metafile players (EMF, EMF+, WMF) draw with: paths, text and images in device
 * coordinates. The real painter draws on an OffscreenCanvas (canvasPainter.ts); tests record.
 */

import type { Raster } from './raster';

/** 2D affine transform as in canvas: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** `m ∘ n`: applies `n` first, then `m`. */
export function compose(m: Affine, n: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = n;
  return [
    a * A + c * B,
    b * A + d * B,
    a * C + c * D,
    b * C + d * D,
    a * E + c * F + e,
    b * E + d * F + f,
  ];
}

export const apply = (m: Affine, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

export const translate = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];
export const scale = (x: number, y = x): Affine => [x, 0, 0, y, 0, 0];
export const rotate = (radians: number): Affine => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, s, -s, c, 0, 0];
};

/** Geometric mean of the axis scales: how much the transform grows lengths, on average. */
export const meanScale = (m: Affine) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

export type PathCmd =
  | { op: 'M' | 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' };

/** A path in device coordinates. */
export type Path = PathCmd[];

export type Paint =
  | string
  | {
      type: 'linear';
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      stops: [number, string][];
    }
  | {
      /** GDI hatch styles 0–5 (horizontal, vertical, \, /, +, x), in device pixels. */
      type: 'hatch';
      style: number;
      color: string;
      background: string | null;
    };

export interface Stroke {
  color: string;
  /** Device units; at least one output pixel is drawn. */
  width: number;
  dash: number[];
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  miter: number;
}

/** One clip shape; a drawing is clipped to the intersection of all of them. */
export interface Clip {
  path: Path;
  rule: CanvasFillRule;
}

export interface Font {
  family: string;
  /** Em size in text-space units. */
  size: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

export interface TextRun {
  text: string;
  font: Font;
  color: string;
  /** Text space → device. Text is drawn upright in text space at (x, y). */
  matrix: Affine;
  x: number;
  y: number;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  /** Advance after each character (text-space units), for exact placement. */
  dx?: number[];
}

export type ImageSource = Raster | { bytes: Uint8Array<ArrayBuffer>; mime: string };

export interface ImageDraw {
  image: ImageSource;
  /** Source rectangle in image pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Source-rectangle space (origin at its top-left, unit = one source pixel) → device. */
  matrix: Affine;
  alpha: number;
  composite: GlobalCompositeOperation;
}

export interface Painter {
  fill(path: Path, rule: CanvasFillRule, paint: Paint, clip: Clip[]): void;
  stroke(path: Path, stroke: Stroke, clip: Clip[]): void;
  text(run: TextRun, clip: Clip[]): void;
  /** Width of `text` in `font`, in the font's units. */
  measure(text: string, font: Font): number;
  image(draw: ImageDraw, clip: Clip[]): Promise<void>;
}

// --- Path building (all in device space, from logical shapes and a logical → device transform) ---

export const rectPath = (m: Affine, l: number, t: number, r: number, b: number): Path => {
  const pts = [apply(m, l, t), apply(m, r, t), apply(m, r, b), apply(m, l, b)];
  return [...pts.map(([x, y], i): PathCmd => ({ op: i === 0 ? 'M' : 'L', x, y })), { op: 'Z' }];
};

export function polyPath(m: Affine, points: [number, number][], close: boolean): Path {
  const path: Path = points.map(([px, py], i) => {
    const [x, y] = apply(m, px, py);
    return { op: i === 0 ? 'M' : 'L', x, y };
  });
  if (close && path.length > 0) path.push({ op: 'Z' });
  return path;
}

/**
 * Appends an elliptical arc (centre, radii, start angle and sweep in radians, in logical space)
 * as cubic Béziers; affine transforms keep them exact. Starts with M or L from `start`.
 */
export function arcTo(
  path: Path,
  m: Affine,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  start: number,
  sweep: number,
  begin: 'M' | 'L',
): void {
  const segments = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (t: number) => apply(m, cx + rx * Math.cos(t), cy + ry * Math.sin(t));
  const [x0, y0] = at(start);
  path.push({ op: begin, x: x0, y: y0 });
  for (let i = 0; i < segments; i++) {
    const t0 = start + i * step;
    const t1 = t0 + step;
    const [x1, y1] = apply(
      m,
      cx + rx * (Math.cos(t0) - k * Math.sin(t0)),
      cy + ry * (Math.sin(t0) + k * Math.cos(t0)),
    );
    const [x2, y2] = apply(
      m,
      cx + rx * (Math.cos(t1) + k * Math.sin(t1)),
      cy + ry * (Math.sin(t1) - k * Math.cos(t1)),
    );
    const [x, y] = at(t1);
    path.push({ op: 'C', x1, y1, x2, y2, x, y });
  }
}

export function ellipsePath(m: Affine, l: number, t: number, r: number, b: number): Path {
  const path: Path = [];
  arcTo(
    path,
    m,
    (l + r) / 2,
    (t + b) / 2,
    Math.abs(r - l) / 2,
    Math.abs(b - t) / 2,
    0,
    2 * Math.PI,
    'M',
  );
  path.push({ op: 'Z' });
  return path;
}

export function roundRectPath(
  m: Affine,
  l: number,
  t: number,
  r: number,
  b: number,
  w: number,
  h: number,
): Path {
  const [x0, x1] = [Math.min(l, r), Math.max(l, r)];
  const [y0, y1] = [Math.min(t, b), Math.max(t, b)];
  const rx = Math.min(Math.abs(w) / 2, (x1 - x0) / 2);
  const ry = Math.min(Math.abs(h) / 2, (y1 - y0) / 2);
  if (rx <= 0 || ry <= 0) return rectPath(m, x0, y0, x1, y1);
  const path: Path = [];
  const H = Math.PI / 2;
  arcTo(path, m, x0 + rx, y0 + ry, rx, ry, Math.PI, H, 'M');
  arcTo(path, m, x1 - rx, y0 + ry, rx, ry, -H, H, 'L');
  arcTo(path, m, x1 - rx, y1 - ry, rx, ry, 0, H, 'L');
  arcTo(path, m, x0 + rx, y1 - ry, rx, ry, H, H, 'L');
  path.push({ op: 'Z' });
  return path;
}

/** "rgb(r g b / a)" with a in 0…1. */
export const rgba = (r: number, g: number, b: number, a = 1) =>
  a >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${Math.round(a * 1000) / 1000})`;
