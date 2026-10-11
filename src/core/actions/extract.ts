/** Shared by the "Extract images" actions: page/slide range settings and the result cap. */

import { z } from 'zod';
import type { DerivedContent } from '../types';

/** "1-3, 7, 10-" (an open end runs to the last one); empty means all. */
const RANGE = /^\s*(\d+\s*(-\s*\d*\s*)?(,\s*\d+\s*(-\s*\d*\s*)?)*)?$/;

/** A page or slide range setting, e.g. `rangeParam('Slides')`. */
export const rangeParam = (title: string) =>
  z
    .string()
    .regex(RANGE, 'Use numbers and ranges, e.g. 1-3,7')
    .default('')
    .meta({ title, description: 'e.g. 1-3,7; empty for all' });

/**
 * The 1-based numbers a range picks out of 1…`max`, ascending; null when it's empty (all).
 * Throws when it's malformed or picks nothing.
 */
export function parseRange(text: string, max: number, unit: string): number[] | null {
  if (text.trim() === '') return null;
  if (!RANGE.test(text)) throw new Error(`Invalid ${unit} range '${text}'`);
  const picked = new Set<number>();
  for (const part of text.split(',')) {
    const [a = '', b] = part.split('-').map(s => s.trim());
    const from = Number(a);
    const to = b === undefined ? from : b === '' ? max : Number(b);
    for (let n = Math.max(1, Math.min(from, to)); n <= Math.min(max, Math.max(from, to)); n++) {
      picked.add(n);
    }
  }
  if (picked.size === 0) {
    throw new Error(`No ${unit}s in '${text.trim()}' (there ${max === 1 ? 'is' : 'are'} ${max})`);
  }
  return [...picked].sort((x, y) => x - y);
}

/** Most results one extraction returns; past this it adds a note instead. */
export const MAX_EXTRACTED = 500;

/** The last entry of a capped extraction, saying why it stopped. */
export const truncatedNote = (unit: string): DerivedContent => ({
  mime: 'text/plain',
  name: 'more-images.txt',
  bytes: new TextEncoder().encode(
    `Stopped after ${MAX_EXTRACTED} images. Extract a smaller ${unit} range to get the rest.\n`,
  ),
});
