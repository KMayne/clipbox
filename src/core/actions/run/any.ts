import { formatBytes } from '../../format';
import { digestHex } from '../../hash';
import { hexDump } from '../../hexdump';
import { anyHash, anyHexDump, anyOpenAsText } from '../catalog/any';
import { anyValue, implement } from '../types';
import { textResult } from './util';

/** Decodes bytes; a BOM for the chosen encoding is dropped. Invalid bytes become U+FFFD. */
export function decodeAs(
  bytes: Uint8Array<ArrayBuffer>,
  encoding: 'utf-8' | 'latin1' | 'utf-16le' | 'utf-16be',
): string {
  // The Encoding Standard maps "latin1" to windows-1252, its superset
  return new TextDecoder(encoding === 'latin1' ? 'windows-1252' : encoding).decode(bytes);
}

export const anyImpls = [
  implement(anyHash, {
    value: anyValue,
    // crypto.subtle digests in one call (it can't stream), so the bar is indeterminate
    async run({ content }, { algorithm }, ctx) {
      ctx.progress(undefined, `Hashing ${formatBytes(content.size)}`);
      return textResult(await digestHex(algorithm, content.bytes));
    },
  }),
  implement(anyOpenAsText, {
    value: anyValue,
    // Text entries are already decoded as UTF-8
    applies: ({ content }) => content.text === null && content.size > 0,
    run: ({ content }, { encoding }) => textResult(decodeAs(content.bytes, encoding)),
  }),
  implement(anyHexDump, {
    value: anyValue,
    applies: ({ content }) => content.size > 0,
    run: ({ content }, { bytesPerRow }) => textResult(hexDump(content.bytes, Number(bytesPerRow))),
  }),
];
