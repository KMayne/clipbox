import { toCsv } from '../../csv';
import { plural } from '../../format';
import { isRecord } from '../../guards';
import { ndjsonInterpreter } from '../../interpreters/ndjson';
import { ndjsonInvalid, ndjsonToCsv, ndjsonToJson } from '../catalog/ndjson';
import { implement } from '../types';
import { textResult, withExtension } from './util';

const value = ndjsonInterpreter.isValue;

export const ndjsonImpls = [
  implement(ndjsonToJson, {
    value,
    run({ value, content }) {
      const skipped = value.invalidLines.length;
      return {
        ...textResult(
          JSON.stringify(value.items, null, 2),
          'application/json',
          withExtension(content.name, 'json', 'data'),
        ),
        ...(skipped > 0 && { note: `${plural(skipped, 'invalid line')} skipped` }),
      };
    },
  }),
  implement(ndjsonToCsv, {
    value,
    applies: ({ value }) => value.items.every(isRecord),
    run({ value, content }) {
      const rows = value.items.filter(isRecord);
      return textResult(toCsv(rows), 'text/csv', withExtension(content.name, 'csv', 'data'));
    },
  }),
  implement(ndjsonInvalid, {
    value,
    applies: ({ value }) => value.invalidLines.length > 0,
    run({ value, content }) {
      const lines = (content.text ?? '').split('\n');
      const out = value.invalidLines.map(n => `${n}: ${(lines[n - 1] ?? '').replace(/\r$/, '')}`);
      return {
        ...textResult(out.join('\n') + '\n', 'text/plain', 'invalid-lines.txt'),
        note: plural(out.length, 'line'),
      };
    },
  }),
];
