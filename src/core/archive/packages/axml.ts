/**
 * Android binary XML (AXML), as in an APK's AndroidManifest.xml: a string pool, a resource-ID map
 * and start/end element chunks. Decoded into an element tree with an explicit stack; every read
 * is bounds-checked, and a malformed file throws.
 */

import type { XmlNode } from '../../presentation/ooxml';

const RES_XML = 0x0003;
const STRING_POOL = 0x0001;
const RESOURCE_MAP = 0x0180;
const START_ELEMENT = 0x0102;
const END_ELEMENT = 0x0103;
const UTF8_FLAG = 0x100;
const NO_INDEX = 0xffffffff;

const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
/** Most elements one manifest may have; real ones have hundreds. */
const MAX_ELEMENTS = 200_000;

/** android: attributes by resource ID, for manifests whose attribute names were stripped. */
const ANDROID_ATTRS: Record<number, string> = {
  0x01010003: 'name',
  0x01010001: 'label',
  0x01010002: 'icon',
  0x0101020c: 'minSdkVersion',
  0x01010270: 'targetSdkVersion',
  0x01010271: 'maxSdkVersion',
  0x0101021b: 'versionCode',
  0x0101021c: 'versionName',
  0x01010010: 'exported',
  0x0101000e: 'enabled',
  0x01010006: 'permission',
};

// Res_value data types
const TYPE_NULL = 0x00;
const TYPE_REFERENCE = 0x01;
const TYPE_ATTRIBUTE = 0x02;
const TYPE_STRING = 0x03;
const TYPE_FLOAT = 0x04;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;
const TYPE_FIRST_COLOR = 0x1c;
const TYPE_LAST_COLOR = 0x1f;

class Reader {
  readonly dv: DataView;
  constructor(readonly b: Uint8Array) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  check(at: number, len: number) {
    if (at < 0 || at + len > this.b.length) throw new Error('Truncated binary XML');
  }
  u8(at: number) {
    this.check(at, 1);
    return this.dv.getUint8(at);
  }
  u16(at: number) {
    this.check(at, 2);
    return this.dv.getUint16(at, true);
  }
  u32(at: number) {
    this.check(at, 4);
    return this.dv.getUint32(at, true);
  }
}

const utf8 = new TextDecoder('utf-8');
const utf16 = new TextDecoder('utf-16le');

/** The strings of a pool chunk starting at `at`. */
function readStringPool(r: Reader, at: number, size: number): string[] {
  const headerSize = r.u16(at + 2);
  const count = r.u32(at + 8);
  const flags = r.u32(at + 16);
  const stringsStart = r.u32(at + 20);
  if (count * 4 > size) throw new Error('Bad string pool');
  const isUtf8 = (flags & UTF8_FLAG) !== 0;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let p = at + stringsStart + r.u32(at + headerSize + i * 4);
    if (p >= at + size) {
      out.push('');
      continue;
    }
    if (isUtf8) {
      // UTF-16 length then UTF-8 byte length, each 1 or 2 bytes (high bit = two bytes)
      p += r.u8(p) & 0x80 ? 2 : 1;
      let len = r.u8(p);
      if (len & 0x80) {
        len = ((len & 0x7f) << 8) | r.u8(p + 1);
        p += 2;
      } else p += 1;
      r.check(p, len);
      out.push(utf8.decode(r.b.subarray(p, p + len)));
    } else {
      let len = r.u16(p);
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | r.u16(p + 2);
        p += 4;
      } else p += 2;
      r.check(p, len * 2);
      out.push(utf16.decode(r.b.subarray(p, p + len * 2)));
    }
  }
  return out;
}

const hex = (n: number) => `0x${n.toString(16).padStart(8, '0')}`;

/** A typed attribute value as text, the way aapt dump shows it. */
function typedValue(type: number, data: number, strings: string[]): string {
  switch (type) {
    case TYPE_NULL:
      return '';
    case TYPE_REFERENCE:
      return `@${hex(data)}`;
    case TYPE_ATTRIBUTE:
      return `?${hex(data)}`;
    case TYPE_STRING:
      return strings[data] ?? '';
    case TYPE_FLOAT: {
      const dv = new DataView(new ArrayBuffer(4));
      dv.setUint32(0, data);
      return String(dv.getFloat32(0));
    }
    case TYPE_INT_DEC:
      return String(data | 0);
    case TYPE_INT_HEX:
      return hex(data);
    case TYPE_INT_BOOLEAN:
      return data !== 0 ? 'true' : 'false';
    default:
      if (type >= TYPE_FIRST_COLOR && type <= TYPE_LAST_COLOR) return `#${data.toString(16)}`;
      return hex(data);
  }
}

/**
 * Decodes the document into its root element. Attributes in the android namespace are keyed
 * "android:<name>"; others by their plain name.
 */
export function decodeAxml(bytes: Uint8Array): XmlNode {
  const r = new Reader(bytes);
  if (r.u16(0) !== RES_XML) throw new Error('Not Android binary XML');
  const end = Math.min(bytes.length, r.u32(4));
  let strings: string[] = [];
  let resourceIds: number[] = [];
  const root: XmlNode = { name: '#document', attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  let elements = 0;

  const str = (i: number) => (i === NO_INDEX ? '' : (strings[i] ?? ''));

  for (let at = r.u16(2); at + 8 <= end;) {
    const type = r.u16(at);
    const headerSize = r.u16(at + 2);
    const size = r.u32(at + 4);
    if (size < 8 || at + size > end) throw new Error('Bad binary XML chunk');

    if (type === STRING_POOL) {
      strings = readStringPool(r, at, size);
    } else if (type === RESOURCE_MAP) {
      resourceIds = [];
      for (let p = at + headerSize; p + 4 <= at + size; p += 4) resourceIds.push(r.u32(p));
    } else if (type === START_ELEMENT) {
      if (++elements > MAX_ELEMENTS) throw new Error('Too many elements in binary XML');
      const ext = at + headerSize;
      const name = str(r.u32(ext + 4));
      const attrStart = r.u16(ext + 8);
      const attrSize = r.u16(ext + 10);
      const attrCount = r.u16(ext + 12);
      const attrs: Record<string, string> = {};
      for (let i = 0; i < attrCount; i++) {
        const a = ext + attrStart + i * attrSize;
        const ns = str(r.u32(a));
        const nameIndex = r.u32(a + 4);
        const raw = r.u32(a + 8);
        const dataType = r.u8(a + 15);
        const data = r.u32(a + 16);
        const id = resourceIds[nameIndex];
        let attrName = str(nameIndex);
        if (attrName === '' && id !== undefined) attrName = ANDROID_ATTRS[id] ?? hex(id);
        const key =
          ns === ANDROID_NS || (ns === '' && id !== undefined && id >>> 24 === 1)
            ? `android:${attrName}`
            : attrName;
        attrs[key] = raw !== NO_INDEX ? str(raw) : typedValue(dataType, data, strings);
      }
      const node: XmlNode = { name, attrs, children: [] };
      stack.at(-1)?.children.push(node);
      stack.push(node);
    } else if (type === END_ELEMENT) {
      if (stack.length > 1) stack.pop();
    }
    at += size;
  }
  const first = root.children[0];
  if (!first) throw new Error('Binary XML has no elements');
  return first;
}
