import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEXT_SCALE,
  FONT_SCALE,
  parseTextScale,
  scaled,
  TEXT_SCALES,
} from '../../src/theme';

describe('text size', () => {
  it('parses the offered scales', () => {
    for (const s of TEXT_SCALES) expect(parseTextScale(String(s))).toBe(s);
  });

  it('rejects anything else', () => {
    for (const raw of [null, '', 'big', '1.3', '0', '-1', '125%', 'NaN'])
      expect(parseTextScale(raw)).toBeNull();
  });

  it('defaults to 125% where there is no page (and so no saved choice)', () => {
    expect(DEFAULT_TEXT_SCALE).toBe(1.25);
    expect(FONT_SCALE).toBe(DEFAULT_TEXT_SCALE);
    expect(scaled(12)).toBe(15);
  });
});
