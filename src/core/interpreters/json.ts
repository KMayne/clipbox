import { createMemo } from '../content';
import { formatCount, plural } from '../format';
import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { jsonChildCount, jsonChildren, jsonTypeOf } from '../jsonSlice';
import { jsonStats } from '../jsonStats';

type ParseResult = { ok: true; value: unknown } | { ok: false };

/** Shared with the records interpreter so JSON is only parsed once per entry. */
export const tryParseJson = createMemo((c): ParseResult => {
  const t = c.text?.trimStart();
  if (!t || !/^[[{"\d-]|^(true|false|null)\b/.test(t)) return { ok: false };
  try {
    const value: unknown = JSON.parse(t);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
});

interface JsonValue {
  kind: 'json';
  json: unknown;
  bytes: number;
}

export const jsonInterpreter: Interpreter<JsonValue> = {
  kind: 'json',
  isValue: (v): v is JsonValue => hasKind(v, 'json'),
  detect(c) {
    const r = tryParseJson(c);
    if (!r.ok) return 0;
    const container = r.value !== null && typeof r.value === 'object';
    if (container) return 0.95;
    return /json/.test(c.mime) ? 0.6 : 0;
  },
  parse(c) {
    const r = tryParseJson(c);
    if (!r.ok) throw new Error('Not valid JSON');
    return { kind: 'json', json: r.value, bytes: c.size };
  },
  label({ json }) {
    const type = jsonTypeOf(json);
    if (type === 'array') return `JSON array · ${formatCount(jsonChildCount(json))}`;
    if (type === 'object') return `JSON object · ${plural(jsonChildCount(json), 'key')}`;
    return `JSON ${type}`;
  },
  summarise: ({ json, bytes }) => ({ ...jsonStats(json, bytes), extent: jsonChildCount(json) }),
  slice({ json }, req) {
    if (req.type === 'children') return jsonChildren(json, req.path, req.from, req.to);
    if (req.type === 'json') return json;
    return unsupportedSlice('json', req);
  },
  export: ({ json }) => ({ text: JSON.stringify(json, null, 2) }),
};
