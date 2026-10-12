/** A minimal protobuf wire-format reader: one message's fields, without a schema. */

export type ProtoField =
  | { field: number; wire: 0; value: number }
  | { field: number; wire: 1 | 5; value: Uint8Array<ArrayBuffer> }
  | { field: number; wire: 2; value: Uint8Array<ArrayBuffer> };

/** Reads a varint at `at`; values past 2^53 lose precision (we only need lengths and small ints). */
function varint(b: Uint8Array, at: number): { value: number; next: number } {
  let value = 0;
  let scale = 1;
  for (let i = at; i < b.length && i < at + 10; i++) {
    const byte = b[i] ?? 0;
    value += (byte & 0x7f) * scale;
    scale *= 128;
    if ((byte & 0x80) === 0) return { value, next: i + 1 };
  }
  throw new Error('Truncated protobuf varint');
}

/** The top-level fields of one message, in order; throws on malformed input. */
export function protoFields(b: Uint8Array<ArrayBuffer>): ProtoField[] {
  const out: ProtoField[] = [];
  let at = 0;
  while (at < b.length) {
    const key = varint(b, at);
    at = key.next;
    const field = Math.floor(key.value / 8);
    const wire = key.value % 8;
    if (field === 0) throw new Error('Bad protobuf field number');
    if (wire === 0) {
      const v = varint(b, at);
      out.push({ field, wire, value: v.value });
      at = v.next;
    } else if (wire === 1 || wire === 5) {
      const len = wire === 1 ? 8 : 4;
      if (at + len > b.length) throw new Error('Truncated protobuf field');
      out.push({ field, wire, value: b.subarray(at, at + len) });
      at += len;
    } else if (wire === 2) {
      const len = varint(b, at);
      at = len.next;
      if (at + len.value > b.length) throw new Error('Truncated protobuf field');
      out.push({ field, wire, value: b.subarray(at, at + len.value) });
      at += len.value;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
  }
  return out;
}

const utf8 = new TextDecoder();

/** Length-delimited fields numbered `field`. */
export const bytesFields = (fields: ProtoField[], field: number): Uint8Array<ArrayBuffer>[] =>
  fields.flatMap(f => (f.field === field && f.wire === 2 ? [f.value] : []));

/** The last length-delimited field numbered `field`, as UTF-8 (protobuf's last-wins rule). */
export function stringField(fields: ProtoField[], field: number): string | null {
  const b = bytesFields(fields, field).at(-1);
  return b ? utf8.decode(b) : null;
}

/** The last varint field numbered `field`. */
export function varintField(fields: ProtoField[], field: number): number | null {
  let out: number | null = null;
  for (const f of fields) if (f.field === field && f.wire === 0) out = f.value;
  return out;
}
