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
const FUNC = /^(rgba?|hsla?)\(\s*([^()]*?)\s*\)$/i;
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

/** Parses `#rgb[a]`, `#rrggbb[aa]`, `rgb[a]()` and `hsl[a]()` (comma or space syntax). */
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
  if ((m[1] ?? '').toLowerCase().startsWith('rgb')) {
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
