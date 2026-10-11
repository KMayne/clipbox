import { digestHex } from '../../hash';
import { anyHash } from '../catalog/any';
import { anyValue, implement } from '../types';
import { textResult } from './util';

export const anyImpls = [
  implement(anyHash, {
    value: anyValue,
    run: async ({ content }, { algorithm }) =>
      textResult(await digestHex(algorithm, content.bytes)),
  }),
];
