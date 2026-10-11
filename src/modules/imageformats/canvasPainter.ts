/** The Painter on an OffscreenCanvas (engine worker), and PNG encoding of rasters. */

import {
  compose,
  meanScale,
  type Affine,
  type Clip,
  type Font,
  type ImageDraw,
  type Paint,
  type Painter,
  type Path,
  type Stroke,
  type TextRun,
} from './painter';
import type { Raster } from './raster';

type Ctx = OffscreenCanvasRenderingContext2D;

function context(canvas: OffscreenCanvas): Ctx {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas in this browser');
  return ctx;
}

export async function encodePng(canvas: OffscreenCanvas): Promise<Uint8Array<ArrayBuffer>> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

function rasterCanvas(r: Raster): OffscreenCanvas {
  const canvas = new OffscreenCanvas(r.width, r.height);
  context(canvas).putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
  return canvas;
}

export const rasterToPng = (r: Raster) => encodePng(rasterCanvas(r));

const GENERIC: [RegExp, string][] = [
  [/courier|consol|mono|lucida console|fixedsys|terminal/i, 'monospace'],
  [/times|georgia|garamond|roman|serif|cambria|book|palatino/i, 'serif'],
];

/** CSS font shorthand for a metafile font, with a generic fallback. */
export function cssFont(f: Font, size = f.size): string {
  const face = f.family.replace(/["\\]/g, '').trim();
  const generic = GENERIC.find(([re]) => re.test(face))?.[1] ?? 'sans-serif';
  const family = face ? `"${face}", ${generic}` : generic;
  return `${f.italic ? 'italic ' : ''}${f.weight} ${Math.max(0.01, size)}px ${family}`;
}

/** Hatch patterns are drawn in output pixels, 8 px apart. */
function hatch(
  ctx: Ctx,
  style: number,
  color: string,
  background: string | null,
): CanvasPattern | string {
  const tile = new OffscreenCanvas(8, 8);
  const t = context(tile);
  if (background) {
    t.fillStyle = background;
    t.fillRect(0, 0, 8, 8);
  }
  t.strokeStyle = color;
  t.lineWidth = 1;
  t.beginPath();
  const h = () => (t.moveTo(0, 3.5), t.lineTo(8, 3.5));
  const v = () => (t.moveTo(3.5, 0), t.lineTo(3.5, 8));
  const down = () => (t.moveTo(0, 0), t.lineTo(8, 8));
  const up = () => (t.moveTo(0, 8), t.lineTo(8, 0));
  [[h], [v], [down], [up], [h, v], [down, up]][style]?.forEach(f => f());
  t.stroke();
  return ctx.createPattern(tile, 'repeat') ?? color;
}

export class CanvasPainter implements Painter {
  readonly canvas: OffscreenCanvas;
  private ctx: Ctx;

  /** `base` maps device coordinates to canvas pixels. */
  constructor(
    width: number,
    height: number,
    private base: Affine,
    background: string | null = null,
  ) {
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = context(this.canvas);
    if (background) {
      this.ctx.fillStyle = background;
      this.ctx.fillRect(0, 0, width, height);
    }
  }

  private trace(path: Path): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const p of path) {
      if (p.op === 'M') ctx.moveTo(p.x, p.y);
      else if (p.op === 'L') ctx.lineTo(p.x, p.y);
      else if (p.op === 'C') ctx.bezierCurveTo(p.x1, p.y1, p.x2, p.y2, p.x, p.y);
      else ctx.closePath();
    }
  }

  private with(clip: Clip[], draw: () => void): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(...this.base);
    for (const c of clip) {
      this.trace(c.path);
      ctx.clip(c.rule);
    }
    draw();
    ctx.restore();
  }

  private style(paint: Paint): string | CanvasGradient | CanvasPattern {
    if (typeof paint === 'string') return paint;
    if (paint.type === 'hatch') return hatch(this.ctx, paint.style, paint.color, paint.background);
    const g = this.ctx.createLinearGradient(paint.x0, paint.y0, paint.x1, paint.y1);
    for (const [at, color] of paint.stops) g.addColorStop(Math.max(0, Math.min(1, at)), color);
    return g;
  }

  fill(path: Path, rule: CanvasFillRule, paint: Paint, clip: Clip[]): void {
    this.with(clip, () => {
      if (typeof paint !== 'string' && paint.type === 'hatch') {
        // Patterns tile in canvas pixels, not device units
        this.trace(path);
        this.ctx.save();
        this.ctx.clip(rule);
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.fillStyle = this.style(paint);
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
        return;
      }
      this.trace(path);
      this.ctx.fillStyle = this.style(paint);
      this.ctx.fill(rule);
    });
  }

  stroke(path: Path, s: Stroke, clip: Clip[]): void {
    this.with(clip, () => {
      const ctx = this.ctx;
      this.trace(path);
      // At least one canvas pixel wide, so hairlines show
      const minWidth = 1 / Math.max(1e-9, meanScale(this.base));
      ctx.lineWidth = Math.max(s.width, minWidth);
      ctx.strokeStyle = s.color;
      ctx.lineCap = s.cap;
      ctx.lineJoin = s.join;
      ctx.miterLimit = s.miter;
      ctx.setLineDash(s.dash);
      ctx.stroke();
    });
  }

  measure(text: string, font: Font): number {
    // Measure at a sane size and scale: canvases round tiny font sizes
    const ctx = this.ctx;
    ctx.save();
    ctx.font = cssFont(font, 100);
    const w = ctx.measureText(text).width;
    ctx.restore();
    return (w * font.size) / 100;
  }

  text(run: TextRun, clip: Clip[]): void {
    this.with(clip, () => {
      const ctx = this.ctx;
      ctx.transform(...run.matrix);
      // Draw at 100px and scale, as canvases clamp or round very small and very large sizes
      const k = run.font.size / 100;
      ctx.translate(run.x, run.y);
      ctx.scale(k, k);
      ctx.font = cssFont(run.font, 100);
      ctx.fillStyle = run.color;
      ctx.textBaseline = run.baseline;
      if (run.dx && run.dx.length > 0) {
        // Exact advances: draw each character where the metafile put it
        ctx.textAlign = 'left';
        const total = run.dx.reduce((s, d) => s + d, 0) / k;
        let x = run.align === 'center' ? -total / 2 : run.align === 'right' ? -total : 0;
        const chars = [...run.text];
        chars.forEach((ch, i) => {
          ctx.fillText(ch, x, 0);
          x += (run.dx?.[i] ?? 0) / k;
        });
        this.decorate(run, total);
      } else {
        ctx.textAlign = run.align;
        ctx.fillText(run.text, 0, 0);
        this.decorate(run, ctx.measureText(run.text).width);
      }
    });
  }

  /** Underline and strike-through, in the 100px text space `text` sets up. */
  private decorate(run: TextRun, width: number): void {
    if (!run.font.underline && !run.font.strike) return;
    const ctx = this.ctx;
    const x = run.align === 'center' ? -width / 2 : run.align === 'right' ? -width : 0;
    const base = run.baseline === 'top' ? 80 : run.baseline === 'bottom' ? -20 : 0;
    ctx.fillStyle = run.color;
    if (run.font.underline) ctx.fillRect(x, base + 10, width, 6);
    if (run.font.strike) ctx.fillRect(x, base - 30, width, 6);
  }

  async image(d: ImageDraw, clip: Clip[]): Promise<void> {
    const source =
      'data' in d.image
        ? rasterCanvas(d.image)
        : await createImageBitmap(new Blob([d.image.bytes], { type: d.image.mime }));
    this.with(clip, () => {
      const ctx = this.ctx;
      ctx.setTransform(...compose(this.base, d.matrix));
      ctx.globalAlpha = d.alpha;
      ctx.globalCompositeOperation = d.composite;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, d.sx, d.sy, d.sw, d.sh, 0, 0, d.sw, d.sh);
    });
    if (source instanceof ImageBitmap) source.close();
  }

  png(): Promise<Uint8Array<ArrayBuffer>> {
    return encodePng(this.canvas);
  }
}
