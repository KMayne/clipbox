/**
 * Windows metafiles (16-bit WMF, optionally with the Aldus placeable header). Logical
 * coordinates map onto the output through the window (origin and extent), or through the
 * placeable bounding box when the file never sets a window.
 */

import type { StatRow } from '../../core/types';
import { colorRef, DEFAULT_FONT, GdiPlayer, patternColor, type GdiObject, type Rgb } from './gdi';
import { IDENTITY, type Affine, type Painter } from './painter';
import { DecodeError } from './raster';
import { MAX_METAFILE_SIDE, type MetafileLayout } from './emf';

type Rect = [number, number, number, number];

export interface WmfHeader {
  placeable: { bbox: Rect; inch: number } | null;
  /** Offset of the first record (after the 18-byte META_HEADER). */
  recordsAt: number;
  objects: number;
  /** First SetWindowOrg / SetWindowExt, if any (before scaling). */
  window: { org: [number, number]; ext: [number, number] } | null;
  records: number;
}

const ansi = new TextDecoder('windows-1252');

export function readWmfHeader(bytes: Uint8Array): WmfHeader {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  let placeable: WmfHeader['placeable'] = null;
  if (bytes.length >= 22 && dv.getUint32(0, true) === 0x9ac6cdd7) {
    placeable = {
      bbox: [
        dv.getInt16(6, true),
        dv.getInt16(8, true),
        dv.getInt16(10, true),
        dv.getInt16(12, true),
      ],
      inch: dv.getUint16(14, true) || 1440,
    };
    at = 22;
  }
  if (bytes.length < at + 18) throw new DecodeError('Truncated WMF header');
  const headerWords = dv.getUint16(at + 2, true);
  const objects = dv.getUint16(at + 10, true);
  const recordsAt = at + headerWords * 2;

  // Find the window the drawing uses (its first origin and extent)
  let org: [number, number] | null = null;
  let ext: [number, number] | null = null;
  let records = 0;
  for (let p = recordsAt; p + 6 <= bytes.length;) {
    const size = dv.getUint32(p, true) * 2;
    const fn = dv.getUint16(p + 4, true);
    if (size < 6 || p + size > bytes.length) break;
    records++;
    if (fn === 0) break;
    if (fn === 0x020b && !org) org = [dv.getInt16(p + 8, true), dv.getInt16(p + 6, true)];
    if (fn === 0x020c && !ext) ext = [dv.getInt16(p + 8, true), dv.getInt16(p + 6, true)];
    p += size;
  }
  return {
    placeable,
    recordsAt,
    objects,
    window: ext ? { org: org ?? [0, 0], ext } : null,
    records,
  };
}

/** The placeable box at 96 dpi, else the window's extent in pixels; capped. */
export function wmfLayout(h: WmfHeader, maxSide = MAX_METAFILE_SIDE): MetafileLayout {
  let size: [number, number];
  if (h.placeable) {
    const [l, t, r, b] = h.placeable.bbox;
    size = [(Math.abs(r - l) / h.placeable.inch) * 96, (Math.abs(b - t) / h.placeable.inch) * 96];
  } else if (h.window) {
    size = [Math.abs(h.window.ext[0]), Math.abs(h.window.ext[1])];
  } else {
    throw new DecodeError('The WMF has no size');
  }
  if (!(size[0] > 0 && size[1] > 0)) throw new DecodeError('The WMF has no size');
  const fit = Math.min(1, maxSide / Math.max(size[0], size[1]));
  return {
    width: Math.max(1, Math.round(size[0] * fit)),
    height: Math.max(1, Math.round(size[1] * fit)),
    base: IDENTITY,
  };
}

export function wmfStats(h: WmfHeader): StatRow[] {
  return [
    {
      label: 'Placeable header',
      value: h.placeable ? `Yes (${h.placeable.inch} units per inch)` : 'No',
    },
    { label: 'Records', value: h.records.toLocaleString('en-GB') },
  ];
}

class WmfPlayer extends GdiPlayer {
  /** Whether a SetWindowExt record has run (else the placeable box maps the drawing). */
  windowSet = false;

  constructor(
    painter: Painter,
    private header: WmfHeader,
    private layout: MetafileLayout,
  ) {
    super(painter);
  }

  toDevice(): Affine {
    const { width, height } = this.layout;
    const s = this.state;
    if (this.windowSet && s.windowExt[0] && s.windowExt[1]) {
      const sx = width / s.windowExt[0];
      const sy = height / s.windowExt[1];
      return [sx, 0, 0, sy, -s.windowOrg[0] * sx, -s.windowOrg[1] * sy];
    }
    const box = this.header.placeable?.bbox ?? [0, 0, width, height];
    const [l, t, r, b] = box;
    const sx = r !== l ? width / (r - l) : 1;
    const sy = b !== t ? height / (b - t) : 1;
    return [sx, 0, 0, sy, -l * sx, -t * sy];
  }

  /** New objects take the lowest free slot. */
  add(obj: GdiObject): void {
    let i = this.objects.findIndex(o => o === null || o === undefined);
    if (i < 0) i = this.objects.length;
    this.objects[i] = obj;
  }
}

/** BITMAPINFO length (header, masks and colour table) at the start of a packed DIB. */
function infoLength(b: Uint8Array): number {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const headerSize = dv.getUint32(0, true);
  if (headerSize === 12) {
    const bits = dv.getUint16(10, true);
    return 12 + (bits <= 8 ? (1 << bits) * 3 : 0);
  }
  const bits = dv.getUint16(14, true);
  const compression = dv.getUint32(16, true);
  const used = headerSize >= 36 ? dv.getUint32(32, true) : 0;
  const masks =
    headerSize === 40 && (compression === 3 || compression === 6)
      ? compression === 6
        ? 16
        : 12
      : 0;
  return headerSize + masks + (used || (bits <= 8 ? 1 << bits : 0)) * 4;
}

export async function playWmf(
  bytes: Uint8Array,
  painter: Painter,
  header: WmfHeader,
  layout: MetafileLayout,
): Promise<void> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const gdi = new WmfPlayer(painter, header, layout);
  gdi.objects = Array.from({ length: header.objects }, () => null);
  const w = (o: number) => dv.getInt16(o, true);
  const uw = (o: number) => dv.getUint16(o, true);
  const pts = (o: number, n: number): [number, number][] =>
    Array.from({ length: n }, (_, i) => [w(o + i * 4), w(o + i * 4 + 2)]);
  const dib = (from: number, end: number) => {
    const all = bytes.subarray(from, end);
    if (all.length < 16) return null;
    const n = infoLength(all);
    return n < all.length ? { info: all.subarray(0, n), bits: all.subarray(n) } : null;
  };

  for (let p = header.recordsAt; p + 6 <= bytes.length;) {
    const size = dv.getUint32(p, true) * 2;
    const fn = uw(p + 4);
    if (size < 6 || p + size > bytes.length) break;
    const end = p + size;
    const q = p;
    p += size;
    if (fn === 0) break;
    try {
      switch (fn) {
        case 0x020b:
          gdi.state.windowOrg = [w(q + 8), w(q + 6)];
          break;
        case 0x020c:
          gdi.state.windowExt = [w(q + 8), w(q + 6)];
          gdi.windowSet = true;
          break;
        case 0x020f: {
          const [x, y] = gdi.state.windowOrg;
          gdi.state.windowOrg = [x + w(q + 8), y + w(q + 6)];
          break;
        }
        case 0x0410: {
          const [x, y] = gdi.state.windowExt;
          const [yd, yn, xd, xn] = [w(q + 6), w(q + 8), w(q + 10), w(q + 12)];
          if (xd && yd) gdi.state.windowExt = [(x * xn) / xd, (y * yn) / yd];
          break;
        }
        case 0x020d:
        case 0x020e:
        case 0x0211:
        case 0x0412:
          break; // viewport: the player owns it
        case 0x0103:
          gdi.state.mapMode = uw(q + 6);
          break;
        case 0x0102:
          gdi.state.bkMode = uw(q + 6);
          break;
        case 0x0106:
          gdi.state.polyFill = uw(q + 6);
          break;
        case 0x012e:
          gdi.state.textAlign = uw(q + 6);
          break;
        case 0x0209:
          gdi.state.textColor = colorRef(dv, q + 6);
          break;
        case 0x0201:
          gdi.state.bkColor = colorRef(dv, q + 6);
          break;
        case 0x0214:
          gdi.moveTo(w(q + 8), w(q + 6));
          break;
        case 0x0213:
          gdi.lineTo([[w(q + 8), w(q + 6)]]);
          break;
        case 0x0324:
          gdi.polygon(pts(q + 8, uw(q + 6)));
          break;
        case 0x0325:
          gdi.polyline(pts(q + 8, uw(q + 6)));
          break;
        case 0x0538: {
          const n = uw(q + 6);
          const counts = Array.from({ length: n }, (_, i) => uw(q + 8 + i * 2));
          let at = q + 8 + n * 2;
          gdi.polyPolygon(
            counts.map(c => {
              const poly = pts(at, c);
              at += c * 4;
              return poly;
            }),
          );
          break;
        }
        case 0x041b:
          gdi.rectangle(w(q + 12), w(q + 10), w(q + 8), w(q + 6));
          break;
        case 0x0418:
          gdi.ellipse(w(q + 12), w(q + 10), w(q + 8), w(q + 6));
          break;
        case 0x061c:
          gdi.roundRect(w(q + 16), w(q + 14), w(q + 12), w(q + 10), w(q + 8), w(q + 6));
          break;
        case 0x0817: // ARC
        case 0x081a: // PIE
        case 0x0830: {
          // CHORD
          const kind = fn === 0x0817 ? 'arc' : fn === 0x081a ? 'pie' : 'chord';
          gdi.arc(
            kind,
            [w(q + 20), w(q + 18), w(q + 16), w(q + 14)],
            [w(q + 12), w(q + 10)],
            [w(q + 8), w(q + 6)],
          );
          break;
        }
        case 0x0521: {
          // TEXTOUT
          const n = uw(q + 6);
          const text = ansi.decode(bytes.subarray(q + 8, q + 8 + n));
          const at = q + 8 + n + (n % 2);
          gdi.text({ x: w(at + 2), y: w(at), text, dx: null, options: 0, rect: null });
          break;
        }
        case 0x0a32: {
          // EXTTEXTOUT
          const n = uw(q + 10);
          const options = uw(q + 12);
          const hasRect = (options & 6) !== 0;
          const strAt = q + 14 + (hasRect ? 8 : 0);
          const text = ansi.decode(bytes.subarray(strAt, strAt + n));
          const dxAt = strAt + n + (n % 2);
          const dx =
            dxAt + n * 2 <= end ? Array.from({ length: n }, (_, i) => w(dxAt + i * 2)) : null;
          gdi.text({
            x: w(q + 8),
            y: w(q + 6),
            text,
            dx,
            options,
            rect: hasRect ? [w(q + 14), w(q + 16), w(q + 18), w(q + 20)] : null,
          });
          break;
        }
        case 0x02fa:
          gdi.add({
            type: 'pen',
            pen: { style: uw(q + 6), width: w(q + 8), color: colorRef(dv, q + 12) },
          });
          break;
        case 0x02fc:
          gdi.add({
            type: 'brush',
            brush: { style: uw(q + 6), color: colorRef(dv, q + 8), hatch: uw(q + 12) },
          });
          break;
        case 0x02fb: {
          const faceBytes = bytes.subarray(q + 24, Math.min(end, q + 56));
          const nul = faceBytes.indexOf(0);
          gdi.add({
            type: 'font',
            font: {
              ...DEFAULT_FONT,
              height: w(q + 6),
              escapement: w(q + 10),
              weight: w(q + 14),
              italic: dv.getUint8(q + 16) !== 0,
              underline: dv.getUint8(q + 17) !== 0,
              strike: dv.getUint8(q + 18) !== 0,
              face: ansi.decode(nul >= 0 ? faceBytes.subarray(0, nul) : faceBytes),
            },
          });
          break;
        }
        case 0x0142: {
          // DIBCREATEPATTERNBRUSH
          const d = dib(q + 10, end);
          const color: Rgb = d ? patternColor(d.info, d.bits) : [128, 128, 128];
          gdi.add({ type: 'brush', brush: { style: 0, color, hatch: 0 } });
          break;
        }
        case 0x00f7: // CREATEPALETTE
        case 0x01f9: // CREATEPATTERNBRUSH
        case 0x06ff: // CREATEREGION
          gdi.add({ type: 'other' });
          break;
        case 0x012d:
          gdi.select(gdi.objects[uw(q + 6)]);
          break;
        case 0x01f0:
          gdi.objects[uw(q + 6)] = null;
          break;
        case 0x001e:
          gdi.save();
          break;
        case 0x0127:
          gdi.restore(w(q + 6));
          break;
        case 0x0416:
          gdi.intersectClipRect(w(q + 12), w(q + 10), w(q + 8), w(q + 6));
          break;
        case 0x0415:
          gdi.excludeClipRect(w(q + 12), w(q + 10), w(q + 8), w(q + 6));
          break;
        case 0x012c: // SELECTCLIPREGION: usually resetting the clip
          gdi.resetClip();
          break;
        case 0x061d: {
          // PATBLT
          const rop = dv.getUint32(q + 6, true);
          const [h, wd, y, x] = [w(q + 10), w(q + 12), w(q + 14), w(q + 16)];
          gdi.fillRect(x, y, x + wd, y + h, rop);
          break;
        }
        case 0x041f: {
          // SETPIXEL
          const [y, x] = [w(q + 10), w(q + 12)];
          const saved = gdi.state.brush;
          gdi.state.brush = { style: 0, color: colorRef(dv, q + 6), hatch: 0 };
          gdi.fillRect(x, y, x + 1, y + 1, 0xf00021);
          gdi.state.brush = saved;
          break;
        }
        case 0x0f43: {
          // STRETCHDIB
          const rop = dv.getUint32(q + 6, true);
          const src: Rect = [w(q + 18), w(q + 16), w(q + 14), w(q + 12)];
          const dest: Rect = [w(q + 26), w(q + 24), w(q + 22), w(q + 20)];
          const d = dib(q + 28, end);
          if (d) await gdi.blit(d.info, d.bits, src, dest, rop, { bottomUpOrigin: true });
          break;
        }
        case 0x0b41: {
          // DIBSTRETCHBLT (with a bitmap unless the record is the short form)
          const rop = dv.getUint32(q + 6, true);
          const src: Rect = [w(q + 16), w(q + 14), w(q + 12), w(q + 10)];
          if (size <= 28) {
            const [h, wd, y, x] = [w(q + 20), w(q + 22), w(q + 24), w(q + 26)];
            gdi.fillRect(x, y, x + wd, y + h, rop);
            break;
          }
          const dest: Rect = [w(q + 24), w(q + 22), w(q + 20), w(q + 18)];
          const d = dib(q + 26, end);
          if (d) await gdi.blit(d.info, d.bits, src, dest, rop);
          break;
        }
        case 0x0940: {
          // DIBBITBLT
          const rop = dv.getUint32(q + 6, true);
          if (size <= 24) {
            const [h, wd, y, x] = [w(q + 16), w(q + 18), w(q + 20), w(q + 22)];
            gdi.fillRect(x, y, x + wd, y + h, rop);
            break;
          }
          const [ys, xs, h, wd, y, x] = [
            w(q + 10),
            w(q + 12),
            w(q + 14),
            w(q + 16),
            w(q + 18),
            w(q + 20),
          ];
          const d = dib(q + 22, end);
          if (d) await gdi.blit(d.info, d.bits, [xs, ys, wd, h], [x, y, wd, h], rop);
          break;
        }
        default:
          break;
      }
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
    }
  }
}
