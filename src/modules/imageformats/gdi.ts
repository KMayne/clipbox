/**
 * GDI playback shared by the EMF and WMF players: the device context (pens, brushes, fonts,
 * colours, mapping, clipping, paths) and the drawing primitives, painted through a Painter.
 * Shapes are given in logical coordinates and turned into device-space paths here.
 */

import { decodeDib, type Dib } from './dib';
import {
  apply,
  arcTo,
  compose,
  ellipsePath,
  IDENTITY,
  meanScale,
  polyPath,
  rectPath,
  rgba,
  roundRectPath,
  rotate,
  translate,
  type Affine,
  type Clip,
  type Font,
  type Paint,
  type Painter,
  type Path,
  type Stroke,
} from './painter';

export type Rgb = [number, number, number];

export interface GdiPen {
  /** PS_* style including end cap, join and type bits. */
  style: number;
  /** Logical units; 0 is one device pixel. */
  width: number;
  color: Rgb;
  /** PS_USERSTYLE dash lengths. */
  dashes?: number[];
}

export interface GdiBrush {
  /** BS_SOLID 0, BS_NULL 1, BS_HATCHED 2, pattern brushes use their average colour (0). */
  style: number;
  color: Rgb;
  hatch: number;
}

export interface GdiFont {
  height: number;
  escapement: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  face: string;
}

export type GdiObject =
  | { type: 'pen'; pen: GdiPen }
  | { type: 'brush'; brush: GdiBrush }
  | { type: 'font'; font: GdiFont }
  | { type: 'other' };

export interface DcState {
  pen: GdiPen;
  brush: GdiBrush;
  font: GdiFont;
  textColor: Rgb;
  bkColor: Rgb;
  /** TRANSPARENT 1, OPAQUE 2. */
  bkMode: number;
  /** ALTERNATE 1, WINDING 2. */
  polyFill: number;
  textAlign: number;
  /** AD_COUNTERCLOCKWISE (the default) or clockwise. */
  clockwise: boolean;
  mapMode: number;
  windowOrg: [number, number];
  windowExt: [number, number];
  viewportOrg: [number, number];
  viewportExt: [number, number];
  world: Affine;
  clip: Clip[];
  miterLimit: number;
}

export const BLACK: Rgb = [0, 0, 0];
export const WHITE: Rgb = [255, 255, 255];

export const DEFAULT_FONT: GdiFont = {
  height: 0,
  escapement: 0,
  weight: 400,
  italic: false,
  underline: false,
  strike: false,
  face: '',
};

export function defaultState(): DcState {
  return {
    pen: { style: 0, width: 0, color: BLACK },
    brush: { style: 0, color: WHITE, hatch: 0 },
    font: DEFAULT_FONT,
    textColor: BLACK,
    bkColor: WHITE,
    bkMode: 2,
    polyFill: 1,
    textAlign: 0,
    clockwise: false,
    mapMode: 1,
    windowOrg: [0, 0],
    windowExt: [1, 1],
    viewportOrg: [0, 0],
    viewportExt: [1, 1],
    world: IDENTITY,
    clip: [],
    miterLimit: 10,
  };
}

/** GetStockObject indexes (EMF flags them with 0x80000000). */
export function stockObject(index: number): GdiObject | null {
  const brush = (style: number, v: number): GdiObject => ({
    type: 'brush',
    brush: { style, color: [v, v, v], hatch: 0 },
  });
  const pen = (style: number, v: number): GdiObject => ({
    type: 'pen',
    pen: { style, width: 0, color: [v, v, v] },
  });
  switch (index) {
    case 0:
      return brush(0, 255);
    case 1:
      return brush(0, 192);
    case 2:
      return brush(0, 128);
    case 3:
      return brush(0, 64);
    case 4:
      return brush(0, 0);
    case 5:
      return brush(1, 0);
    case 6:
      return pen(0, 255);
    case 7:
      return pen(0, 0);
    case 8:
      return pen(5, 0);
    case 10:
    case 11:
    case 16:
      return { type: 'font', font: { ...DEFAULT_FONT, face: 'Courier New' } };
    case 12:
    case 13:
    case 14:
    case 17:
      return { type: 'font', font: DEFAULT_FONT };
    case 18:
      return brush(0, 255);
    case 19:
      return pen(0, 0);
    default:
      return null;
  }
}

export const css = ([r, g, b]: Rgb) => rgba(r, g, b);

/** COLORREF (0x00BBGGRR) at `o`. */
export const colorRef = (dv: DataView, o: number): Rgb => [
  dv.getUint8(o),
  dv.getUint8(o + 1),
  dv.getUint8(o + 2),
];

/** Approximate composite operations for the raster ops that matter for drawing images. */
function ropComposite(rop: number): GlobalCompositeOperation {
  switch (rop >>> 16) {
    case 0x88: // SRCAND
      return 'multiply';
    case 0xee: // SRCPAINT
      return 'lighten';
    case 0x66: // SRCINVERT
      return 'difference';
    default:
      return 'source-over';
  }
}

export interface GradientVertex {
  x: number;
  y: number;
  color: Rgb;
}

/** Text drawn by TextOut / ExtTextOut. */
export interface TextCall {
  x: number;
  y: number;
  text: string;
  /** Character advances in logical units. */
  dx: number[] | null;
  /** ETO_* flags. */
  options: number;
  /** ETO_OPAQUE / ETO_CLIPPED rectangle (logical). */
  rect: [number, number, number, number] | null;
}

export abstract class GdiPlayer {
  state: DcState = defaultState();
  private stack: DcState[] = [];
  objects: (GdiObject | null)[] = [];
  /** Current position, logical. */
  cur: [number, number] = [0, 0];
  /** Between BeginPath and EndPath: the path being built (device space). */
  private building: Path | null = null;
  /** After EndPath: the finished path for Fill/Stroke/SelectClipPath. */
  private finished: Path | null = null;
  /** Off while EMF+ draws (dual-mode GDI records are only a fallback). */
  drawing = true;

  constructor(protected painter: Painter) {}

  /** Logical → device transform for the current state. */
  abstract toDevice(): Affine;

  // --- state ---

  save(): void {
    this.stack.push({ ...this.state, clip: [...this.state.clip] });
  }

  /** RestoreDC: negative = relative (−1 is the last save), positive = absolute level. */
  restore(n: number): void {
    const target = n < 0 ? this.stack.length + n : n - 1;
    if (target < 0 || target >= this.stack.length) return;
    const s = this.stack[target];
    this.stack.length = target;
    if (s) this.state = s;
  }

  select(obj: GdiObject | null | undefined): void {
    if (!obj) return;
    if (obj.type === 'pen') this.state.pen = obj.pen;
    else if (obj.type === 'brush') this.state.brush = obj.brush;
    else if (obj.type === 'font') this.state.font = obj.font;
  }

  // --- clipping (device space) ---

  resetClip(): void {
    this.state.clip = [];
  }

  intersectClipRect(l: number, t: number, r: number, b: number): void {
    this.state.clip = [
      ...this.state.clip,
      { path: rectPath(this.toDevice(), l, t, r, b), rule: 'nonzero' },
    ];
  }

  excludeClipRect(l: number, t: number, r: number, b: number): void {
    const big = 1e7;
    const outer = rectPath(IDENTITY, -big, -big, big, big);
    const inner = rectPath(this.toDevice(), l, t, r, b);
    this.state.clip = [...this.state.clip, { path: [...outer, ...inner], rule: 'evenodd' }];
  }

  /** Region rectangles in device units; RGN_COPY replaces, RGN_AND intersects. */
  clipRegion(rects: [number, number, number, number][], mode: number): void {
    const path = rects.flatMap(([l, t, r, b]) => rectPath(IDENTITY, l, t, r, b));
    const clip: Clip = { path, rule: 'nonzero' };
    if (mode === 5) this.state.clip = rects.length ? [clip] : [];
    else if (mode === 1) this.state.clip = [...this.state.clip, clip];
    else if (mode === 4) {
      const big = 1e7;
      this.state.clip = [
        ...this.state.clip,
        { path: [...rectPath(IDENTITY, -big, -big, big, big), ...path], rule: 'evenodd' },
      ];
    }
  }

  selectClipPath(mode: number): void {
    const path = this.finished;
    this.finished = null;
    if (!path) return;
    const clip: Clip = { path, rule: this.fillRule() };
    if (mode === 5) this.state.clip = [clip];
    else this.state.clip = [...this.state.clip, clip];
  }

  // --- paths ---

  beginPath(): void {
    this.building = [];
    this.finished = null;
  }

  endPath(): void {
    this.finished = this.building;
    this.building = null;
  }

  abortPath(): void {
    this.building = null;
    this.finished = null;
  }

  closeFigure(): void {
    this.building?.push({ op: 'Z' });
  }

  fillPath(fill: boolean, stroke: boolean): void {
    const path = this.finished ?? this.building;
    this.finished = null;
    if (path) this.paint(path, fill, stroke);
  }

  // --- styles ---

  fillRule = (): CanvasFillRule => (this.state.polyFill === 2 ? 'nonzero' : 'evenodd');

  private brushPaint(): Paint | null {
    const { brush, bkMode, bkColor } = this.state;
    if (brush.style === 1) return null;
    if (brush.style === 2) {
      return {
        type: 'hatch',
        style: brush.hatch,
        color: css(brush.color),
        background: bkMode === 2 ? css(bkColor) : null,
      };
    }
    return css(brush.color);
  }

  private penStroke(): Stroke | null {
    const { pen } = this.state;
    const style = pen.style & 0xf;
    if (style === 5) return null; // PS_NULL
    const m = this.toDevice();
    const geometric = (pen.style & 0xf0000) === 0x10000;
    const width = pen.width > 0 ? pen.width * meanScale(m) : 0;
    const unit = Math.max(1, geometric ? width : 1);
    const patterns: Record<number, number[]> = {
      1: [6, 2],
      2: [1, 1],
      3: [3, 1, 1, 1],
      4: [3, 1, 1, 1, 1, 1],
    };
    let dash = (patterns[style] ?? []).map(d => d * unit * (geometric ? 1 : 3));
    if (style === 7 && pen.dashes?.length) dash = pen.dashes.map(d => d * meanScale(m));
    const cap = pen.style & 0xf00;
    const join = pen.style & 0xf000;
    return {
      color: css(pen.color),
      width,
      dash,
      cap: cap === 0x100 ? 'square' : cap === 0x200 ? 'butt' : 'round',
      join: join === 0x1000 ? 'bevel' : join === 0x2000 ? 'miter' : 'round',
      miter: this.state.miterLimit,
    };
  }

  /** Draws (or, inside a path bracket, records) a device-space path. */
  paint(path: Path, fill: boolean, stroke: boolean): void {
    if (this.building) {
      this.building.push(...path);
      return;
    }
    if (!this.drawing || path.length === 0) return;
    const clip = this.state.clip;
    const paint = fill ? this.brushPaint() : null;
    if (paint) this.painter.fill(path, this.fillRule(), paint, clip);
    const s = stroke ? this.penStroke() : null;
    if (s) this.painter.stroke(path, s, clip);
  }

  // --- shapes (logical coordinates) ---

  moveTo(x: number, y: number): void {
    this.cur = [x, y];
    if (this.building) {
      const [dx, dy] = apply(this.toDevice(), x, y);
      this.building.push({ op: 'M', x: dx, y: dy });
    }
  }

  /** LineTo, PolylineTo and PolyBezierTo: continue from the current position. */
  lineTo(points: [number, number][], bezier = false): void {
    if (points.length === 0) return;
    const m = this.toDevice();
    const [sx, sy] = apply(m, ...this.cur);
    const path: Path = this.building ? [] : [{ op: 'M', x: sx, y: sy }];
    if (this.building && !this.hasOpenFigure()) path.push({ op: 'M', x: sx, y: sy });
    if (bezier) {
      for (let i = 0; i + 2 < points.length; i += 3) {
        const [x1, y1] = apply(m, ...(points[i] ?? [0, 0]));
        const [x2, y2] = apply(m, ...(points[i + 1] ?? [0, 0]));
        const [x, y] = apply(m, ...(points[i + 2] ?? [0, 0]));
        path.push({ op: 'C', x1, y1, x2, y2, x, y });
      }
    } else {
      for (const [px, py] of points) {
        const [x, y] = apply(m, px, py);
        path.push({ op: 'L', x, y });
      }
    }
    const last = points[points.length - 1 - (bezier ? points.length % 3 : 0)];
    if (last) this.cur = last;
    this.paint(path, false, true);
  }

  private hasOpenFigure(): boolean {
    const b = this.building;
    if (!b || b.length === 0) return false;
    return b[b.length - 1]?.op !== 'Z';
  }

  polygon(points: [number, number][]): void {
    this.paint(polyPath(this.toDevice(), points, true), true, true);
  }

  polyPolygon(polys: [number, number][][]): void {
    const m = this.toDevice();
    this.paint(
      polys.flatMap(p => polyPath(m, p, true)),
      true,
      true,
    );
  }

  polyline(points: [number, number][]): void {
    this.paint(polyPath(this.toDevice(), points, false), false, true);
  }

  polyBezier(points: [number, number][]): void {
    const [first, ...rest] = points;
    if (!first) return;
    const m = this.toDevice();
    const [x0, y0] = apply(m, ...first);
    const path: Path = [{ op: 'M', x: x0, y: y0 }];
    for (let i = 0; i + 2 < rest.length; i += 3) {
      const [x1, y1] = apply(m, ...(rest[i] ?? first));
      const [x2, y2] = apply(m, ...(rest[i + 1] ?? first));
      const [x, y] = apply(m, ...(rest[i + 2] ?? first));
      path.push({ op: 'C', x1, y1, x2, y2, x, y });
    }
    this.paint(path, false, true);
  }

  rectangle(l: number, t: number, r: number, b: number): void {
    this.paint(rectPath(this.toDevice(), l, t, r, b), true, true);
  }

  roundRect(l: number, t: number, r: number, b: number, w: number, h: number): void {
    this.paint(roundRectPath(this.toDevice(), l, t, r, b, w, h), true, true);
  }

  ellipse(l: number, t: number, r: number, b: number): void {
    this.paint(ellipsePath(this.toDevice(), l, t, r, b), true, true);
  }

  /**
   * Arc, Chord and Pie: the ellipse in the box, from the radial through (xs, ys) to the one
   * through (xe, ye), counterclockwise (as seen on the device) unless the DC says clockwise.
   */
  arc(
    kind: 'arc' | 'chord' | 'pie' | 'arcto',
    box: [number, number, number, number],
    start: [number, number],
    end: [number, number],
  ): void {
    const [l, t, r, b] = box;
    const cx = (l + r) / 2;
    const cy = (t + b) / 2;
    const rx = Math.abs(r - l) / 2;
    const ry = Math.abs(b - t) / 2;
    if (rx === 0 || ry === 0) return;
    const m = this.toDevice();
    const angle = ([x, y]: [number, number]) => Math.atan2((y - cy) / ry, (x - cx) / rx);
    const a0 = angle(start);
    const a1 = angle(end);
    // Counterclockwise on a y-down device decreases the angle; a y-flipping mapping reverses it
    const flipped = m[0] * m[3] - m[1] * m[2] < 0;
    const decreasing = !this.state.clockwise !== flipped;
    let sweep = a1 - a0;
    if (decreasing) {
      if (sweep >= 0) sweep -= 2 * Math.PI;
    } else if (sweep <= 0) sweep += 2 * Math.PI;
    const path: Path = [];
    if (kind === 'pie') {
      const [x, y] = apply(m, cx, cy);
      path.push({ op: 'M', x, y });
    } else if (kind === 'arcto' && !this.hasOpenFigure()) {
      const [x, y] = apply(m, ...this.cur);
      path.push({ op: 'M', x, y });
    }
    const joined = kind === 'pie' || kind === 'arcto';
    arcTo(path, m, cx, cy, rx, ry, a0, sweep, joined ? 'L' : 'M');
    if (kind === 'chord' || kind === 'pie') path.push({ op: 'Z' });
    if (kind === 'arcto') {
      this.cur = [cx + rx * Math.cos(a0 + sweep), cy + ry * Math.sin(a0 + sweep)];
    }
    this.paint(path, kind === 'chord' || kind === 'pie', true);
  }

  /** PatBlt-style fills: the brush (or black/white) over a logical rectangle. */
  fillRect(l: number, t: number, r: number, b: number, rop: number): void {
    if (!this.drawing || this.building) return;
    const path = rectPath(this.toDevice(), l, t, r, b);
    const op = rop >>> 16;
    const paint =
      op === 0x00 ? '#000' : op === 0xff ? '#fff' : op === 0xaa ? null : this.brushPaint();
    if (paint) this.painter.fill(path, 'nonzero', paint, this.state.clip);
  }

  /** GradientFill rectangles: a linear gradient between the two corner colours. */
  gradientRect(a: GradientVertex, b: GradientVertex, vertical: boolean): void {
    if (!this.drawing || this.building) return;
    const m = this.toDevice();
    const [x0, y0] = apply(m, a.x, a.y);
    const [x1, y1] = vertical ? apply(m, a.x, b.y) : apply(m, b.x, a.y);
    this.painter.fill(
      rectPath(m, a.x, a.y, b.x, b.y),
      'nonzero',
      {
        type: 'linear',
        x0,
        y0,
        x1,
        y1,
        stops: [
          [0, css(a.color)],
          [1, css(b.color)],
        ],
      },
      this.state.clip,
    );
  }

  /** GradientFill triangles, approximated with their average colour. */
  gradientTriangle(a: GradientVertex, b: GradientVertex, c: GradientVertex): void {
    if (!this.drawing || this.building) return;
    const avg = (i: number) =>
      Math.round(((a.color[i] ?? 0) + (b.color[i] ?? 0) + (c.color[i] ?? 0)) / 3);
    const path = polyPath(
      this.toDevice(),
      [
        [a.x, a.y],
        [b.x, b.y],
        [c.x, c.y],
      ],
      true,
    );
    this.painter.fill(path, 'nonzero', css([avg(0), avg(1), avg(2)]), this.state.clip);
  }

  // --- text ---

  /** Device-space font size and angle for the selected font. */
  text(call: TextCall): void {
    if (!this.drawing || this.building || call.text.length === 0) return;
    const { font, textAlign, textColor, bkColor } = this.state;
    const m = this.toDevice();
    const ySize = Math.hypot(m[2], m[3]);
    const xSize = Math.hypot(m[0], m[1]);
    // Negative heights are the em size; positive ones the cell height (≈ 1.15 em)
    const em = font.height < 0 ? -font.height : font.height > 0 ? font.height / 1.15 : 0;
    const size = em > 0 ? em * ySize : 16;
    const updateCp = (textAlign & 1) === 1;
    const [rx, ry] = updateCp ? this.cur : [call.x, call.y];
    const [x, y] = apply(m, rx, ry);
    const horizontal = textAlign & 6;
    const vertical = textAlign & 24;

    if (call.rect && call.options & 2) {
      // ETO_OPAQUE: fill the rectangle with the background colour
      const [l, t, r, b] = call.rect;
      this.painter.fill(rectPath(m, l, t, r, b), 'nonzero', css(bkColor), this.state.clip);
    }
    const clip =
      call.rect && call.options & 4
        ? [...this.state.clip, { path: rectPath(m, ...call.rect), rule: 'nonzero' as const }]
        : this.state.clip;
    const f: Font = {
      family: font.face,
      size,
      weight: font.weight || 400,
      italic: font.italic,
      underline: font.underline,
      strike: font.strike,
    };
    const dx = call.dx?.map(d => d * xSize);
    this.painter.text(
      {
        text: call.text,
        font: f,
        color: css(textColor),
        // Escapement is tenths of a degree counterclockwise; a rotating world transform adds
        matrix: compose(
          translate(x, y),
          rotate(Math.atan2(m[1], Math.abs(m[0])) - (font.escapement / 10) * (Math.PI / 180)),
        ),
        x: 0,
        y: 0,
        align: horizontal === 6 ? 'center' : horizontal === 2 ? 'right' : 'left',
        baseline: vertical === 24 ? 'alphabetic' : vertical === 8 ? 'bottom' : 'top',
        ...(dx && dx.length > 0 && { dx }),
      },
      clip,
    );
    if (updateCp) {
      const advance = call.dx
        ? call.dx.reduce((s, d) => s + d, 0)
        : this.painter.measure(call.text, f) / Math.max(1e-9, xSize);
      this.cur = [rx + advance, ry];
    }
  }

  // --- bitmaps ---

  /**
   * Draws a DIB's source rectangle into a logical destination rectangle. `bottomUpOrigin`:
   * StretchDIBits measures a bottom-up DIB's source y from its bottom edge.
   */
  async blit(
    info: Uint8Array,
    bits: Uint8Array,
    src: [number, number, number, number],
    dest: [number, number, number, number],
    rop: number,
    opts: { bottomUpOrigin?: boolean; alpha?: number; srcAlpha?: boolean; transparent?: Rgb } = {},
  ): Promise<void> {
    if (!this.drawing || this.building) return;
    let dib: Dib;
    try {
      dib = decodeDib(info, bits, { alpha: opts.srcAlpha });
    } catch {
      return;
    }
    const width = dib.type === 'raster' ? dib.raster.width : dib.width;
    const height = dib.type === 'raster' ? dib.raster.height : dib.height;
    let [sx, sy, sw, sh] = src;
    if (sw === 0 || sh === 0) [sx, sy, sw, sh] = [0, 0, width, height];
    if (opts.bottomUpOrigin && dib.type === 'raster' && !isTopDown(info)) sy = height - sy - sh;
    const [dx, dy, dw, dh] = dest;
    if (dib.type === 'raster' && opts.transparent) {
      const [tr, tg, tb] = opts.transparent;
      const px = dib.raster.data;
      for (let o = 0; o < px.length; o += 4) {
        if (px[o] === tr && px[o + 1] === tg && px[o + 2] === tb) px[o + 3] = 0;
      }
    }
    const matrix = compose(this.toDevice(), [dw / sw, 0, 0, dh / sh, dx, dy]);
    await this.painter.image(
      {
        image: dib.type === 'raster' ? dib.raster : { bytes: dib.bytes, mime: dib.mime },
        sx,
        sy,
        sw,
        sh,
        matrix,
        alpha: opts.alpha ?? 1,
        composite: ropComposite(rop),
      },
      this.state.clip,
    );
  }
}

function isTopDown(info: Uint8Array): boolean {
  const dv = new DataView(info.buffer, info.byteOffset, info.byteLength);
  return dv.getUint32(0, true) !== 12 && dv.getInt32(8, true) < 0;
}

/** Pattern brushes: the average colour of their bitmap (a fair stand-in when tiled small). */
export function patternColor(info: Uint8Array, bits: Uint8Array): Rgb {
  try {
    const dib = decodeDib(info, bits);
    if (dib.type !== 'raster') return [128, 128, 128];
    const px = dib.raster.data;
    let r = 0;
    let g = 0;
    let b = 0;
    const n = px.length / 4;
    for (let o = 0; o < px.length; o += 4) {
      r += px[o] ?? 0;
      g += px[o + 1] ?? 0;
      b += px[o + 2] ?? 0;
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  } catch {
    return [128, 128, 128];
  }
}
