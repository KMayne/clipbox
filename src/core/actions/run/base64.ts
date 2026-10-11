import { toBase64 } from '../../format';
import { base64Interpreter } from '../../interpreters/base64';
import { detectMagic, MAGIC_MIME } from '../../magic';
import { base64Alphabet, base64DataUrl } from '../catalog/base64';
import { implement } from '../types';
import { textResult } from './util';

/** Standard padded base64 → the requested alphabet and padding. */
export function rebase64(bytes: Uint8Array, to: 'standard' | 'url', padded: boolean): string {
  let s = toBase64(bytes);
  if (to === 'url') s = s.replace(/\+/g, '-').replace(/\//g, '_');
  return padded ? s : s.replace(/=+$/, '');
}

export const base64Impls = [
  implement(base64DataUrl, {
    value: base64Interpreter.isValue,
    applies: ({ value }) => !value.dataUrl,
    run({ value }) {
      // The decoded bytes' own signature wins; else the interpreter's text/JSON/binary guess
      const magic = detectMagic(value.bytes);
      const mime = magic ? MAGIC_MIME[magic] : value.mime;
      const type =
        mime.startsWith('text/') || mime === 'application/json' ? `${mime};charset=utf-8` : mime;
      return textResult(`data:${type};base64,${rebase64(value.bytes, 'standard', true)}`);
    },
  }),
  implement(base64Alphabet, {
    value: base64Interpreter.isValue,
    applies: ({ value }) => !value.dataUrl,
    run({ value }, { to, padding }) {
      const padded = padding === 'keep' ? value.padded : padding === 'add';
      return textResult(rebase64(value.bytes, to, padded));
    },
  }),
];
