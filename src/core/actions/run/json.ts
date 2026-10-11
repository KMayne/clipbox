import { stringify } from 'yaml';
import { isRecord } from '../../guards';
import { jsonInterpreter } from '../../interpreters/json';
import { inferSchema, schemaToTs } from '../../schema';
import { jsonFormat, jsonMinify, jsonSortKeys, jsonToYaml, jsonTypes } from '../catalog/json';
import { implement } from '../types';
import { textResult } from './util';

const value = jsonInterpreter.isValue;

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isRecord(v)) return v;
  return Object.fromEntries(
    Object.keys(v)
      .sort()
      .map(k => [k, sortKeys(v[k])]),
  );
}

export const jsonImpls = [
  implement(jsonFormat, {
    value,
    run: ({ value }, { indent }) =>
      textResult(
        JSON.stringify(value.json, null, indent === 'tab' ? '\t' : Number(indent)),
        'application/json',
      ),
  }),
  implement(jsonMinify, {
    value,
    run: ({ value }) => textResult(JSON.stringify(value.json), 'application/json'),
  }),
  implement(jsonSortKeys, {
    value,
    run: ({ value }) =>
      textResult(JSON.stringify(sortKeys(value.json), null, 2), 'application/json'),
  }),
  implement(jsonToYaml, {
    value,
    run: ({ value }) => textResult(stringify(value.json), 'application/yaml'),
  }),
  implement(jsonTypes, {
    value,
    run({ value }, { rootName }) {
      const schema = inferSchema(value.json);
      const body = schemaToTs(schema);
      const ts =
        schema.t === 'object' && Object.keys(schema.fields).length > 0
          ? `export interface ${rootName} ${body}\n`
          : `export type ${rootName} = ${body};\n`;
      return textResult(ts, 'text/typescript', `${rootName}.ts`);
    },
  }),
];
