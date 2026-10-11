import { formatBytes } from '../format';
import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import type { MagicType } from '../magic';

interface BinaryValue {
  kind: 'binary';
  bytes: Uint8Array<ArrayBuffer>;
  magic: MagicType | null;
}

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ');

export const binaryInterpreter: Interpreter<BinaryValue> = {
  kind: 'binary',
  isValue: (v): v is BinaryValue => hasKind(v, 'binary'),
  detect: c => (c.text === null ? 0.2 : 0),
  parse: c => ({ kind: 'binary', bytes: c.bytes, magic: c.magic }),
  label: v => `Binary · ${formatBytes(v.bytes.byteLength)}`,
  summarise: v => ({
    stats: [
      { label: 'Bytes', value: formatBytes(v.bytes.byteLength) },
      { label: 'Detected type', value: v.magic ?? 'unknown' },
      { label: 'First 16 bytes', value: toHex(v.bytes.subarray(0, 16)) },
    ],
    extent: v.bytes.byteLength,
  }),
  slice(v, req) {
    if (req.type === 'bytes') return v.bytes.slice(req.from, req.to);
    return unsupportedSlice('binary', req);
  },
  export: () => ({}),
};
