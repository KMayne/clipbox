import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { shortText, type CardData, type CardRow } from '../smallValue';

export interface Rgba {
  /** 0–255 */
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

interface ColourValue extends Rgba {
  kind: 'colour';
  input: string;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(rgba?|hsla?|oklch)\(\s*([^()]*?)\s*\)$/i;
const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(%|deg|grad|rad|turn)?$/i;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

interface Num {
  n: number;
  unit: string;
}

function num(s: string): Num | null {
  const m = NUM.exec(s);
  return m ? { n: parseFloat(s), unit: (m[1] ?? '').toLowerCase() } : null;
}

/** Splits `a, b, c[, d]` or `a b c[ / d]` into numbers; null if malformed. */
function args(inner: string): Num[] | null {
  let parts: string[];
  if (inner.includes(',')) {
    parts = inner.split(',').map(p => p.trim());
  } else {
    const [main = '', alpha, ...rest] = inner.split('/').map(p => p.trim());
    if (rest.length > 0) return null;
    parts = main.split(/\s+/);
    if (alpha !== undefined) parts.push(alpha);
  }
  if (parts.length < 3 || parts.length > 4) return null;
  const nums = parts.map(num);
  return nums.every((n): n is Num => n !== null) ? nums : null;
}

function alphaOf(x: Num | undefined): number | null {
  if (!x) return 1;
  if (x.unit === '%') return clamp(x.n / 100, 0, 1);
  return x.unit === '' ? clamp(x.n, 0, 1) : null;
}

function channel(x: Num): number | null {
  if (x.unit === '%') return clamp((x.n / 100) * 255, 0, 255);
  return x.unit === '' ? clamp(x.n, 0, 255) : null;
}

const HUE_UNITS: Record<string, number> = {
  '': 1,
  deg: 1,
  grad: 0.9,
  rad: 180 / Math.PI,
  turn: 360,
};

function hue(x: Num): number | null {
  const deg = HUE_UNITS[x.unit];
  return deg === undefined ? null : (((x.n * deg) % 360) + 360) % 360;
}

function percent(x: Num): number | null {
  return x.unit === '%' || x.unit === '' ? clamp(x.n, 0, 100) : null;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

const srgbToLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb = (c: number) =>
  clamp((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255, 0, 255);

/** sRGB (0–255) → OKLCH: L 0–1, C (≈0–0.4), H in degrees. Björn Ottosson's OKLab matrices. */
export function rgbToOklch(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return [L, C < 1e-4 ? 0 : C, H];
}

/** OKLCH → sRGB (0–255), clipped to the sRGB gamut. */
export function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const rad = (H * Math.PI) / 180;
  const [A, B] = [C * Math.cos(rad), C * Math.sin(rad)];
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Parses `#rgb[a]`, `#rrggbb[aa]`, `rgb[a]()`, `hsl[a]()` (comma or space syntax) and `oklch()`. */
export function parseColour(s: string): Rgba | null {
  const hex = HEX.exec(s)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map(c => c + c).join('') : hex;
    const byte = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16);
    return { r: byte(0), g: byte(1), b: byte(2), a: full.length === 8 ? byte(3) / 255 : 1 };
  }
  const m = FUNC.exec(s);
  if (!m) return null;
  const a = args(m[2] ?? '');
  if (!a) return null;
  const [x, y, z, w] = a;
  if (!x || !y || !z) return null;
  const alpha = alphaOf(w);
  if (alpha === null) return null;
  const fn = (m[1] ?? '').toLowerCase();
  if (fn === 'oklch') {
    // L: 0–1 or %; C: number or % (100% = 0.4); H: angle
    const L = x.unit === '%' ? x.n / 100 : x.unit === '' ? x.n : null;
    const C = y.unit === '%' ? (y.n / 100) * 0.4 : y.unit === '' ? y.n : null;
    const h = hue(z);
    if (L === null || C === null || h === null) return null;
    const [r, g, b] = oklchToRgb(clamp(L, 0, 1), Math.max(0, C), h);
    return { r, g, b, a: alpha };
  }
  if (fn.startsWith('rgb')) {
    const [r, g, b] = [channel(x), channel(y), channel(z)];
    if (r === null || g === null || b === null) return null;
    return { r, g, b, a: alpha };
  }
  const [h, sat, l] = [hue(x), percent(y), percent(z)];
  if (h === null || sat === null || l === null) return null;
  const [r, g, b] = hslToRgb(h, sat, l);
  return { r, g, b, a: alpha };
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
const round = (n: number, dp = 1) => String(Math.round(n * 10 ** dp) / 10 ** dp);

export function toHex({ r, g, b, a }: Rgba): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ''}`;
}

export function toRgbString({ r, g, b, a }: Rgba): string {
  const c = [r, g, b].map(n => Math.round(n)).join(', ');
  return a < 1 ? `rgba(${c}, ${round(a, 3)})` : `rgb(${c})`;
}

export function toHslString({ r, g, b, a }: Rgba): string {
  const [h, s, l] = rgbToHsl(r, g, b);
  const c = `${round(h)}, ${round(s)}%, ${round(l)}%`;
  return a < 1 ? `hsla(${c}, ${round(a, 3)})` : `hsl(${c})`;
}

export function toOklchString({ r, g, b, a }: Rgba): string {
  const [L, C, H] = rgbToOklch(r, g, b);
  const c = `${round(L * 100, 2)}% ${round(C, 4)} ${round(H, 2)}`;
  return a < 1 ? `oklch(${c} / ${round(a, 3)})` : `oklch(${c})`;
}

/** WCAG 2 relative luminance (alpha ignored). */
export function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = [Math.max(la, lb), Math.min(la, lb)];
  return (hi + 0.05) / (lo + 0.05);
}

function contrastText(ratio: number): string {
  const grade =
    ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large text only' : 'fails';
  return `${ratio.toFixed(2)}:1 (${grade})`;
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

function representations(v: ColourValue): CardRow[] {
  return [
    { label: 'Hex', value: toHex(v) },
    { label: 'RGB', value: toRgbString(v) },
    { label: 'HSL', value: toHslString(v) },
  ];
}

export const colourInterpreter: Interpreter<ColourValue> = {
  kind: 'colour',
  isValue: (v): v is ColourValue => hasKind(v, 'colour'),
  detect(c) {
    const t = shortText(c);
    return t !== null && parseColour(t) ? 0.95 : 0;
  },
  parse(c) {
    const input = shortText(c);
    const rgba = input === null ? null : parseColour(input);
    if (input === null || !rgba) throw new Error('Not a colour');
    return { kind: 'colour', input, ...rgba };
  },
  label: v => `Colour · ${toHex(v)}`,
  summarise(v) {
    return {
      stats: [
        ...representations(v),
        { label: 'Alpha', value: round(v.a, 3) },
        { label: 'Contrast vs white', value: contrastText(contrastRatio(v, WHITE)) },
        { label: 'Contrast vs black', value: contrastText(contrastRatio(v, BLACK)) },
      ],
      extent: 1,
    };
  },
  slice(v, req) {
    if (req.type === 'json')
      return { rows: representations(v), swatch: toRgbString(v) } satisfies CardData;
    return unsupportedSlice('colour', req);
  },
  export: v => ({ text: toHex(v) }),
};
