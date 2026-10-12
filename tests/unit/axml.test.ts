import { describe, expect, it } from 'vitest';
import { decodeAxml } from '../../src/core/archive/packages/axml';
import { protoFields } from '../../src/core/archive/packages/protobuf';
import { axml, sampleAndroidManifest } from '../fixtures/packages';

describe('android binary XML', () => {
  for (const utf8 of [false, true]) {
    it(`decodes elements, typed attributes and nesting (${utf8 ? 'UTF-8' : 'UTF-16'} pool)`, () => {
      const root = decodeAxml(sampleAndroidManifest(utf8));
      expect(root.name).toBe('manifest');
      expect(root.attrs).toEqual({
        'android:versionCode': '42',
        'android:versionName': '1.2.3',
        package: 'com.example.app',
      });
      expect(root.children.map(c => c.name)).toEqual([
        'uses-sdk',
        'uses-permission',
        'uses-permission',
        'application',
      ]);
      const app = root.children[3];
      expect(app?.attrs).toEqual({ 'android:label': '@0x7f0a0001', 'android:debuggable': 'true' });
      expect(app?.children.map(c => c.attrs['android:name'])).toEqual(['.Main', '.Two', '.Sync']);
    });
  }

  it('names stripped attributes from the resource map', () => {
    // An empty attribute name with android's versionCode resource ID
    const root = decodeAxml(
      axml([
        { start: 'manifest', attrs: [{ name: '', android: true, id: 0x0101021b, int: 7 }] },
        { end: 'manifest' },
      ]),
    );
    expect(root.attrs).toEqual({ 'android:versionCode': '7' });
  });

  it('throws on truncated or foreign input instead of reading out of bounds', () => {
    const good = sampleAndroidManifest();
    expect(() => decodeAxml(good.slice(0, 40))).toThrow();
    expect(() => decodeAxml(new Uint8Array([1, 2, 3, 4]))).toThrow();
    expect(() => decodeAxml(new TextEncoder().encode('<manifest/>'))).toThrow(/Not Android/);
    // A chunk claiming to run past the end
    const bad = good.slice();
    new DataView(bad.buffer).setUint32(12, 0x7fffffff, true);
    expect(() => decodeAxml(bad)).toThrow();
  });

  it('keeps sibling order with an explicit stack for deep nesting', () => {
    const depth = 20_000;
    const events = [
      ...Array.from({ length: depth }, () => ({ start: 'x' })),
      ...Array.from({ length: depth }, () => ({ end: 'x' })),
    ];
    let node = decodeAxml(axml(events));
    let levels = 1;
    while (node.children[0]) {
      node = node.children[0];
      levels++;
    }
    expect(levels).toBe(depth);
  });
});

describe('protobuf reader', () => {
  it('reads varints, fixed and length-delimited fields', () => {
    // field 1 varint 300, field 2 bytes "hi", field 3 fixed32
    const fields = protoFields(new Uint8Array([8, 0xac, 2, 18, 2, 104, 105, 29, 1, 0, 0, 0]));
    expect(fields.map(f => [f.field, f.wire])).toEqual([
      [1, 0],
      [2, 2],
      [3, 5],
    ]);
    expect(fields[0]?.value).toBe(300);
  });

  it('rejects truncated messages', () => {
    expect(() => protoFields(new Uint8Array([18, 5, 1]))).toThrow(/Truncated/);
    expect(() => protoFields(new Uint8Array([8, 0x80]))).toThrow(/Truncated/);
  });
});
