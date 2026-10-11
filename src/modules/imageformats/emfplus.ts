/**
 * EMF+ (GDI+) records, embedded in EMF comment records. Covers the drawing most files use:
 * solid, hatch and linear-gradient brushes, pens with dashes, paths, rectangles, ellipses, arcs,
 * polygons, curves, Béziers, bitmaps (raw pixels or PNG/JPEG), strings, transforms, containers
 * and rectangle/path clipping. Anything else counts as unsupported, so a dual-mode file can be
 * re-rendered from its plain EMF records instead.
 */

import {
  apply,
  arcTo,
  compose,
  IDENTITY,
  rectPath,
  rgba,
  rotate,
  scale,
  translate,
  type Affine,
  type Clip,
  type Font,
  type ImageSource,
  type Paint,
  type Painter,
  type Path,
  type Stroke,
} from './painter';
import { newRaster } from './raster';

export const EMF_PLUS = 0x2b464d45; // "EMF+"

interface PlusPen {
  width: number;
  unit: number;
  paint: Paint;
  dash: number[];
  startCap: number;
  join: number;
  miter: number;
  transform: Affine | null;
}

interface PlusPath {
  points: [number, number][];
  types: number[];
}

interface PlusFont {
  size: number;
  unit: number;
  style: number;
  family: string;
}

interface PlusFormat {
  flags: number;
  align: number;
  lineAlign: number;
}

/** Regions as an intersection of clips; null is empty. */
type Region = Clip[] | null;

type PlusObject =
  | { type: 'brush'; paint: Paint }
  | { type: 'pen'; pen: PlusPen }
  | { type: 'path'; path: PlusPath }
  | { type: 'region'; region: Region }
  | { type: 'image'; image: ImageSource; width: number; height: number }
  | { type: 'font'; font: PlusFont }
  | { type: 'format'; format: PlusFormat }
  | { type: 'other' };

interface PlusState {
  world: Affine;
  pageUnit: number;
  pageScale: number;
  clip: Clip[];
}

/** The GDI side the EMF+ player switches off (dual files) and back on after GetDC. */
export interface GdiSwitch {
  drawing: boolean;
}

const BIG = 1e7;

/** ARGB stored little-endian (B, G, R, A). */
const argb = (dv: DataView, o: number) =>
  rgba(dv.getUint8(o + 2), dv.getUint8(o + 1), dv.getUint8(o), dv.getUint8(o + 3) / 255);

const utf16 = (dv: DataView, o: number, chars: number) => {
  let s = '';
  for (let i = 0; i < chars && o + i * 2 + 1 < dv.byteLength; i++) {
    s += String.fromCharCode(dv.getUint16(o + i * 2, true));
  }
  return s;
};

export class EmfPlusPlayer {
  dual = false;
  seen = false;
  /** Drawing records we couldn't render. */
  unsupported = 0;
  private dpiX = 96;
  private dpiY = 96;
  private state: PlusState = { world: IDENTITY, pageUnit: 2, pageScale: 1, clip: [] };
  private saved = new Map<number, PlusState>();
  private objects = new Map<number, PlusObject>();
  /** A continued (split) object being collected. */
  private pending: { id: number; flags: number; total: number; chunks: Uint8Array[] } | null = null;

  constructor(
    private painter: Painter,
    private gdi: GdiSwitch,
  ) {}

  /** Device pixels per page unit. */
  private unitScale(unit: number, dpi: number): number {
    switch (unit) {
      case 3:
        return dpi / 72; // point
      case 4:
        return dpi; // inch
      case 5:
        return dpi / 300; // document
      case 6:
        return dpi / 25.4; // millimetre
      default:
        return 1; // world, display, pixel
    }
  }

  private toDevice(): Affine {
    const { pageUnit, pageScale, world } = this.state;
    return compose(
      scale(
        this.unitScale(pageUnit, this.dpiX) * pageScale,
        this.unitScale(pageUnit, this.dpiY) * pageScale,
      ),
      world,
    );
  }

  /** Plays the EMF+ records in one comment record's data (`from`…`to`). */
  async play(dv: DataView, from: number, to: number): Promise<void> {
    let pos = from;
    while (pos + 12 <= to) {
      const type = dv.getUint16(pos, true);
      const flags = dv.getUint16(pos + 2, true);
      const size = dv.getUint32(pos + 4, true);
      const dataSize = dv.getUint32(pos + 8, true);
      if (size < 12 || pos + size > to) break;
      const data = new DataView(dv.buffer, dv.byteOffset + pos + 12, Math.min(dataSize, size - 12));
      // Any EMF+ record ends a GetDC section
      if (this.dual || this.seen) this.gdi.drawing = false;
      try {
        await this.record(type, flags, data);
      } catch {
        this.unsupported++;
      }
      pos += size;
    }
  }

  private async record(type: number, flags: number, d: DataView): Promise<void> {
    const S = (flags & 0x8000) !== 0;
    const C = (flags & 0x4000) !== 0;
    const id = flags & 0xff;
    switch (type) {
      case 0x4001: // Header
        this.seen = true;
        this.dual = (flags & 1) === 1;
        this.dpiX = d.getUint32(8, true) || 96;
        this.dpiY = d.getUint32(12, true) || 96;
        this.gdi.drawing = false;
        return;
      case 0x4002: // EndOfFile
        return;
      case 0x4003: // Comment
        return;
      case 0x4004: // GetDC: the GDI records that follow draw
        this.gdi.drawing = true;
        return;
      case 0x4008:
        return this.object(flags, d);
      case 0x4009: // Clear
        this.painter.fill(
          rectPath(IDENTITY, -BIG, -BIG, BIG, BIG),
          'nonzero',
          argb(d, 0),
          this.state.clip,
        );
        return;
      case 0x400a: {
        // FillRects
        const paint = this.brush(S, d.getUint32(0, true));
        const count = d.getUint32(4, true);
        const m = this.toDevice();
        const path = this.rects(d, 8, count, C).flatMap(([x, y, w, h]) =>
          rectPath(m, x, y, x + w, y + h),
        );
        if (paint) this.painter.fill(path, 'nonzero', paint, this.state.clip);
        return;
      }
      case 0x400b: {
        // DrawRects
        const m = this.toDevice();
        const rects = this.rects(d, 4, d.getUint32(0, true), C);
        this.drawPath(
          id,
          rects.flatMap(([x, y, w, h]) => rectPath(m, x, y, x + w, y + h)),
        );
        return;
      }
      case 0x400c: {
        // FillPolygon
        const paint = this.brush(S, d.getUint32(0, true));
        const pts = this.points(d, 8, d.getUint32(4, true), flags);
        if (paint) this.painter.fill(this.poly(pts, true), 'evenodd', paint, this.state.clip);
        return;
      }
      case 0x400d: {
        // DrawLines
        const pts = this.points(d, 4, d.getUint32(0, true), flags);
        this.drawPath(id, this.poly(pts, (flags & 0x2000) !== 0));
        return;
      }
      case 0x400e: {
        // FillEllipse
        const paint = this.brush(S, d.getUint32(0, true));
        const [r] = this.rects(d, 4, 1, C);
        if (paint && r) this.painter.fill(this.ellipse(r), 'nonzero', paint, this.state.clip);
        return;
      }
      case 0x400f: {
        // DrawEllipse
        const [r] = this.rects(d, 0, 1, C);
        if (r) this.drawPath(id, this.ellipse(r));
        return;
      }
      case 0x4010: {
        // FillPie
        const paint = this.brush(S, d.getUint32(0, true));
        const [r] = this.rects(d, 12, 1, C);
        if (paint && r) {
          const path = this.arc(r, d.getFloat32(4, true), d.getFloat32(8, true), true);
          this.painter.fill(path, 'nonzero', paint, this.state.clip);
        }
        return;
      }
      case 0x4011: // DrawPie
      case 0x4012: {
        // DrawArc
        const [r] = this.rects(d, 8, 1, C);
        if (r)
          this.drawPath(
            id,
            this.arc(r, d.getFloat32(0, true), d.getFloat32(4, true), type === 0x4011),
          );
        return;
      }
      case 0x4013: {
        // FillRegion
        const paint = this.brush(S, d.getUint32(0, true));
        const region = this.regionOf(id);
        if (!paint || region === null) return;
        this.painter.fill(rectPath(IDENTITY, -BIG, -BIG, BIG, BIG), 'nonzero', paint, [
          ...this.state.clip,
          ...region,
        ]);
        return;
      }
      case 0x4014: {
        // FillPath
        const paint = this.brush(S, d.getUint32(0, true));
        const path = this.pathOf(id);
        if (paint) this.painter.fill(this.trace(path), 'nonzero', paint, this.state.clip);
        return;
      }
      case 0x4015: // DrawPath
        this.drawPath(d.getUint32(0, true), this.trace(this.pathOf(id)));
        return;
      case 0x4016: {
        // FillClosedCurve
        const paint = this.brush(S, d.getUint32(0, true));
        const pts = this.points(d, 12, d.getUint32(8, true), flags);
        const path = this.curve(pts, d.getFloat32(4, true), true);
        if (paint)
          this.painter.fill(path, flags & 0x2000 ? 'nonzero' : 'evenodd', paint, this.state.clip);
        return;
      }
      case 0x4017: {
        // DrawClosedCurve
        const pts = this.points(d, 8, d.getUint32(4, true), flags);
        this.drawPath(id, this.curve(pts, d.getFloat32(0, true), true));
        return;
      }
      case 0x4018: {
        // DrawCurve
        const offset = d.getUint32(4, true);
        const segments = d.getUint32(8, true);
        const pts = this.points(d, 16, d.getUint32(12, true), flags);
        this.drawPath(
          id,
          this.curve(pts.slice(offset, offset + segments + 1), d.getFloat32(0, true), false),
        );
        return;
      }
      case 0x4019: {
        // DrawBeziers
        const pts = this.points(d, 4, d.getUint32(0, true), flags);
        const m = this.toDevice();
        const path: Path = [];
        const [first, ...rest] = pts.map(([x, y]) => apply(m, x, y));
        if (!first) return;
        path.push({ op: 'M', x: first[0], y: first[1] });
        for (let i = 0; i + 2 < rest.length; i += 3) {
          const [a, b, c] = [rest[i], rest[i + 1], rest[i + 2]];
          if (a && b && c)
            path.push({ op: 'C', x1: a[0], y1: a[1], x2: b[0], y2: b[1], x: c[0], y: c[1] });
        }
        this.drawPath(id, path);
        return;
      }
      case 0x401a: {
        // DrawImage
        const src = this.srcRect(d, 8);
        const [dest] = this.rects(d, 24, 1, C);
        if (!dest) return;
        const [x, y, w, h] = dest;
        await this.image(id, src, [w / src[2], 0, 0, h / src[3], x, y]);
        return;
      }
      case 0x401b: {
        // DrawImagePoints: a parallelogram (upper-left, upper-right, lower-left)
        const src = this.srcRect(d, 8);
        const [p0, p1, p2] = this.points(d, 28, d.getUint32(24, true), flags);
        if (!p0 || !p1 || !p2) return;
        await this.image(id, src, [
          (p1[0] - p0[0]) / src[2],
          (p1[1] - p0[1]) / src[2],
          (p2[0] - p0[0]) / src[3],
          (p2[1] - p0[1]) / src[3],
          p0[0],
          p0[1],
        ]);
        return;
      }
      case 0x401c:
        return this.drawString(id, S, d);
      case 0x4036:
        return this.drawDriverString(id, S, d);
      case 0x401d: // SetRenderingOrigin
      case 0x401e: // SetAntiAliasMode
      case 0x401f: // SetTextRenderingHint
      case 0x4020: // SetTextContrast
      case 0x4021: // SetInterpolationMode
      case 0x4022: // SetPixelOffsetMode
      case 0x4023: // SetCompositingMode
      case 0x4024: // SetCompositingQuality
      case 0x4039: // SetTSGraphics
      case 0x403a: // SetTSClip
      case 0x4038: // SerializableObject (image effects)
        return;
      case 0x4025: // Save
      case 0x4028: // BeginContainerNoParams
        this.saved.set(d.getUint32(0, true), { ...this.state, clip: [...this.state.clip] });
        return;
      case 0x4027: {
        // BeginContainer: maps its source rectangle onto the destination one
        const [dx, dy, dw, dh] = [0, 4, 8, 12].map(o => d.getFloat32(o, true));
        const [sx, sy, sw, sh] = [16, 20, 24, 28].map(o => d.getFloat32(o, true));
        this.saved.set(d.getUint32(32, true), { ...this.state, clip: [...this.state.clip] });
        if (
          sw &&
          sh &&
          dw !== undefined &&
          dh !== undefined &&
          sx !== undefined &&
          sy !== undefined
        ) {
          const map: Affine = [
            dw / sw,
            0,
            0,
            dh / sh,
            (dx ?? 0) - (sx * dw) / sw,
            (dy ?? 0) - (sy * dh) / sh,
          ];
          this.state.world = compose(this.state.world, map);
        }
        return;
      }
      case 0x4026: // Restore
      case 0x4029: {
        // EndContainer
        const s = this.saved.get(d.getUint32(0, true));
        if (s) this.state = { ...s, clip: [...s.clip] };
        return;
      }
      case 0x402a: // SetWorldTransform
        this.state.world = this.matrix(d, 0);
        return;
      case 0x402b: // ResetWorldTransform
        this.state.world = IDENTITY;
        return;
      case 0x402c: // MultiplyWorldTransform
        return this.multiply(this.matrix(d, 0), flags);
      case 0x402d: // TranslateWorldTransform
        return this.multiply(translate(d.getFloat32(0, true), d.getFloat32(4, true)), flags);
      case 0x402e: // ScaleWorldTransform
        return this.multiply(scale(d.getFloat32(0, true), d.getFloat32(4, true)), flags);
      case 0x402f: // RotateWorldTransform (degrees)
        return this.multiply(rotate((d.getFloat32(0, true) * Math.PI) / 180), flags);
      case 0x4030: // SetPageTransform
        this.state.pageUnit = id;
        this.state.pageScale = d.getFloat32(0, true);
        return;
      case 0x4031: // ResetClip
        this.state.clip = [];
        return;
      case 0x4032: {
        // SetClipRect
        const [x, y, w, h] = [0, 4, 8, 12].map(o => d.getFloat32(o, true));
        const path = rectPath(
          this.toDevice(),
          x ?? 0,
          y ?? 0,
          (x ?? 0) + (w ?? 0),
          (y ?? 0) + (h ?? 0),
        );
        this.combineClip([{ path, rule: 'nonzero' }], (flags >> 8) & 0xf);
        return;
      }
      case 0x4033: // SetClipPath
        this.combineClip(
          [{ path: this.trace(this.pathOf(id)), rule: 'nonzero' }],
          (flags >> 8) & 0xf,
        );
        return;
      case 0x4034: {
        // SetClipRegion
        const region = this.regionOf(id);
        this.combineClip(region ?? [{ path: [], rule: 'nonzero' }], (flags >> 8) & 0xf);
        return;
      }
      case 0x4035: // OffsetClip
        return;
      default:
        this.unsupported++;
    }
  }

  private multiply(m: Affine, flags: number): void {
    // Append (flag 0x2000): apply after the world transform; otherwise before it
    this.state.world = flags & 0x2000 ? compose(m, this.state.world) : compose(this.state.world, m);
  }

  /** CombineMode: Replace 0, Intersect 1, Union 2, XOR 3, Exclude 4, Complement 5. */
  private combineClip(clip: Clip[], mode: number): void {
    if (mode === 0) this.state.clip = clip;
    else if (mode === 1) this.state.clip = [...this.state.clip, ...clip];
    else if (mode === 4) {
      const outer = rectPath(IDENTITY, -BIG, -BIG, BIG, BIG);
      this.state.clip = [
        ...this.state.clip,
        ...clip.map((c): Clip => ({ path: [...outer, ...c.path], rule: 'evenodd' })),
      ];
    } else this.unsupported++;
  }

  private matrix(d: DataView, o: number): Affine {
    const v = [0, 4, 8, 12, 16, 20].map(k => d.getFloat32(o + k, true));
    return [v[0] ?? 1, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1, v[4] ?? 0, v[5] ?? 0];
  }

  private rects(
    d: DataView,
    o: number,
    count: number,
    compressed: boolean,
  ): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    const size = compressed ? 8 : 16;
    for (let i = 0; i < count && o + (i + 1) * size <= d.byteLength; i++) {
      const at = o + i * size;
      const v = compressed
        ? [0, 2, 4, 6].map(k => d.getInt16(at + k, true))
        : [0, 4, 8, 12].map(k => d.getFloat32(at + k, true));
      out.push([v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0]);
    }
    return out;
  }

  /** Float, compressed (C) or relative (P, EmfPlusPointR) points. */
  private points(d: DataView, o: number, count: number, flags: number): [number, number][] {
    const out: [number, number][] = [];
    if (flags & 0x0800) {
      let pos = o;
      let x = 0;
      let y = 0;
      const read = () => {
        const b = d.getUint8(pos);
        if (b & 0x80) {
          const v = ((b & 0x7f) << 8) | d.getUint8(pos + 1);
          pos += 2;
          return v & 0x4000 ? v - 0x8000 : v;
        }
        pos++;
        return b & 0x40 ? b - 0x80 : b;
      };
      for (let i = 0; i < count; i++) {
        x += read();
        y += read();
        out.push([x, y]);
      }
      return out;
    }
    const compressed = (flags & 0x4000) !== 0;
    const size = compressed ? 4 : 8;
    for (let i = 0; i < count && o + (i + 1) * size <= d.byteLength; i++) {
      const at = o + i * size;
      out.push(
        compressed
          ? [d.getInt16(at, true), d.getInt16(at + 2, true)]
          : [d.getFloat32(at, true), d.getFloat32(at + 4, true)],
      );
    }
    return out;
  }

  private srcRect(d: DataView, o: number): [number, number, number, number] {
    const v = [0, 4, 8, 12].map(k => d.getFloat32(o + k, true));
    return [v[0] ?? 0, v[1] ?? 0, v[2] || 1, v[3] || 1];
  }

  private poly(pts: [number, number][], close: boolean): Path {
    const m = this.toDevice();
    const path: Path = pts.map(([px, py], i) => {
      const [x, y] = apply(m, px, py);
      return { op: i === 0 ? 'M' : 'L', x, y };
    });
    if (close && path.length) path.push({ op: 'Z' });
    return path;
  }

  private ellipse([x, y, w, h]: [number, number, number, number]): Path {
    const path: Path = [];
    arcTo(path, this.toDevice(), x + w / 2, y + h / 2, w / 2, h / 2, 0, 2 * Math.PI, 'M');
    path.push({ op: 'Z' });
    return path;
  }

  /** GDI+ angles are degrees, clockwise (on a y-down device), measured on the ellipse. */
  private arc(
    [x, y, w, h]: [number, number, number, number],
    start: number,
    sweep: number,
    pie: boolean,
  ): Path {
    const rx = w / 2;
    const ry = h / 2;
    const cx = x + rx;
    const cy = y + ry;
    const param = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return Math.atan2(Math.sin(a) / (ry || 1), Math.cos(a) / (rx || 1));
    };
    const t0 = param(start);
    let t1 = param(start + sweep);
    if (sweep >= 0) while (t1 < t0) t1 += 2 * Math.PI;
    else while (t1 > t0) t1 -= 2 * Math.PI;
    if (Math.abs(sweep) >= 360) t1 = t0 + Math.sign(sweep) * 2 * Math.PI;
    const m = this.toDevice();
    const path: Path = [];
    if (pie) {
      const [px, py] = apply(m, cx, cy);
      path.push({ op: 'M', x: px, y: py });
    }
    arcTo(path, m, cx, cy, rx, ry, t0, t1 - t0, pie ? 'L' : 'M');
    if (pie) path.push({ op: 'Z' });
    return path;
  }

  /** Cardinal spline through the points, as Béziers (GDI+'s DrawCurve). */
  private curve(pts: [number, number][], tension: number, closed: boolean): Path {
    const m = this.toDevice();
    const n = pts.length;
    if (n < 2) return [];
    const at = (i: number): [number, number] =>
      pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))] ?? [0, 0];
    const k = tension / 3;
    const path: Path = [];
    const [sx, sy] = apply(m, ...at(0));
    path.push({ op: 'M', x: sx, y: sy });
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = at(i - 1);
      const p1 = at(i);
      const p2 = at(i + 1);
      const p3 = at(i + 2);
      const [x1, y1] = apply(m, p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k);
      const [x2, y2] = apply(m, p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k);
      const [x, y] = apply(m, ...p2);
      path.push({ op: 'C', x1, y1, x2, y2, x, y });
    }
    if (closed) path.push({ op: 'Z' });
    return path;
  }

  /** Path object points → device path (types: 0 start, 1 line, 3 Bézier; 0x80 closes). */
  private trace(p: PlusPath | null): Path {
    if (!p) return [];
    const m = this.toDevice();
    const out: Path = [];
    for (let i = 0; i < p.points.length; i++) {
      const t = p.types[i] ?? 1;
      const [x, y] = apply(m, ...(p.points[i] ?? [0, 0]));
      if ((t & 7) === 0) out.push({ op: 'M', x, y });
      else if ((t & 7) === 3) {
        const b = p.points[i + 1];
        const c = p.points[i + 2];
        if (b && c) {
          const [x2, y2] = apply(m, ...b);
          const [x3, y3] = apply(m, ...c);
          out.push({ op: 'C', x1: x, y1: y, x2, y2, x: x3, y: y3 });
          i += 2;
        }
      } else out.push({ op: 'L', x, y });
      if ((p.types[i] ?? 0) & 0x80) out.push({ op: 'Z' });
    }
    return out;
  }

  private brush(solid: boolean, value: number): Paint | null {
    if (solid) {
      const b = new DataView(new Uint32Array([value]).buffer);
      return argb(b, 0);
    }
    const obj = this.objects.get(value);
    if (obj?.type === 'brush') return obj.paint;
    this.unsupported++;
    return null;
  }

  private pathOf(id: number): PlusPath | null {
    const obj = this.objects.get(id);
    if (obj?.type === 'path') return obj.path;
    this.unsupported++;
    return null;
  }

  private regionOf(id: number): Region {
    const obj = this.objects.get(id);
    if (obj?.type === 'region') return obj.region;
    this.unsupported++;
    return null;
  }

  private drawPath(penId: number, path: Path): void {
    const obj = this.objects.get(penId);
    if (obj?.type !== 'pen') {
      this.unsupported++;
      return;
    }
    const pen = obj.pen;
    const m = this.toDevice();
    const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    // Pen width is in world units unless its unit says otherwise
    const width =
      pen.unit === 0 || pen.unit === 1
        ? pen.width * k
        : pen.width * this.unitScale(pen.unit, this.dpiX);
    const color =
      typeof pen.paint === 'string'
        ? pen.paint
        : pen.paint.type === 'linear'
          ? (pen.paint.stops[0]?.[1] ?? '#000')
          : pen.paint.color;
    const stroke: Stroke = {
      color,
      width,
      dash: pen.dash.map(v => v * Math.max(width, 1)),
      cap: pen.startCap === 2 ? 'round' : pen.startCap === 1 ? 'square' : 'butt',
      join: pen.join === 2 ? 'round' : pen.join === 1 ? 'bevel' : 'miter',
      miter: pen.miter,
    };
    this.painter.stroke(path, stroke, this.state.clip);
  }

  private async image(
    id: number,
    src: [number, number, number, number],
    placed: Affine,
  ): Promise<void> {
    const obj = this.objects.get(id);
    if (obj?.type !== 'image') {
      this.unsupported++;
      return;
    }
    const [sx, sy, sw, sh] = src;
    await this.painter.image(
      {
        image: obj.image,
        sx,
        sy,
        sw,
        sh,
        matrix: compose(this.toDevice(), placed),
        alpha: 1,
        composite: 'source-over',
      },
      this.state.clip,
    );
  }

  /** Font size in world units, and the painter font. */
  private font(id: number): Font | null {
    const obj = this.objects.get(id);
    if (obj?.type !== 'font') {
      this.unsupported++;
      return null;
    }
    const f = obj.font;
    const pageToDevice = this.unitScale(this.state.pageUnit, this.dpiY) * this.state.pageScale;
    const size =
      f.unit === 0 || f.unit === 1
        ? f.size
        : (f.size * this.unitScale(f.unit, this.dpiY)) / (pageToDevice || 1);
    return {
      family: f.family,
      size,
      weight: f.style & 1 ? 700 : 400,
      italic: (f.style & 2) !== 0,
      underline: (f.style & 4) !== 0,
      strike: (f.style & 8) !== 0,
    };
  }

  private textPaint(solid: boolean, value: number): string | null {
    const paint = this.brush(solid, value);
    if (!paint) return null;
    return typeof paint === 'string'
      ? paint
      : paint.type === 'linear'
        ? (paint.stops[0]?.[1] ?? '#000')
        : paint.color;
  }

  private drawString(fontId: number, solid: boolean, d: DataView): void {
    const color = this.textPaint(solid, d.getUint32(0, true));
    const formatObj = this.objects.get(d.getUint32(4, true));
    const format: PlusFormat =
      formatObj?.type === 'format' ? formatObj.format : { flags: 0, align: 0, lineAlign: 0 };
    const length = d.getUint32(8, true);
    const [x, y, w, h] = [12, 16, 20, 24].map(o => d.getFloat32(o, true));
    const text = utf16(d, 28, length);
    const font = this.font(fontId);
    if (!font || !color || x === undefined || y === undefined) return;
    const width = w ?? 0;
    const height = h ?? 0;
    // Lines: explicit breaks, then word wrap to the layout width unless NoWrap (0x1000)
    const lines: string[] = [];
    for (const para of text.split(/\r\n|\n|\r/)) {
      if (width <= 0 || format.flags & 0x1000) {
        lines.push(para);
        continue;
      }
      let line = '';
      for (const word of para.split(/(?<=\s)/)) {
        const next = line + word;
        if (line && this.painter.measure(next.trimEnd(), font) > width) {
          lines.push(line.trimEnd());
          line = word;
        } else line = next;
      }
      lines.push(line.trimEnd());
    }
    const lineHeight = font.size * 1.18;
    const total = lines.length * lineHeight;
    const top =
      format.lineAlign === 1 && height > 0
        ? y + (height - total) / 2
        : format.lineAlign === 2 && height > 0
          ? y + height - total
          : y;
    const align = format.align === 1 ? 'center' : format.align === 2 ? 'right' : 'left';
    const ax = align === 'center' ? x + width / 2 : align === 'right' ? x + width : x;
    const clip =
      width > 0 && height > 0 && !(format.flags & 0x4000)
        ? [
            ...this.state.clip,
            {
              path: rectPath(this.toDevice(), x, y, x + width, y + height),
              rule: 'nonzero' as const,
            },
          ]
        : this.state.clip;
    lines.forEach((line, i) => {
      this.painter.text(
        {
          text: line,
          font,
          color,
          matrix: this.toDevice(),
          x: ax,
          y: top + i * lineHeight,
          align,
          baseline: 'top',
        },
        clip,
      );
    });
  }

  private drawDriverString(fontId: number, solid: boolean, d: DataView): void {
    const color = this.textPaint(solid, d.getUint32(0, true));
    const options = d.getUint32(4, true);
    const hasMatrix = d.getUint32(8, true) !== 0;
    const count = d.getUint32(12, true);
    const font = this.font(fontId);
    if (!font || !color) return;
    if (!(options & 1)) {
      // Glyph indexes, not characters: we can't map them without the font
      this.unsupported++;
      return;
    }
    const text = utf16(d, 16, count);
    const posAt = 16 + count * 2;
    const extra = hasMatrix ? this.matrix(d, posAt + count * 8) : IDENTITY;
    const matrix = compose(this.toDevice(), extra);
    const chars = [...text];
    if (options & 4) {
      // RealizedAdvance: only the first position is given
      this.painter.text(
        {
          text,
          font,
          color,
          matrix,
          x: d.getFloat32(posAt, true),
          y: d.getFloat32(posAt + 4, true),
          align: 'left',
          baseline: 'alphabetic',
        },
        this.state.clip,
      );
      return;
    }
    chars.forEach((ch, i) => {
      const o = posAt + i * 8;
      if (o + 8 > d.byteLength) return;
      this.painter.text(
        {
          text: ch,
          font,
          color,
          matrix,
          x: d.getFloat32(o, true),
          y: d.getFloat32(o + 4, true),
          align: 'left',
          baseline: 'alphabetic',
        },
        this.state.clip,
      );
    });
  }

  // --- objects ---

  private object(flags: number, d: DataView): void {
    const id = flags & 0xff;
    const type = (flags >> 8) & 0x7f;
    const continued = (flags & 0x8000) !== 0;
    let data = d;
    if (continued) {
      // Split object: TotalObjectSize, then this chunk; the last chunk has the flag clear
      const total = d.getUint32(0, true);
      const chunk = new Uint8Array(d.buffer, d.byteOffset + 4, d.byteLength - 4);
      if (!this.pending || this.pending.id !== id) this.pending = { id, flags, total, chunks: [] };
      this.pending.chunks.push(chunk.slice());
      return;
    }
    if (this.pending?.id === id) {
      const parts = [...this.pending.chunks, new Uint8Array(d.buffer, d.byteOffset, d.byteLength)];
      const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        joined.set(p, at);
        at += p.length;
      }
      data = new DataView(joined.buffer);
      this.pending = null;
    }
    const obj = this.parseObject(type, data);
    this.objects.set(id, obj);
  }

  private parseObject(type: number, d: DataView): PlusObject {
    switch (type) {
      case 1:
        return { type: 'brush', paint: this.parseBrush(d, 0).paint };
      case 2:
        return { type: 'pen', pen: this.parsePen(d) };
      case 3:
        return { type: 'path', path: this.parsePath(d, 0).path };
      case 4:
        return { type: 'region', region: this.parseRegion(d) };
      case 5:
        return this.parseImage(d);
      case 6: {
        const len = d.getUint32(20, true);
        return {
          type: 'font',
          font: {
            size: d.getFloat32(4, true),
            unit: d.getUint32(8, true),
            style: d.getInt32(12, true),
            family: utf16(d, 24, len),
          },
        };
      }
      case 7:
        return {
          type: 'format',
          format: {
            flags: d.getUint32(4, true),
            align: d.getUint32(12, true),
            lineAlign: d.getUint32(16, true),
          },
        };
      default:
        return { type: 'other' };
    }
  }

  private parseBrush(d: DataView, o: number): { paint: Paint; end: number } {
    const type = d.getUint32(o + 4, true);
    switch (type) {
      case 0:
        return { paint: argb(d, o + 8), end: o + 12 };
      case 1: {
        // Hatch: style, foreground, background
        const style = d.getUint32(o + 8, true);
        const gdiStyle = style <= 5 ? style : undefined;
        return {
          paint:
            gdiStyle === undefined
              ? argb(d, o + 12)
              : {
                  type: 'hatch',
                  style: gdiStyle,
                  color: argb(d, o + 12),
                  background: argb(d, o + 16),
                },
          end: o + 20,
        };
      }
      case 4: {
        // LinearGradient: flags, wrap, rect, start and end colours (then optional extras)
        const [x, y, w, h] = [16, 20, 24, 28].map(k => d.getFloat32(o + k, true));
        const start = argb(d, o + 32);
        const end = argb(d, o + 36);
        const m = this.toDevice();
        const [x0, y0] = apply(m, x ?? 0, (y ?? 0) + (h ?? 0) / 2);
        const [x1, y1] = apply(m, (x ?? 0) + (w ?? 0), (y ?? 0) + (h ?? 0) / 2);
        return {
          paint: {
            type: 'linear',
            x0,
            y0,
            x1,
            y1,
            stops: [
              [0, start],
              [1, end],
            ],
          },
          end: d.byteLength,
        };
      }
      case 3: {
        // PathGradient: use its centre colour
        this.unsupported++;
        return { paint: argb(d, o + 16), end: d.byteLength };
      }
      default:
        this.unsupported++;
        return { paint: rgba(128, 128, 128), end: d.byteLength };
    }
  }

  private parsePen(d: DataView): PlusPen {
    const flags = d.getUint32(8, true);
    const unit = d.getUint32(12, true);
    const width = d.getFloat32(16, true);
    let o = 20;
    let transform: Affine | null = null;
    let startCap = 0;
    let join = 0;
    let miter = 10;
    let style = 0;
    let dash: number[] = [];
    if (flags & 0x1) {
      transform = this.matrix(d, o);
      o += 24;
    }
    if (flags & 0x2) {
      startCap = d.getInt32(o, true);
      o += 4;
    }
    if (flags & 0x4) o += 4; // EndCap
    if (flags & 0x8) {
      join = d.getUint32(o, true);
      o += 4;
    }
    if (flags & 0x10) {
      miter = d.getFloat32(o, true);
      o += 4;
    }
    if (flags & 0x20) {
      style = d.getInt32(o, true);
      o += 4;
    }
    if (flags & 0x40) o += 4; // DashedLineCap
    if (flags & 0x80) o += 4; // DashOffset
    if (flags & 0x100) {
      const n = d.getUint32(o, true);
      dash = Array.from({ length: n }, (_, i) => d.getFloat32(o + 4 + i * 4, true));
      o += 4 + n * 4;
    }
    if (flags & 0x200) o += 4; // Alignment
    if (flags & 0x400) o += 4 + d.getUint32(o, true) * 4; // CompoundLine
    if (flags & 0x800) o += 4 + d.getUint32(o, true); // CustomStartCap
    if (flags & 0x1000) o += 4 + d.getUint32(o, true); // CustomEndCap
    if (style > 0 && style < 5 && dash.length === 0) {
      dash =
        [
          [3, 1],
          [1, 1],
          [3, 1, 1, 1],
          [3, 1, 1, 1, 1, 1],
        ][style - 1] ?? [];
    }
    const { paint } = this.parseBrush(d, o);
    return { width, unit, paint, dash, startCap, join, miter, transform };
  }

  private parsePath(d: DataView, o: number): { path: PlusPath; end: number } {
    const count = d.getUint32(o + 4, true);
    const flags = d.getUint32(o + 8, true);
    let pos = o + 12;
    const points: [number, number][] = [];
    if (flags & 0x0800) {
      points.push(...this.points(new DataView(d.buffer, d.byteOffset + pos), 0, count, 0x0800));
      // Relative points are variable-length: re-walk to find the end
      let x = 0;
      for (let i = 0; i < count * 2; i++) {
        const b = d.getUint8(pos + x);
        x += b & 0x80 ? 2 : 1;
      }
      pos += x;
    } else {
      const compressed = (flags & 0x4000) !== 0;
      points.push(
        ...this.points(
          new DataView(d.buffer, d.byteOffset + pos),
          0,
          count,
          compressed ? 0x4000 : 0,
        ),
      );
      pos += count * (compressed ? 4 : 8);
    }
    const types: number[] = [];
    if (flags & 0x1000) {
      // Run-length encoded types: (run count with a bezier bit, type) pairs
      while (types.length < count && pos + 1 < d.byteLength) {
        const run = d.getUint8(pos) & 0x3f;
        const t = d.getUint8(pos + 1);
        for (let i = 0; i < run; i++) types.push(t);
        pos += 2;
      }
    } else {
      for (let i = 0; i < count; i++) types.push(d.getUint8(pos + i));
      pos += count;
    }
    return { path: { points, types }, end: (pos + 3) & ~3 };
  }

  private parseRegion(d: DataView): Region {
    let pos = 8;
    const node = (): Region => {
      const type = d.getUint32(pos, true);
      pos += 4;
      if (type === 0x10000000) {
        const [x, y, w, h] = [0, 4, 8, 12].map(k => d.getFloat32(pos + k, true));
        pos += 16;
        return [
          {
            path: rectPath(
              this.toDevice(),
              x ?? 0,
              y ?? 0,
              (x ?? 0) + (w ?? 0),
              (y ?? 0) + (h ?? 0),
            ),
            rule: 'nonzero',
          },
        ];
      }
      if (type === 0x10000001) {
        const len = d.getUint32(pos, true);
        const { path } = this.parsePath(d, pos + 4);
        pos += 4 + len;
        return [{ path: this.trace(path), rule: 'nonzero' }];
      }
      if (type === 0x10000002) return null; // empty
      if (type === 0x10000003) return []; // infinite
      const left = node();
      const right = node();
      switch (type) {
        case 1: // And
          return left === null || right === null ? null : [...left, ...right];
        case 2: // Union
          if (left === null) return right;
          if (right === null) return left;
          if (left.length === 0 || right.length === 0) return [];
          if (left.length === 1 && right.length === 1) {
            return [
              { path: [...(left[0]?.path ?? []), ...(right[0]?.path ?? [])], rule: 'nonzero' },
            ];
          }
          break;
        case 4: // Exclude
          if (left === null) return null;
          if (right === null) return left;
          return [
            ...left,
            ...right.map((c): Clip => ({
              path: [...rectPath(IDENTITY, -BIG, -BIG, BIG, BIG), ...c.path],
              rule: 'evenodd',
            })),
          ];
      }
      this.unsupported++;
      return left;
    };
    return node();
  }

  private parseImage(d: DataView): PlusObject {
    const type = d.getUint32(4, true);
    if (type !== 1) {
      this.unsupported++; // embedded metafiles
      return { type: 'other' };
    }
    const width = d.getInt32(8, true);
    const height = d.getInt32(12, true);
    const stride = d.getInt32(16, true);
    const format = d.getUint32(20, true);
    const kind = d.getUint32(24, true);
    const at = 28;
    if (kind === 1) {
      const bytes = new Uint8Array(new Uint8Array(d.buffer, d.byteOffset + at, d.byteLength - at));
      const mime =
        bytes[0] === 0x89
          ? 'image/png'
          : bytes[0] === 0xff
            ? 'image/jpeg'
            : bytes[0] === 0x47
              ? 'image/gif'
              : 'image/bmp';
      return { type: 'image', image: { bytes, mime }, width, height };
    }
    if (width <= 0 || height <= 0 || width * height > 40_000_000) return { type: 'other' };
    const r = newRaster(width, height);
    const px = r.data;
    let pos = at;
    let palette: [number, number, number, number][] = [];
    if (format & 0x00010000) {
      // Indexed: palette flags, count, ARGB entries
      const n = d.getUint32(pos + 4, true);
      palette = Array.from({ length: n }, (_, i): [number, number, number, number] => {
        const o = pos + 8 + i * 4;
        return [d.getUint8(o + 2), d.getUint8(o + 1), d.getUint8(o), d.getUint8(o + 3)];
      });
      pos += 8 + n * 4;
    }
    const bpp = (format >> 8) & 0xff;
    const alpha = (format & 0x00040000) !== 0;
    const premultiplied = (format & 0x00080000) !== 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const row = pos + y * stride;
        let c: [number, number, number, number] = [0, 0, 0, 255];
        if (bpp === 32 || bpp === 24) {
          const s = row + x * (bpp / 8);
          if (s + bpp / 8 > d.byteLength) continue;
          const a = bpp === 32 && alpha ? d.getUint8(s + 3) : 255;
          const k = premultiplied && a > 0 ? 255 / a : 1;
          c = [d.getUint8(s + 2) * k, d.getUint8(s + 1) * k, d.getUint8(s) * k, a];
        } else if (bpp <= 8 && bpp > 0) {
          const bit = x * bpp;
          if (row + (bit >> 3) >= d.byteLength) continue;
          const i = (d.getUint8(row + (bit >> 3)) >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
          c = palette[i] ?? [i, i, i, 255];
        } else if (bpp === 16) {
          const v = d.getUint16(row + x * 2, true);
          c = [((v >> 10) & 31) * 8, ((v >> 5) & 31) * 8, (v & 31) * 8, 255];
        }
        px[o] = c[0];
        px[o + 1] = c[1];
        px[o + 2] = c[2];
        px[o + 3] = c[3];
      }
    }
    return { type: 'image', image: r, width, height };
  }
}
