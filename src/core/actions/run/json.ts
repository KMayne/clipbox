import { stringify } from 'yaml';
import { isRecord } from '../../guards';
import { jsonInterpreter } from '../../interpreters/json';
import { recordsInterpreter, type RecordsValue } from '../../interpreters/records';
import { inferSchema, schemaToTs } from '../../schema';
import { JsonPathError, parseJsonPath, queryJsonPath } from '../../jsonPath';
import {
  jsonFlatten,
  jsonFormat,
  jsonMinify,
  jsonPick,
  jsonSortKeys,
  jsonToNdjson,
  jsonToYaml,
  jsonTypes,
} from '../catalog/json';
import { implement } from '../types';
import { textResult, withExtension } from './util';

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
  implement(jsonToNdjson, {
    value,
    applies: ({ value }) => Array.isArray(value.json),
    run({ value, content }) {
      if (!Array.isArray(value.json)) throw new Error('NDJSON needs a JSON array');
      const lines = value.json.map(item => JSON.stringify(item));
      return textResult(
        lines.join('\n') + '\n',
        'application/x-ndjson',
        withExtension(content.name, 'ndjson', 'data'),
      );
    },
  }),
  implement(jsonFlatten, {
    value,
    applies: ({ value }) => value.json !== null && typeof value.json === 'object',
    run: ({ value }, { separator, arrays }) =>
      textResult(
        JSON.stringify(flatten(value.json, separator, arrays === 'bracket'), null, 2),
        'application/json',
      ),
  }),
  implement(jsonPick, {
    value: (v): v is { kind: 'json'; json: unknown } | RecordsValue =>
      jsonInterpreter.isValue(v) || recordsInterpreter.isValue(v),
    run({ value }, { path, wrap }) {
      let parsed;
      try {
        parsed = parseJsonPath(path);
      } catch (err) {
        if (err instanceof JsonPathError)
          throw new Error(`Invalid path: ${err.message}`, { cause: err });
        throw err;
      }
      const matches = queryJsonPath(value.kind === 'json' ? value.json : value.rows, parsed);
      if (matches.length === 0) throw new Error(`Nothing matches ${path}`);
      const out = parsed.definite && !wrap ? matches[0] : matches;
      // A picked string is shown as JSON (quoted), so it stays a JSON value
      return textResult(JSON.stringify(out, null, 2), 'application/json');
    },
  }),
];

/**
 * Nested objects and arrays as one object of path → leaf value. Empty objects and arrays are
 * leaves, so the structure survives a round trip.
 */
export function flatten(
  root: unknown,
  separator: string,
  brackets: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const join = (path: string, key: string) => (path === '' ? key : `${path}${separator}${key}`);
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      if (node.length === 0 && path !== '') out[path] = [];
      node.forEach((child, i) => walk(child, brackets ? `${path}[${i}]` : join(path, String(i))));
    } else if (isRecord(node)) {
      const keys = Object.keys(node);
      if (keys.length === 0 && path !== '') out[path] = {};
      for (const k of keys) walk(node[k], join(path, k));
    } else {
      out[path] = node;
    }
  };
  walk(root, '');
  return out;
}
