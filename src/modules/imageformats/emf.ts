/**
 * Enhanced metafiles: the header (sizes, reference device), and playback of the GDI records
 * through GdiPlayer, with EMF+ comment records handed to EmfPlusPlayer.
 */

import type { StatRow } from '../../core/types';
import { EMF_PLUS, EmfPlusPlayer } from './emfplus';
import { colorRef, GdiPlayer, patternColor, stockObject, type GdiObject, type Rgb } from './gdi';
import { compose, IDENTITY, type Affine, type Painter } from './painter';
import { DecodeError } from './raster';

type Rect = [number, number, number, number];

export interface EmfHeader {
  /** Device units, inclusive. */
  bounds: Rect;
  /** 0.01 mm, inclusive. */
  frame: Rect;
  /** Reference device size in pixels and millimetres. */
  device: [number, number];
  millimetres: [number, number];
  records: number;
  description: string;
  /** From an EMF+ header in the first comment record. */
  plus: { dual: boolean } | null;
}

/** Where the picture lands on the output canvas. */
export interface MetafileLayout {
  width: number;
  height: number;
  /** Device → canvas pixels. */
  base: Affine;
}

/** Output long side, in pixels. */
export const MAX_METAFILE_SIDE = 4096;

const rect = (dv: DataView, o: number): Rect => [
  dv.getInt32(o, true),
  dv.getInt32(o + 4, true),
  dv.getInt32(o + 8, true),
  dv.getInt32(o + 12, true),
];

function utf16(dv: DataView, o: number, chars: number): string {
  let s = '';
  for (let i = 0; i < chars && o + i * 2 + 1 < dv.byteLength; i++) {
    const c = dv.getUint16(o + i * 2, true);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

export function readEmfHeader(bytes: Uint8Array): EmfHeader {
  if (bytes.length < 88) throw new DecodeError('Truncated EMF header');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = dv.getUint32(4, true);
  const nDesc = dv.getUint32(60, true);
  const offDesc = dv.getUint32(64, true);
  // The description holds "app\0title\0\0"
  const description =
    nDesc > 0 && offDesc >= 88 && offDesc + nDesc * 2 <= bytes.length
      ? Array.from({ length: nDesc }, (_, i) => dv.getUint16(offDesc + i * 2, true))
          .map(c => (c === 0 ? '\n' : String.fromCharCode(c)))
          .join('')
          .split('\n')
          .filter(Boolean)
          .join(' — ')
      : '';
  let plus: EmfHeader['plus'] = null;
  if (size + 28 <= bytes.length && dv.getUint32(size, true) === 70) {
    const at = size + 12;
    if (dv.getUint32(at, true) === EMF_PLUS && dv.getUint16(at + 4, true) === 0x4001) {
      plus = { dual: (dv.getUint16(at + 6, true) & 1) === 1 };
    }
  }
  return {
    bounds: rect(dv, 8),
    frame: rect(dv, 24),
    device: [dv.getInt32(72, true), dv.getInt32(76, true)],
    millimetres: [dv.getInt32(80, true), dv.getInt32(84, true)],
    records: dv.getUint32(52, true),
    description,
    plus,
  };
}

/** Pixels per millimetre of the reference device. */
function pxPerMm(h: EmfHeader): [number, number] {
  const [dw, dh] = h.device;
  const [mw, mh] = h.millimetres;
  return [dw > 0 && mw > 0 ? dw / mw : 96 / 25.4, dh > 0 && mh > 0 ? dh / mh : 96 / 25.4];
}

/** The frame at 96 dpi, capped at MAX_METAFILE_SIDE; the bounds when the frame is empty. */
export function emfLayout(h: EmfHeader, maxSide = MAX_METAFILE_SIDE): MetafileLayout {
  const [px, py] = pxPerMm(h);
  const [fl, ft, fr, fb] = h.frame;
  let origin: [number, number];
  let size: [number, number];
  let k: [number, number];
  if (fr > fl && fb > ft) {
    // Frame (0.01 mm) → device pixels; device → output at 96 dpi
    origin = [(fl / 100) * px, (ft / 100) * py];
    k = [96 / 25.4 / px, 96 / 25.4 / py];
    size = [((fr - fl) / 100) * (96 / 25.4), ((fb - ft) / 100) * (96 / 25.4)];
  } else {
    const [bl, bt, br, bb] = h.bounds;
    if (br < bl || bb < bt) throw new DecodeError('The EMF has no size');
    origin = [bl, bt];
    k = [1, 1];
    size = [br - bl + 1, bb - bt + 1];
  }
  const fit = Math.min(1, maxSide / Math.max(size[0], size[1]));
  const width = Math.max(1, Math.round(size[0] * fit));
  const height = Math.max(1, Math.round(size[1] * fit));
  const sx = k[0] * fit;
  const sy = k[1] * fit;
  return { width, height, base: [sx, 0, 0, sy, -origin[0] * sx, -origin[1] * sy] };
}

export function emfStats(h: EmfHeader): StatRow[] {
  const [px] = pxPerMm(h);
  const [fl, ft, fr, fb] = h.frame;
  return [
    ...(fr > fl && fb > ft
      ? [
          {
            label: 'Frame',
            value: `${((fr - fl) / 100).toFixed(1)} × ${((fb - ft) / 100).toFixed(1)} mm`,
          },
        ]
      : []),
    { label: 'Reference DPI', value: `${Math.round(px * 25.4)}` },
    { label: 'Records', value: h.records.toLocaleString('en-GB') },
    {
      label: 'EMF+',
      value: h.plus ? (h.plus.dual ? 'Yes (dual, with EMF fallback)' : 'Yes (EMF+ only)') : 'No',
    },
    ...(h.description ? [{ label: 'Description', value: h.description }] : []),
  ];
}

const MAP_MM: Record<number, number> = { 2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 25.4 / 1440 };

class EmfPlayer extends GdiPlayer {
  constructor(
    painter: Painter,
    private mm: [number, number],
  ) {
    super(painter);
  }

  toDevice(): Affine {
    const s = this.state;
    let sx: number;
    let sy: number;
    const fixed = MAP_MM[s.mapMode];
    if (fixed !== undefined) {
      sx = this.mm[0] * fixed;
      sy = -this.mm[1] * fixed;
    } else if (s.mapMode === 7 || s.mapMode === 8) {
      sx = s.windowExt[0] ? s.viewportExt[0] / s.windowExt[0] : 1;
      sy = s.windowExt[1] ? s.viewportExt[1] / s.windowExt[1] : 1;
      if (s.mapMode === 7) {
        const m = Math.min(Math.abs(sx), Math.abs(sy));
        sx = Math.sign(sx) * m;
        sy = Math.sign(sy) * m;
      }
    } else {
      sx = 1;
      sy = 1;
    }
    const page: Affine = [
      sx,
      0,
      0,
      sy,
      s.viewportOrg[0] - s.windowOrg[0] * sx,
      s.viewportOrg[1] - s.windowOrg[1] * sy,
    ];
    return compose(page, s.world);
  }
}

export interface PlayResult {
  /** EMF+ drawing records that couldn't be rendered (0 if EMF+ wasn't played). */
  plusUnsupported: number;
  /** Whether EMF+ records were played. */
  plusPlayed: boolean;
}

/** Plays every record onto `painter`. With `usePlus` off, EMF+ comments are ignored. */
export async function playEmf(
  bytes: Uint8Array,
  painter: Painter,
  header: EmfHeader,
  usePlus: boolean,
): Promise<PlayResult> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const gdi = new EmfPlayer(painter, pxPerMm(header));
  const plus = new EmfPlusPlayer(painter, gdi);
  const i32 = (o: number) => dv.getInt32(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);
  const f32 = (o: number) => dv.getFloat32(o, true);
  const pts32 = (o: number, n: number): [number, number][] =>
    Array.from({ length: n }, (_, i) => [i32(o + i * 8), i32(o + i * 8 + 4)]);
  const pts16 = (o: number, n: number): [number, number][] =>
    Array.from({ length: n }, (_, i) => [
      dv.getInt16(o + i * 4, true),
      dv.getInt16(o + i * 4 + 2, true),
    ]);
  const xform = (o: number): Affine => [
    f32(o),
    f32(o + 4),
    f32(o + 8),
    f32(o + 12),
    f32(o + 16),
    f32(o + 20),
  ];
  const view = (p: number, off: number, len: number, end: number) =>
    off > 0 && len > 0 && p + off + len <= end ? bytes.subarray(p + off, p + off + len) : null;
  const put = (index: number, obj: GdiObject) => {
    gdi.objects[index] = obj;
  };

  let pos = 0;
  while (pos + 8 <= bytes.length) {
    const p = pos;
    const type = u32(p);
    const size = u32(p + 4);
    if (size < 8 || size % 4 !== 0 || p + size > bytes.length) break;
    const end = p + size;
    pos += size;
    if (type === 14) break; // EOF
    // Records too short for their fixed fields are skipped (reads past `end` would throw)
    try {
      switch (type) {
        case 2: // POLYBEZIER
          gdi.polyBezier(pts32(p + 28, u32(p + 24)));
          break;
        case 3: // POLYGON
          gdi.polygon(pts32(p + 28, u32(p + 24)));
          break;
        case 4: // POLYLINE
          gdi.polyline(pts32(p + 28, u32(p + 24)));
          break;
        case 5: // POLYBEZIERTO
          gdi.lineTo(pts32(p + 28, u32(p + 24)), true);
          break;
        case 6: // POLYLINETO
          gdi.lineTo(pts32(p + 28, u32(p + 24)));
          break;
        case 85:
          gdi.polyBezier(pts16(p + 28, u32(p + 24)));
          break;
        case 86:
          gdi.polygon(pts16(p + 28, u32(p + 24)));
          break;
        case 87:
          gdi.polyline(pts16(p + 28, u32(p + 24)));
          break;
        case 88:
          gdi.lineTo(pts16(p + 28, u32(p + 24)), true);
          break;
        case 89:
          gdi.lineTo(pts16(p + 28, u32(p + 24)));
          break;
        case 7: // POLYPOLYLINE
        case 8: // POLYPOLYGON
        case 90:
        case 91: {
          const n = u32(p + 24);
          const counts = Array.from({ length: n }, (_, i) => u32(p + 32 + i * 4));
          const wide = type === 7 || type === 8;
          let at = p + 32 + n * 4;
          const polys = counts.map(c => {
            const pts = wide ? pts32(at, c) : pts16(at, c);
            at += c * (wide ? 8 : 4);
            return pts;
          });
          if (type === 8 || type === 91) gdi.polyPolygon(polys);
          else for (const poly of polys) gdi.polyline(poly);
          break;
        }
        case 9:
          gdi.state.windowExt = [i32(p + 8), i32(p + 12)];
          break;
        case 10:
          gdi.state.windowOrg = [i32(p + 8), i32(p + 12)];
          break;
        case 11:
          gdi.state.viewportExt = [i32(p + 8), i32(p + 12)];
          break;
        case 12:
          gdi.state.viewportOrg = [i32(p + 8), i32(p + 12)];
          break;
        case 31: // SCALEVIEWPORTEXTEX
        case 32: {
          // SCALEWINDOWEXTEX
          const key = type === 31 ? 'viewportExt' : 'windowExt';
          const [x, y] = gdi.state[key];
          const [xn, xd, yn, yd] = [i32(p + 8), i32(p + 12), i32(p + 16), i32(p + 20)];
          if (xd && yd) gdi.state[key] = [(x * xn) / xd, (y * yn) / yd];
          break;
        }
        case 17:
          gdi.state.mapMode = u32(p + 8);
          break;
        case 18:
          gdi.state.bkMode = u32(p + 8);
          break;
        case 19:
          gdi.state.polyFill = u32(p + 8);
          break;
        case 22:
          gdi.state.textAlign = u32(p + 8);
          break;
        case 24:
          gdi.state.textColor = colorRef(dv, p + 8);
          break;
        case 25:
          gdi.state.bkColor = colorRef(dv, p + 8);
          break;
        case 27:
          gdi.moveTo(i32(p + 8), i32(p + 12));
          break;
        case 29: {
          const [l, t, r, b] = rect(dv, p + 8);
          gdi.excludeClipRect(l, t, r, b);
          break;
        }
        case 30: {
          const [l, t, r, b] = rect(dv, p + 8);
          gdi.intersectClipRect(l, t, r, b);
          break;
        }
        case 33:
          gdi.save();
          break;
        case 34:
          gdi.restore(i32(p + 8));
          break;
        case 35:
          gdi.state.world = xform(p + 8);
          break;
        case 36: {
          const m = xform(p + 8);
          const mode = u32(p + 32);
          const w = gdi.state.world;
          // Left-multiply applies the new transform first; right-multiply after
          gdi.state.world =
            mode === 1 ? IDENTITY : mode === 2 ? compose(w, m) : mode === 3 ? compose(m, w) : m;
          break;
        }
        case 37: {
          const index = u32(p + 8);
          gdi.select(index & 0x80000000 ? stockObject(index & 0x7fffffff) : gdi.objects[index]);
          break;
        }
        case 38: // CREATEPEN
          put(u32(p + 8), {
            type: 'pen',
            pen: { style: u32(p + 12), width: i32(p + 16), color: colorRef(dv, p + 24) },
          });
          break;
        case 39: // CREATEBRUSHINDIRECT
          put(u32(p + 8), {
            type: 'brush',
            brush: { style: u32(p + 12), color: colorRef(dv, p + 16), hatch: u32(p + 20) },
          });
          break;
        case 40:
          gdi.objects[u32(p + 8)] = null;
          break;
        case 41: {
          // ANGLEARC: line to the start, then a circular arc (degrees, counterclockwise)
          const [cx, cy, r] = [i32(p + 8), i32(p + 12), u32(p + 16)];
          const a0 = (f32(p + 20) * Math.PI) / 180;
          const sweep = (f32(p + 24) * Math.PI) / 180;
          const at = (a: number): [number, number] => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
          const box: Rect = [cx - r, cy - r, cx + r, cy + r];
          const saved = gdi.state.clockwise;
          gdi.state.clockwise = sweep < 0;
          gdi.arc('arcto', box, at(a0), at(a0 + sweep));
          gdi.state.clockwise = saved;
          break;
        }
        case 42: {
          const [l, t, r, b] = rect(dv, p + 8);
          gdi.ellipse(l, t, r, b);
          break;
        }
        case 43: {
          const [l, t, r, b] = rect(dv, p + 8);
          gdi.rectangle(l, t, r, b);
          break;
        }
        case 44: {
          const [l, t, r, b] = rect(dv, p + 8);
          gdi.roundRect(l, t, r, b, i32(p + 24), i32(p + 28));
          break;
        }
        case 45: // ARC
        case 46: // CHORD
        case 47: // PIE
        case 55: {
          // ARCTO
          const kind = type === 45 ? 'arc' : type === 46 ? 'chord' : type === 47 ? 'pie' : 'arcto';
          gdi.arc(kind, rect(dv, p + 8), [i32(p + 24), i32(p + 28)], [i32(p + 32), i32(p + 36)]);
          break;
        }
        case 54:
          gdi.lineTo([[i32(p + 8), i32(p + 12)]]);
          break;
        case 56: {
          // POLYDRAW: points with MOVETO/LINETO/BEZIERTO types (CLOSEFIGURE bit)
          const n = u32(p + 24);
          const pts = pts32(p + 28, n);
          const typesAt = p + 28 + n * 8;
          for (let i = 0; i < n; i++) {
            const t = dv.getUint8(typesAt + i);
            const pt = pts[i];
            if (!pt) break;
            if ((t & 6) === 6) gdi.moveTo(...pt);
            else if ((t & 6) === 4) {
              gdi.lineTo(pts.slice(i, i + 3), true);
              i += 2;
            } else gdi.lineTo([pt]);
            if (t & 1) gdi.closeFigure();
          }
          break;
        }
        case 57:
          gdi.state.clockwise = u32(p + 8) === 2;
          break;
        case 58:
          gdi.state.miterLimit = Math.max(1, u32(p + 8));
          break;
        case 59:
          gdi.beginPath();
          break;
        case 60:
          gdi.endPath();
          break;
        case 61:
          gdi.closeFigure();
          break;
        case 62:
          gdi.fillPath(true, false);
          break;
        case 63:
          gdi.fillPath(true, true);
          break;
        case 64:
          gdi.fillPath(false, true);
          break;
        case 67:
          gdi.selectClipPath(u32(p + 8));
          break;
        case 68:
          gdi.abortPath();
          break;
        case 70: {
          // COMMENT: EMF+ records live here
          const dataSize = u32(p + 8);
          if (usePlus && dataSize >= 4 && u32(p + 12) === EMF_PLUS) {
            await plus.play(dv, p + 16, Math.min(end, p + 12 + dataSize));
          }
          break;
        }
        case 75: {
          // EXTSELECTCLIPRGN: region rectangles are in device units
          const cb = u32(p + 8);
          const mode = u32(p + 12);
          if (cb === 0) {
            if (mode === 5) gdi.resetClip();
            break;
          }
          const n = u32(p + 24);
          const rects = Array.from({ length: n }, (_, i) => rect(dv, p + 48 + i * 16));
          gdi.clipRegion(rects, mode);
          break;
        }
        case 76: // BITBLT
        case 77: {
          // STRETCHBLT
          const [x, y, cx, cy] = [i32(p + 24), i32(p + 28), i32(p + 32), i32(p + 36)];
          const rop = u32(p + 40);
          const info = view(p, u32(p + 84), u32(p + 88), end);
          const bits = view(p, u32(p + 92), u32(p + 96), end);
          if (!info || !bits) {
            gdi.fillRect(x, y, x + cx, y + cy, rop);
            break;
          }
          const [sx, sy] = [i32(p + 44), i32(p + 48)];
          const [sw, sh] = type === 77 ? [i32(p + 100), i32(p + 104)] : [cx, cy];
          await gdi.blit(info, bits, [sx, sy, sw, sh], [x, y, cx, cy], rop);
          break;
        }
        case 80: {
          // SETDIBITSTODEVICE
          const info = view(p, u32(p + 48), u32(p + 52), end);
          const bits = view(p, u32(p + 56), u32(p + 60), end);
          if (!info || !bits) break;
          const [sx, sy, sw, sh] = [i32(p + 32), i32(p + 36), i32(p + 40), i32(p + 44)];
          await gdi.blit(
            info,
            bits,
            [sx, sy, sw, sh],
            [i32(p + 24), i32(p + 28), sw, sh],
            0xcc0020,
            {
              bottomUpOrigin: true,
            },
          );
          break;
        }
        case 81: {
          // STRETCHDIBITS
          const info = view(p, u32(p + 48), u32(p + 52), end);
          const bits = view(p, u32(p + 56), u32(p + 60), end);
          const [x, y] = [i32(p + 24), i32(p + 28)];
          const [cx, cy] = [i32(p + 72), i32(p + 76)];
          const rop = u32(p + 68);
          if (!info || !bits) {
            gdi.fillRect(x, y, x + cx, y + cy, rop);
            break;
          }
          const src: Rect = [i32(p + 32), i32(p + 36), i32(p + 40), i32(p + 44)];
          await gdi.blit(info, bits, src, [x, y, cx, cy], rop, { bottomUpOrigin: true });
          break;
        }
        case 114: // ALPHABLEND
        case 116: {
          // TRANSPARENTBLT
          const [x, y, cx, cy] = [i32(p + 24), i32(p + 28), i32(p + 32), i32(p + 36)];
          const info = view(p, u32(p + 84), u32(p + 88), end);
          const bits = view(p, u32(p + 92), u32(p + 96), end);
          if (!info || !bits) break;
          const src: Rect = [i32(p + 44), i32(p + 48), i32(p + 100), i32(p + 104)];
          if (type === 114) {
            const constant = dv.getUint8(p + 42) / 255;
            const srcAlpha = (dv.getUint8(p + 43) & 1) === 1;
            await gdi.blit(info, bits, src, [x, y, cx, cy], 0xcc0020, {
              alpha: constant,
              srcAlpha,
            });
          } else {
            const key: Rgb = colorRef(dv, p + 40);
            await gdi.blit(info, bits, src, [x, y, cx, cy], 0xcc0020, { transparent: key });
          }
          break;
        }
        case 82: {
          // EXTCREATEFONTINDIRECTW (LOGFONTW at +12)
          put(u32(p + 8), {
            type: 'font',
            font: {
              height: i32(p + 12),
              escapement: i32(p + 20),
              weight: i32(p + 28),
              italic: dv.getUint8(p + 32) !== 0,
              underline: dv.getUint8(p + 33) !== 0,
              strike: dv.getUint8(p + 34) !== 0,
              face: utf16(dv, p + 40, 32),
            },
          });
          break;
        }
        case 83: // EXTTEXTOUTA
        case 84: {
          // EXTTEXTOUTW
          const n = u32(p + 44);
          const offString = u32(p + 48);
          const options = u32(p + 52);
          const offDx = u32(p + 72);
          if (options & 0x10) {
            // ETO_GLYPH_INDEX: glyph ids, which we can't map to characters
            break;
          }
          const text =
            type === 84
              ? utf16(dv, p + offString, n)
              : new TextDecoder('windows-1252').decode(
                  bytes.subarray(p + offString, p + offString + n),
                );
          const pdy = (options & 0x2000) !== 0;
          const dx =
            offDx > 0 && p + offDx + n * 4 * (pdy ? 2 : 1) <= end
              ? Array.from({ length: n }, (_, i) => i32(p + offDx + i * 4 * (pdy ? 2 : 1)))
              : null;
          gdi.text({
            x: i32(p + 36),
            y: i32(p + 40),
            text,
            dx,
            options,
            rect: options & 6 ? rect(dv, p + 56) : null,
          });
          break;
        }
        case 93: // CREATEMONOBRUSH
        case 94: {
          // CREATEDIBPATTERNBRUSHPT
          const info = view(p, u32(p + 16), u32(p + 20), end);
          const bits = view(p, u32(p + 24), u32(p + 28), end);
          const color = info && bits ? patternColor(info, bits) : ([128, 128, 128] satisfies Rgb);
          put(u32(p + 8), { type: 'brush', brush: { style: 0, color, hatch: 0 } });
          break;
        }
        case 95: {
          // EXTCREATEPEN (LOGPENEX at +28)
          const style = u32(p + 28);
          const brushStyle = u32(p + 36);
          const entries = u32(p + 48);
          put(u32(p + 8), {
            type: 'pen',
            pen: {
              style: brushStyle === 1 ? 5 : style,
              width: u32(p + 32),
              color: colorRef(dv, p + 40),
              dashes: Array.from({ length: Math.min(entries, 16) }, (_, i) => u32(p + 52 + i * 4)),
            },
          });
          break;
        }
        case 49: // CREATEPALETTE
          put(u32(p + 8), { type: 'other' });
          break;
        case 118: {
          // GRADIENTFILL
          const nVer = u32(p + 24);
          const nTri = u32(p + 28);
          const mode = u32(p + 32);
          const vert = (i: number) => {
            const o = p + 36 + i * 16;
            return {
              x: i32(o),
              y: i32(o + 4),
              color: [
                dv.getUint16(o + 8, true) >> 8,
                dv.getUint16(o + 10, true) >> 8,
                dv.getUint16(o + 12, true) >> 8,
              ] satisfies Rgb,
            };
          };
          const at = p + 36 + nVer * 16;
          for (let i = 0; i < nTri; i++) {
            if (mode === 2) {
              const [a, b, c] = [u32(at + i * 12), u32(at + i * 12 + 4), u32(at + i * 12 + 8)].map(
                vert,
              );
              if (!a || !b || !c) continue;
              gdi.gradientTriangle(a, b, c);
            } else {
              const a = vert(u32(at + i * 8));
              const b = vert(u32(at + i * 8 + 4));
              gdi.gradientRect(a, b, mode === 1);
            }
          }
          break;
        }
        default:
          // Settings without a visible effect (ROP2, stretch mode, ICM, layout…) and rare records
          break;
      }
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
    }
  }
  return { plusUnsupported: plus.unsupported, plusPlayed: usePlus && plus.seen };
}

/**
 * Renders onto a fresh painter from `make`. EMF+ is used when present; if a dual-mode file has
 * EMF+ records we can't draw, it's rendered again from its plain EMF records.
 */
export async function renderEmf<P extends Painter>(
  bytes: Uint8Array,
  header: EmfHeader,
  make: () => P,
): Promise<{ painter: P; from: 'EMF' | 'EMF+' | 'EMF fallback' }> {
  const painter = make();
  const result = await playEmf(bytes, painter, header, true);
  if (!result.plusPlayed) return { painter, from: 'EMF' };
  if (result.plusUnsupported === 0 || !header.plus?.dual) return { painter, from: 'EMF+' };
  const fallback = make();
  await playEmf(bytes, fallback, header, false);
  return { painter: fallback, from: 'EMF fallback' };
}
