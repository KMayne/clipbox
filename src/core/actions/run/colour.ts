import {
  colourInterpreter,
  contrastRatio,
  parseColour,
  toHex,
  toHslString,
  toOklchString,
  toRgbString,
  type Rgba,
} from '../../interpreters/colour';
import { colourContrast, colourConvert } from '../catalog/colour';
import { implement } from '../types';
import { textResult } from './util';

const CONVERT = { hex: toHex, rgb: toRgbString, hsl: toHslString, oklch: toOklchString };

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/** Two decimals, rounded down: WCAG thresholds must not be met by rounding up (4.499 ≠ 4.5). */
const ratioText = (ratio: number) => `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;

const verdict = (ratio: number, min: number) => (ratio >= min ? 'pass' : 'fail');

/** One line per pair: the ratio and WCAG 2 AA/AAA results for normal and large text. */
export function contrastLine(name: string, a: Rgba, b: Rgba): string {
  const ratio = contrastRatio(a, b);
  return (
    `${name}: ${ratioText(ratio)} · ` +
    `normal text AA ${verdict(ratio, 4.5)}, AAA ${verdict(ratio, 7)} · ` +
    `large text AA ${verdict(ratio, 3)}, AAA ${verdict(ratio, 4.5)}`
  );
}

export function contrastReport(colour: Rgba, against: string): string {
  const lines = [
    `Contrast for ${toHex(colour)} (WCAG 2)`,
    '',
    contrastLine('vs white #ffffff', colour, WHITE),
    contrastLine('vs black #000000', colour, BLACK),
  ];
  const other = against.trim();
  if (other) {
    const second = parseColour(other);
    if (!second)
      throw new Error(`"${other.slice(0, 40)}" isn't a colour (try hex, rgb(), hsl() or oklch())`);
    lines.push(contrastLine(`vs ${toHex(second)}`, colour, second));
  }
  lines.push(
    '',
    'AA: 4.5:1 for normal text, 3:1 for large (18pt, or 14pt bold). AAA: 7:1 and 4.5:1.',
  );
  if (colour.a < 1) lines.push('Alpha is ignored: the colour is treated as opaque.');
  return `${lines.join('\n')}\n`;
}

export const colourImpls = [
  implement(colourConvert, {
    value: colourInterpreter.isValue,
    run: ({ value }, { to }) => textResult(CONVERT[to](value)),
  }),
  implement(colourContrast, {
    value: colourInterpreter.isValue,
    run: ({ value }, { against }) => textResult(contrastReport(value, against)),
  }),
];
