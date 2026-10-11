/** Pure geometry and colour maths for the image actions (the canvas work is in run/image.ts). */

export interface Size {
  width: number;
  height: number;
}

/** Largest output side, to keep canvases within what browsers allocate. */
export const MAX_SIDE = 16_384;

export interface ResizeParams {
  size: '75' | '50' | '25' | 'custom';
  width: number;
  height: number;
  keepAspect: boolean;
}

/**
 * Output size. Presets scale both sides. Custom: with keep-aspect, one side set derives the
 * other and both set fit inside that box; without it, an unset (0) side keeps its original size.
 */
export function resizeTarget(src: Size, p: ResizeParams): Size {
  let w: number;
  let h: number;
  if (p.size !== 'custom') {
    const s = Number(p.size) / 100;
    w = src.width * s;
    h = src.height * s;
  } else if (!p.width && !p.height) {
    throw new Error('Set a width or a height');
  } else if (!p.keepAspect) {
    w = p.width || src.width;
    h = p.height || src.height;
  } else {
    const scale = Math.min(
      p.width ? p.width / src.width : Infinity,
      p.height ? p.height / src.height : Infinity,
    );
    w = src.width * scale;
    h = src.height * scale;
  }
  const out = { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
  if (out.width > MAX_SIDE || out.height > MAX_SIDE) {
    throw new Error(`${out.width}×${out.height} is too large (at most ${MAX_SIDE} px a side)`);
  }
  return out;
}

export type Transform = 'cw' | '180' | 'ccw' | 'flipH' | 'flipV';

/** Output size and the canvas matrix (a, b, c, d, e, f) that draws the source transformed. */
export function transformTarget(
  { width: w, height: h }: Size,
  op: Transform,
): Size & { matrix: [number, number, number, number, number, number] } {
  switch (op) {
    case 'cw':
      return { width: h, height: w, matrix: [0, 1, -1, 0, h, 0] };
    case 'ccw':
      return { width: h, height: w, matrix: [0, -1, 1, 0, 0, w] };
    case '180':
      return { width: w, height: h, matrix: [-1, 0, 0, -1, w, h] };
    case 'flipH':
      return { width: w, height: h, matrix: [-1, 0, 0, 1, w, 0] };
    case 'flipV':
      return { width: w, height: h, matrix: [1, 0, 0, -1, 0, h] };
  }
}

// --- Palette ---

type Rgb = [number, number, number];

const hex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

const dist2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const ch = (p: Rgb, c: number) => (c === 0 ? p[0] : c === 1 ? p[1] : p[2]);

/** Median cut: repeatedly split the box with the widest channel range at its median. */
function medianCut(pixels: Rgb[], count: number): Rgb[][] {
  const boxes: Rgb[][] = [pixels];
  while (boxes.length < count) {
    let best = -1;
    let bestRange = 0;
    let bestChannel = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255;
        let hi = 0;
        for (const p of box) {
          lo = Math.min(lo, ch(p, c));
          hi = Math.max(hi, ch(p, c));
        }
        // Weight by population so big boxes split first
        const range = (hi - lo) * Math.sqrt(box.length);
        if (hi > lo && range > bestRange) {
          best = i;
          bestRange = range;
          bestChannel = c;
        }
      }
    });
    if (best === -1) break; // every box is one colour
    const box = boxes[best] ?? [];
    box.sort((a, b) => ch(a, bestChannel) - ch(b, bestChannel));
    const mid = Math.floor(box.length / 2);
    boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes;
}

const mean = (box: Rgb[]): Rgb => {
  const sum: Rgb = [0, 0, 0];
  for (const p of box) {
    sum[0] += p[0];
    sum[1] += p[1];
    sum[2] += p[2];
  }
  return [sum[0] / box.length, sum[1] / box.length, sum[2] / box.length];
};

/**
 * Dominant colours of RGBA pixel data, most common first, as `#rrggbb`. Median cut seeds a few
 * rounds of k-means; mostly transparent pixels are ignored. Deterministic for the same input.
 */
export function palette(rgba: ArrayLike<number>, count: number): string[] {
  const pixels: Rgb[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if ((rgba[i + 3] ?? 0) < 128) continue;
    pixels.push([rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0]);
  }
  if (!pixels.length) return [];
  let centres = medianCut(pixels, count).map(mean);
  let sizes: number[] = [];
  for (let round = 0; round < 8; round++) {
    const sums = centres.map((): [number, number, number, number] => [0, 0, 0, 0]);
    for (const p of pixels) {
      let k = 0;
      let d = Infinity;
      centres.forEach((c, j) => {
        const dj = dist2(p, c);
        if (dj < d) {
          d = dj;
          k = j;
        }
      });
      const s = sums[k];
      if (!s) continue;
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    }
    const next = sums.map((s, j): Rgb =>
      s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : (centres[j] ?? [0, 0, 0]),
    );
    sizes = sums.map(s => s[3]);
    const moved = next.some((c, j) => dist2(c, centres[j] ?? c) > 0.25);
    centres = next;
    if (!moved) break;
  }
  // Most common first; drop empty clusters and colours that round to the same hex
  const seen = new Set<string>();
  return centres
    .map((c, j) => ({ hex: hex(c), n: sizes[j] ?? 0 }))
    .filter(c => c.n > 0)
    .sort((a, b) => b.n - a.n)
    .filter(c => (seen.has(c.hex) ? false : (seen.add(c.hex), true)))
    .map(c => c.hex);
}
