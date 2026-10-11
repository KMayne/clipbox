import { binaryInterpreter } from '../../interpreters/binary';
import { binaryToBase64 } from '../catalog/binary';
import { implement } from '../types';
import { rebase64 } from './base64';
import { textResult } from './util';

export const binaryImpls = [
  implement(binaryToBase64, {
    value: binaryInterpreter.isValue,
    run({ value }, { alphabet, wrap }) {
      const b64 = rebase64(value.bytes, alphabet, true);
      return textResult(wrap ? `${(b64.match(/.{1,76}/g) ?? []).join('\n')}\n` : b64);
    },
  }),
];
