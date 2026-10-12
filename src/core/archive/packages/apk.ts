/** Android packages: APKs (binary XML manifest) and app bundles (protobuf manifest). */

import type { XmlNode } from '../../presentation/ooxml';
import type { ArchiveValue } from '../types';
import { zipCentralDirectoryOffset } from '../zip';
import { decodeAxml } from './axml';
import { bytesFields, protoFields, stringField, varintField, type ProtoField } from './protobuf';
import type { EntryReader } from './reader';
import type { ApkInfo } from './types';

const APK_MANIFEST = 'AndroidManifest.xml';
const AAB_MANIFEST = 'base/manifest/AndroidManifest.xml';
const SIG_BLOCK_MAGIC = 'APK Sig Block 42';
const SCHEMES: [number, string][] = [
  [0x7109871a, 'v2'],
  [0xf05368c0, 'v3'],
  [0x1b93ad61, 'v3.1'],
];
const MAX_NODES = 200_000;

/** IDs of the pairs in the APK Signing Block right before the central directory. */
export function signingBlockIds(b: Uint8Array): number[] {
  const cd = zipCentralDirectoryOffset(b);
  if (cd === null || cd < 32 || cd > b.length) return [];
  const magic = new TextDecoder('latin1').decode(b.subarray(cd - 16, cd));
  if (magic !== SIG_BLOCK_MAGIC) return [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const size = Number(dv.getBigUint64(cd - 24, true));
  const start = cd - size - 8;
  if (start < 0 || size < 24) return [];
  const ids: number[] = [];
  // Pairs: uint64 length, then uint32 id and (length - 4) bytes of value
  for (let at = start + 8; at + 12 <= cd - 24;) {
    const len = Number(dv.getBigUint64(at, true));
    if (len < 4 || at + 8 + len > cd - 24) break;
    ids.push(dv.getUint32(at + 8, true));
    at += 8 + len;
  }
  return ids;
}

function signingSchemes(r: EntryReader, b: Uint8Array | null): string[] {
  const out: string[] = [];
  if (r.files.some(p => /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(p))) out.push('v1');
  if (b) {
    const ids = signingBlockIds(b);
    for (const [id, name] of SCHEMES) if (ids.includes(id)) out.push(name);
  }
  return out;
}

/**
 * aapt2's protobuf XmlNode (Resources.proto): XmlNode { element = 1, text = 2 };
 * XmlElement { namespace_uri = 2, name = 3, attribute = 4, child = 5 };
 * XmlAttribute { namespace_uri = 1, name = 2, value = 3, resource_id = 5, compiled_item = 6 }.
 * Walked with an explicit stack, children appended in order.
 */
export function decodeProtoXml(bytes: Uint8Array<ArrayBuffer>): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [] };
  const stack: { node: Uint8Array<ArrayBuffer>; parent: XmlNode }[] = [
    { node: bytes, parent: root },
  ];
  let count = 0;
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    if (++count > MAX_NODES) throw new Error('Too many nodes in the manifest');
    const fields = protoFields(item.node);
    const element = bytesFields(fields, 1).at(-1);
    if (!element) continue;
    const ef = protoFields(element);
    const attrs: Record<string, string> = {};
    for (const a of bytesFields(ef, 4)) {
      const af = protoFields(a);
      const ns = stringField(af, 1) ?? '';
      const name = stringField(af, 2) ?? '';
      attrs[ns.endsWith('/android') ? `android:${name}` : name] =
        stringField(af, 3) || compiledValue(af);
    }
    const node: XmlNode = { name: stringField(ef, 3) ?? '', attrs, children: [] };
    item.parent.children.push(node);
    // Reverse so pops come out in document order
    const children = bytesFields(ef, 5);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push({ node: child, parent: node });
    }
  }
  const first = root.children[0];
  if (!first) throw new Error('Manifest has no elements');
  return first;
}

/** compiled_item → prim (7): int_decimal_value = 6, int_hexadecimal_value = 7, boolean_value = 8. */
function compiledValue(af: ProtoField[]): string {
  const item = bytesFields(af, 6).at(-1);
  if (!item) return '';
  const prim = bytesFields(protoFields(item), 7).at(-1);
  if (!prim) return '';
  const pf = protoFields(prim);
  const dec = varintField(pf, 6);
  if (dec !== null) return String(dec > 0x7fffffff ? dec - 2 ** 32 : dec);
  const hex = varintField(pf, 7);
  if (hex !== null) return `0x${hex.toString(16)}`;
  const bool = varintField(pf, 8);
  return bool === null ? '' : bool !== 0 ? 'true' : 'false';
}

const attr = (n: XmlNode | undefined, name: string) => n?.attrs[`android:${name}`] ?? null;

/** Fills the manifest fields of an ApkInfo from its <manifest> root. */
function manifestFields(m: XmlNode) {
  const sdk = m.children.find(c => c.name === 'uses-sdk');
  const app = m.children.find(c => c.name === 'application');
  const count = (name: string) => app?.children.filter(c => c.name === name).length ?? 0;
  const permissions = m.children
    .filter(c => c.name === 'uses-permission' || c.name === 'uses-permission-sdk-23')
    .map(c => attr(c, 'name'))
    .filter((p): p is string => p !== null && p !== '');
  return {
    package: m.attrs.package ?? null,
    versionName: attr(m, 'versionName'),
    versionCode: attr(m, 'versionCode'),
    minSdk: attr(sdk, 'minSdkVersion'),
    targetSdk: attr(sdk, 'targetSdkVersion'),
    label: attr(app, 'label'),
    permissions,
    activities: count('activity') + count('activity-alias'),
    services: count('service'),
    receivers: count('receiver'),
    providers: count('provider'),
  };
}

const EMPTY_MANIFEST: ReturnType<typeof manifestFields> = {
  package: null,
  versionName: null,
  versionCode: null,
  minSdk: null,
  targetSdk: null,
  label: null,
  permissions: [],
  activities: 0,
  services: 0,
  receivers: 0,
  providers: 0,
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function recogniseApk(r: EntryReader, v: ArchiveValue): ApkInfo | null {
  const zipBytes = v.source.type === 'zip' ? v.source.bytes : null;
  if (r.has(APK_MANIFEST) && (r.has('classes.dex') || r.has('resources.arsc'))) {
    const raw = r.bytes(APK_MANIFEST);
    let fields = EMPTY_MANIFEST;
    let note: string | null = null;
    try {
      if (!raw) throw new Error('unreadable');
      fields = manifestFields(decodeAxml(raw));
    } catch (err) {
      note = `AndroidManifest.xml couldn't be decoded (${message(err)})`;
    }
    return {
      type: 'apk',
      variant: 'apk',
      ...fields,
      signing: signingSchemes(r, zipBytes),
      modules: [],
      note,
    };
  }
  if (r.has(AAB_MANIFEST) && r.has('BundleConfig.pb')) {
    const raw = r.bytes(AAB_MANIFEST);
    let fields = EMPTY_MANIFEST;
    let note: string | null = null;
    try {
      if (!raw) throw new Error('unreadable');
      fields = manifestFields(decodeProtoXml(raw));
    } catch (err) {
      note = `The base module's manifest couldn't be decoded (${message(err)})`;
    }
    const modules = r.files
      .filter(p => /^[^/]+\/manifest\/AndroidManifest\.xml$/.test(p))
      .map(p => p.slice(0, p.indexOf('/')));
    return {
      type: 'apk',
      variant: 'aab',
      ...fields,
      signing: signingSchemes(r, null),
      modules,
      note,
    };
  }
  return null;
}
