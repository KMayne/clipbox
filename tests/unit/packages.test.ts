import { createHash, generateKeyPairSync } from 'node:crypto';
import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeProtoXml, signingBlockIds } from '../../src/core/archive/packages/apk';
import { crxExtensionId, idFromBytes, parseCrxHeader } from '../../src/core/archive/packages/crx';
import { packageCard } from '../../src/core/archive/packages/describe';
import { classMajor, javaVersion, parseManifestMf } from '../../src/core/archive/packages/jar';
import type { PackageInfo } from '../../src/core/archive/packages/types';
import { packageCardSchema } from '../../src/core/archive/packages/types';
import type { ArchiveValue } from '../../src/core/archive/types';
import { zipCentralDirectoryOffset } from '../../src/core/archive/zip';
import { makeContent } from '../../src/core/content';
import { archiveCoreInterpreter as archive } from '../../src/core/interpreters/archive';
import { noTask } from '../../src/core/progress';
import { Engine } from '../../src/engine/engine';
import {
  concatBytes,
  crx2,
  crx3,
  npmTgz,
  pbBytes,
  pbString,
  pbVarint,
  sampleAndroidManifest,
  zipOf,
} from '../fixtures/packages';

const ctx = { service: async () => null };
const td = new TextDecoder();

async function parse(bytes: Uint8Array<ArrayBuffer>, name?: string): Promise<ArchiveValue> {
  return archive.parse(makeContent('application/octet-stream', bytes, name), ctx);
}

type PackageOf<T extends PackageInfo['type']> = Extract<PackageInfo, { type: T }>;

const isType = <T extends PackageInfo['type']>(
  p: PackageInfo | undefined,
  type: T,
): p is PackageOf<T> => p?.type === type;

/** The package of `v`, narrowed to `type`. */
function pkg<T extends PackageInfo['type']>(v: ArchiveValue, type: T): PackageOf<T> {
  const p = v.package;
  if (!isType(p, type)) throw new Error(`Expected a ${type} package, got ${p?.type}`);
  return p;
}

/** A class file header with the given major version. */
const classFile = (major: number) =>
  new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0, 0, major >> 8, major & 0xff, 0, 0]);

describe('jar', () => {
  it('parses MANIFEST.MF with continuation lines, stopping at the first blank line', () => {
    const mf = parseManifestMf(
      'Manifest-Version: 1.0\r\nMain-Class: com.example.very.long.package.na\r\n me.Main\r\nCreated-By: 17 (Oracle)\r\n\r\nName: a/B.class\r\nSHA-256-Digest: xyz\r\n',
    );
    expect(mf).toEqual({
      'Manifest-Version': '1.0',
      'Main-Class': 'com.example.very.long.package.name.Main',
      'Created-By': '17 (Oracle)',
    });
  });

  it('maps class-file majors to Java versions', () => {
    expect(classMajor(classFile(61))).toBe(61);
    expect(classMajor(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(javaVersion(52)).toBe('Java 8');
    expect(javaVersion(61)).toBe('Java 17');
    expect(javaVersion(48)).toBe('Java 1.4');
  });

  it('labels a jar with its class count and Java target, ignoring versioned classes', async () => {
    const jar = zipOf({
      'META-INF/MANIFEST.MF':
        'Manifest-Version: 1.0\nMain-Class: app.Main\nImplementation-Title: Demo\nImplementation-Version: 2.1\nMulti-Release: true\n\n',
      'META-INF/DEMO.SF': 'Signature-Version: 1.0\n',
      'app/Main.class': classFile(61),
      'app/Util.class': classFile(52),
      'META-INF/versions/21/app/Util.class': classFile(65),
    });
    const v = await parse(jar, 'demo.jar');
    expect(archive.label(v)).toBe('Java archive · 3 classes · Java 17');
    const j = pkg(v, 'jar');
    expect(j).toMatchObject({ variant: 'jar', maxMajor: 61, multiRelease: true, signed: true });
    const card = packageCard(j);
    expect(card).toMatchObject({ title: 'Java archive', name: 'Demo', version: '2.1' });
    expect(card.fields).toContainEqual({ label: 'Main-Class', value: 'app.Main' });
    expect(packageCardSchema.parse(await archive.slice(v, { type: 'json' }))).toEqual(card);
    const stats = (await archive.summarise(v)).stats;
    expect(stats[0]).toEqual({ label: 'Package', value: 'Java archive' });
    expect(stats).toContainEqual({ label: 'Main-Class', value: 'app.Main' });
  });

  it('calls a jar with WEB-INF/web.xml a web archive', async () => {
    const v = await parse(zipOf({ 'WEB-INF/web.xml': '<web-app/>', 'META-INF/MANIFEST.MF': '' }));
    expect(archive.label(v)).toBe('Web archive · 0 classes');
  });
});

describe('browser extensions', () => {
  const manifest = {
    manifest_version: 3,
    name: '__MSG_appName__',
    description: '__MSG_appDesc__',
    version: '1.4.0',
    default_locale: 'en',
    permissions: ['storage', 'cookies', 'debugger'],
    host_permissions: ['<all_urls>'],
    content_scripts: [{ matches: ['https://example.com/*'], js: ['cs.js'] }],
    background: { service_worker: 'bg.js' },
  };
  const files = {
    'manifest.json': JSON.stringify(manifest),
    '_locales/en/messages.json': JSON.stringify({
      appname: { message: 'Tab Tamer' },
      appDesc: { message: 'Tames tabs' },
    }),
    'bg.js': '',
  };

  it('maps the SHA-256 prefix to a–p', () => {
    expect(idFromBytes(new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]))).toBe(
      'abcdefghijklmnop',
    );
  });

  it('reads a CRX3: strips the header, resolves __MSG__ names and computes the ID', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const der = new Uint8Array(publicKey.export({ type: 'spki', format: 'der' }));
    const digest = createHash('sha256').update(der).digest();
    const expected = idFromBytes(digest);
    const bytes = crx3(zipOf(files), der, digest.subarray(0, 16));

    const header = parseCrxHeader(bytes);
    if (!header) throw new Error('No CRX header');
    expect(header).toMatchObject({ version: 3, publicKeys: [der] });
    expect(await crxExtensionId(header)).toEqual({ id: expected, verified: true });
    expect(archive.detect(makeContent('application/x-chrome-extension', bytes))).toBe(0.8);

    const v = await parse(bytes, 'tamer.crx');
    expect(v.format).toBe('crx');
    expect(archive.label(v)).toBe('Chrome extension · MV3 · 4 permissions');
    const e = pkg(v, 'extension');
    expect(e).toMatchObject({
      browser: 'chrome',
      crx: 3,
      id: expected,
      name: 'Tab Tamer',
      description: 'Tames tabs',
      hostPermissions: ['<all_urls>'],
      contentScriptMatches: ['https://example.com/*'],
      background: 'service worker: bg.js',
    });
    const card = packageCard(e);
    const perms = card.lists.find(l => l.title === 'Permissions')?.items ?? [];
    expect(perms.filter(p => p.flag).map(p => p.text)).toEqual(['cookies', 'debugger']);
    expect(card.warnings).toEqual(['Requests cookies', 'Requests debugger', 'Requests <all_urls>']);
    // Entries extract from the zip behind the header
    expect(td.decode((await archive.derive?.(v, 'manifest.json', noTask()))?.bytes)).toBe(
      files['manifest.json'],
    );
  });

  it('reads a CRX2 and derives the ID from its key', async () => {
    const key = strToU8('not really a key, but hashed all the same');
    const bytes = crx2(zipOf(files), key);
    const v = await parse(bytes);
    const digest = createHash('sha256').update(key).digest();
    expect(pkg(v, 'extension')).toMatchObject({ crx: 2, id: idFromBytes(digest) });
  });

  it('recognises an MV2 Firefox add-on in a plain zip', async () => {
    const v = await parse(
      zipOf({
        'manifest.json': JSON.stringify({
          manifest_version: 2,
          name: 'Fox',
          version: '1',
          permissions: ['tabs', 'https://*/*', '*://*/*'],
          browser_specific_settings: { gecko: { id: 'fox@example.com' } },
        }),
      }),
      'fox.xpi',
    );
    expect(archive.label(v)).toBe('Firefox add-on · MV2 · 3 permissions');
    expect(pkg(v, 'extension')).toMatchObject({
      permissions: ['tabs'],
      hostPermissions: ['https://*/*', '*://*/*'],
      geckoId: 'fox@example.com',
    });
  });

  it('keeps a plain zip listing when manifest.json is broken', async () => {
    const v = await parse(zipOf({ 'manifest.json': '{ nope', 'a.txt': 'a' }));
    expect(v.package).toBeUndefined();
    expect(archive.label(v)).toBe('ZIP · 2 files · 7 B');
  });
});

describe('apk and aab', () => {
  it('reads the binary manifest and v1 signing', async () => {
    const v = await parse(
      zipOf({
        'AndroidManifest.xml': sampleAndroidManifest(),
        'classes.dex': new Uint8Array(8),
        'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n',
        'META-INF/CERT.RSA': new Uint8Array(4),
      }),
    );
    expect(archive.label(v)).toBe('Android app · com.example.app · 1.2.3');
    expect(pkg(v, 'apk')).toMatchObject({
      variant: 'apk',
      package: 'com.example.app',
      versionCode: '42',
      minSdk: '24',
      targetSdk: '34',
      label: '@0x7f0a0001',
      permissions: ['android.permission.CAMERA', 'android.permission.INTERNET'],
      activities: 2,
      services: 1,
      signing: ['v1'],
      note: null,
    });
  });

  it('finds v2 and v3 blocks in the APK Signing Block', async () => {
    const zip = zipOf({ 'AndroidManifest.xml': sampleAndroidManifest(), 'classes.dex': '' });
    const cd = zipCentralDirectoryOffset(zip) ?? 0;
    // Block: size, pairs (length, id, value), size, magic
    const pair = (id: number) => {
      const b = new Uint8Array(8 + 4 + 4);
      const dv = new DataView(b.buffer);
      dv.setBigUint64(0, 8n, true);
      dv.setUint32(8, id, true);
      return b;
    };
    const pairs = concatBytes([pair(0x7109871a), pair(0xf05368c0)]);
    const size = BigInt(pairs.length + 8 + 16);
    const sizeBytes = new Uint8Array(8);
    new DataView(sizeBytes.buffer).setBigUint64(0, size, true);
    const block = concatBytes([sizeBytes, pairs, sizeBytes, strToU8('APK Sig Block 42')]);
    const apk = concatBytes([zip.subarray(0, cd), block, zip.subarray(cd)]);
    const dv = new DataView(apk.buffer);
    const eocd = apk.length - 22;
    dv.setUint32(eocd + 16, cd + block.length, true);

    expect(signingBlockIds(apk)).toEqual([0x7109871a, 0xf05368c0]);
    const v = await parse(apk);
    expect(pkg(v, 'apk').signing).toEqual(['v2', 'v3']);
    expect(packageCard(pkg(v, 'apk')).badges.map(b => b.text)).toEqual(['signed v2', 'signed v3']);
  });

  it('keeps listing when the binary manifest is corrupt', async () => {
    const v = await parse(
      zipOf({
        'AndroidManifest.xml': new Uint8Array([3, 0, 8, 0, 255, 255, 0, 0]),
        'classes.dex': '',
      }),
    );
    const a = pkg(v, 'apk');
    expect(a.package).toBeNull();
    expect(a.note).toMatch(/couldn't be decoded/);
    expect(v.entries).toHaveLength(2);
  });

  it('decodes an app bundle manifest from protobuf', async () => {
    const attr = (name: string, value: string, android = true) =>
      pbBytes(
        4,
        concatBytes([
          ...(android ? [pbString(1, 'http://schemas.android.com/apk/res/android')] : []),
          pbString(2, name),
          pbString(3, value),
        ]),
      );
    const compiledInt = (name: string, n: number) =>
      pbBytes(
        4,
        concatBytes([
          pbString(1, 'http://schemas.android.com/apk/res/android'),
          pbString(2, name),
          pbBytes(6, pbBytes(7, pbVarint(6, n))),
        ]),
      );
    const element = (name: string, parts: Uint8Array[]) =>
      pbBytes(1, concatBytes([pbString(3, name), ...parts]));
    const child = (node: Uint8Array) => pbBytes(5, node);
    const manifest = element('manifest', [
      attr('package', 'com.example.bundle', false),
      attr('versionName', '3.0'),
      compiledInt('versionCode', 300),
      child(element('uses-sdk', [attr('minSdkVersion', '26')])),
      child(element('uses-permission', [attr('name', 'android.permission.INTERNET')])),
      child(element('application', [child(element('activity', [attr('name', '.A')]))])),
    ]);
    expect(decodeProtoXml(manifest)).toMatchObject({
      name: 'manifest',
      attrs: { package: 'com.example.bundle', 'android:versionCode': '300' },
    });
    const v = await parse(
      zipOf({
        'BundleConfig.pb': '',
        'base/manifest/AndroidManifest.xml': manifest,
        'feature/manifest/AndroidManifest.xml': manifest,
      }),
    );
    expect(archive.label(v)).toBe('Android app bundle · com.example.bundle · 3.0');
    expect(pkg(v, 'apk')).toMatchObject({
      variant: 'aab',
      versionCode: '300',
      minSdk: '26',
      permissions: ['android.permission.INTERNET'],
      activities: 1,
      modules: ['base', 'feature'],
    });
  });
});

describe('other packages', () => {
  it('reads a wheel', async () => {
    const v = await parse(
      zipOf({
        'demo/__init__.py': '',
        'demo-1.0.dist-info/METADATA':
          'Metadata-Version: 2.1\nName: demo\nVersion: 1.0\nSummary: A demo\nRequires-Python: >=3.9\nRequires-Dist: requests>=2\nRequires-Dist: rich; extra == "cli"\n\nLong description\nName: not-a-header\n',
        'demo-1.0.dist-info/WHEEL':
          'Wheel-Version: 1.0\nGenerator: bdist_wheel (0.41)\nRoot-Is-Purelib: true\nTag: py3-none-any\n',
      }),
    );
    expect(archive.label(v)).toBe('Python wheel · demo 1.0 · py3-none-any');
    expect(pkg(v, 'wheel')).toMatchObject({
      requiresPython: '>=3.9',
      requires: ['requests>=2', 'rich; extra == "cli"'],
      pureLib: true,
    });
  });

  it('reads a nupkg', async () => {
    const nuspec = `<?xml version="1.0"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>Demo.Lib</id><version>2.0.1</version><authors>Ada</authors>
    <description>Does things</description>
    <license type="expression">MIT</license>
    <dependencies>
      <group targetFramework="net6.0"><dependency id="Newtonsoft.Json" version="13.0.1" /></group>
    </dependencies>
  </metadata>
</package>`;
    const v = await parse(
      zipOf({ 'Demo.Lib.nuspec': nuspec, 'lib/netstandard2.0/Demo.Lib.dll': 'MZ' }),
    );
    expect(archive.label(v)).toBe('NuGet package · Demo.Lib 2.0.1');
    expect(pkg(v, 'nupkg')).toMatchObject({
      authors: 'Ada',
      license: 'MIT',
      dependencies: ['Newtonsoft.Json 13.0.1 (net6.0)'],
      frameworks: ['net6.0', 'netstandard2.0'],
    });
  });

  it('reads a VS Code vsix', async () => {
    const v = await parse(
      zipOf({
        'extension.vsixmanifest':
          '<PackageManifest><Metadata><Identity Id="demo" Version="0.1.0" Publisher="acme"/></Metadata></PackageManifest>',
        'extension/package.json': JSON.stringify({
          name: 'demo',
          publisher: 'acme',
          version: '0.1.0',
          engines: { vscode: '^1.80.0' },
          activationEvents: ['*'],
          contributes: { commands: [{}, {}], configuration: { a: 1 } },
          main: './out/ext.js',
        }),
      }),
    );
    expect(archive.label(v)).toBe('VS Code extension · acme.demo · 0.1.0');
    const x = pkg(v, 'vsix');
    expect(x).toMatchObject({
      engines: ['vscode ^1.80.0'],
      contributes: ['commands: 2', 'configuration: 1'],
    });
    expect(packageCard(x).warnings).toEqual(['Activates on every startup']);
  });

  it('reads an npm tarball and flags install scripts', async () => {
    const v = await parse(
      npmTgz({
        name: 'left-pad',
        version: '1.3.0',
        bin: 'cli.js',
        dependencies: { a: '^1' },
        scripts: { test: 'node t', postinstall: 'node steal.js' },
      }),
      'left-pad-1.3.0.tgz',
    );
    expect(v.format).toBe('tar.gz');
    expect(archive.label(v)).toBe('npm package · left-pad 1.3.0 · install scripts');
    const card = packageCard(pkg(v, 'npm'));
    expect(card.scripts).toEqual([
      { name: 'test', body: 'node t' },
      { name: 'postinstall', body: 'node steal.js', flag: 'Runs after the package installs' },
    ]);
    expect(card.warnings).toEqual(['Runs a postinstall script']);
  });

  it('reads an EPUB with NCX chapter titles', async () => {
    const opf = `<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Book</dc:title><dc:creator>Ada</dc:creator><dc:creator>Bob</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/two%20b.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;
    const ncx = `<ncx><navMap>
  <navPoint><navLabel><text>Chapter One</text></navLabel><content src="text/one.xhtml#top"/>
    <navPoint><navLabel><text>Nested</text></navLabel><content src="text/two%20b.xhtml"/></navPoint>
  </navPoint>
</navMap></ncx>`;
    const v = await parse(
      zipOf({
        mimetype: 'application/epub+zip',
        'META-INF/container.xml':
          '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
        'OEBPS/content.opf': opf,
        'OEBPS/toc.ncx': ncx,
        'OEBPS/text/one.xhtml': '<html/>',
        'OEBPS/text/two b.xhtml': '<html/>',
      }),
    );
    expect(archive.label(v)).toBe('EPUB · The Book · 2 chapters');
    expect(pkg(v, 'epub')).toMatchObject({
      authors: ['Ada', 'Bob'],
      language: 'en',
      version: '2.0',
      chapters: [
        { href: 'OEBPS/text/one.xhtml', title: 'Chapter One' },
        { href: 'OEBPS/text/two b.xhtml', title: 'Nested' },
      ],
    });
  });
});

describe('package actions', () => {
  async function engineWith(bytes: Uint8Array<ArrayBuffer>, name: string) {
    const e = new Engine({ loaders: {} });
    const blob = new Blob([bytes]);
    await e.ingest({ id: 'en-1', mime: 'application/octet-stream', size: blob.size, blob, name });
    return e;
  }

  it('writes the manifest as JSON and class versions as CSV', async () => {
    const jar = zipOf({
      'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n',
      'a/A.class': classFile(55),
      'META-INF/versions/17/a/A.class': classFile(61),
      'a/Broken.class': 'nope',
    });
    const e = await engineWith(jar, 'lib.jar');
    expect(await e.actions('en-1', 'archive')).toEqual(
      expect.arrayContaining(['archive.manifest', 'archive.classVersions']),
    );
    expect(await e.actions('en-1', 'archive')).not.toContain('archive.scriptlets');
    const [manifest] = await e.runAction('en-1', 'archive', 'archive.manifest', {});
    expect(manifest).toMatchObject({ name: 'lib-manifest.json', mime: 'application/json' });
    expect(JSON.parse(td.decode(manifest?.bytes))).toMatchObject({ type: 'jar', maxMajor: 55 });
    const [csv] = await e.runAction('en-1', 'archive', 'archive.classVersions', {});
    expect(csv?.name).toBe('lib-class-versions.csv');
    expect(td.decode(csv?.bytes)).toBe(
      'class,major,minor,java,release\r\n' +
        'a/A.class,55,0,11,\r\n' +
        'META-INF/versions/17/a/A.class,61,0,17,17\r\n' +
        'a/Broken.class,,,not a class file,\r\n',
    );
  });

  it('offers no package actions on a plain zip', async () => {
    const e = await engineWith(zipOf({ 'a.txt': 'a' }), 'a.zip');
    const ids = await e.actions('en-1', 'archive');
    expect(ids).not.toContain('archive.manifest');
  });
});
