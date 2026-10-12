import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { CpioReader, listCpio } from '../../src/core/archive/cpio';
import { packageCard } from '../../src/core/archive/packages/describe';
import { nevra, parseRpm } from '../../src/core/archive/rpm';
import { rpmPayloadCompressor } from '../../src/core/archive/rpmHeader';
import type { ArchiveValue } from '../../src/core/archive/types';
import { makeContent } from '../../src/core/content';
import { archiveCoreInterpreter as archive } from '../../src/core/interpreters/archive';
import { noTask } from '../../src/core/progress';
import { Engine } from '../../src/engine/engine';
import { libarchiveDetector } from '../../src/modules/libarchive/detect';
import { createLibarchiveInterpreter } from '../../src/modules/libarchive/interpreter';
import { createLibarchive, type Libarchive } from '../../src/modules/libarchive/reader';
import { cpioOf, rpm, sampleRpm, sampleRpmFiles } from '../fixtures/packages';

const ctx = { service: async () => null };
const td = new TextDecoder();
const content = (b: Uint8Array<ArrayBuffer>, name = 'hello.rpm') =>
  makeContent('application/x-rpm', b, name);

describe('cpio', () => {
  it('lists newc entries and finds one fed in small chunks', () => {
    const cpio = cpioOf(sampleRpmFiles);
    expect(listCpio(cpio).map(e => e.name)).toEqual([
      './usr/share/hello',
      './usr/bin/hello',
      './usr/share/hello/README',
      './usr/bin/hi',
    ]);
    const r = new CpioReader('usr/share/hello/README');
    for (let i = 0; i < cpio.length && !r.done; i += 7) r.push(cpio.subarray(i, i + 7));
    expect(td.decode(r.found ?? new Uint8Array(0))).toBe('Hello from the RPM payload.\n');
  });

  it('rejects other cpio formats', () => {
    expect(() => listCpio(strToU8('070707'.padEnd(120, '0')))).toThrow(/Unsupported cpio/);
  });
});

describe('rpm headers', () => {
  it('reads metadata, dependencies, scriptlets and the file list', () => {
    const { info, entries, names, payloadOffset } = parseRpm(sampleRpm());
    expect(info).toMatchObject({
      name: 'hello',
      version: '1.0',
      release: '1.el9',
      arch: 'x86_64',
      summary: 'A friendly greeter',
      license: 'MIT',
      buildHost: 'builder.example.com',
      buildTime: '2023-11-14T22:13:20Z',
      payloadFormat: 'cpio',
      payloadCompressor: 'gzip',
      requires: ['/bin/sh', 'glibc >= 2.34', 'rpmlib(CompressedFileNames) <= 3.0.4-1'],
      provides: ['hello = 1.0-1.el9', 'hello(x86-64) = 1.0-1.el9'],
      skipped: { symlinks: 1, ghosts: 1, other: 0 },
    });
    expect(info.scripts).toEqual([
      { name: '%pre', program: '/bin/sh', body: 'getent group hello || groupadd hello' },
      { name: '%post', program: null, body: 'echo installed' },
      { name: '%postun', program: '/sbin/ldconfig', body: '' },
    ]);
    expect(nevra(info)).toBe('hello-1.0-1.el9.x86_64');
    expect(entries.map(e => e.path)).toEqual([
      'usr/share/hello/',
      'usr/bin/hello',
      'usr/share/hello/README',
    ]);
    expect(entries[1]).toMatchObject({ size: 21, isDir: false, modified: '2023-11-14T22:13:20Z' });
    expect(names).toEqual(['./usr/share/hello', './usr/bin/hello', './usr/share/hello/README']);
    expect(payloadOffset).toBeGreaterThan(96);
    const card = packageCard(info);
    expect(card.scripts.every(s => s.flag)).toBe(true);
    expect(card.warnings).toEqual(['Has 3 scriptlets']);
  });

  it('reads old-style OLDFILENAMES lists', () => {
    const { entries } = parseRpm(rpm({ files: sampleRpmFiles, oldFilenames: true }));
    expect(entries.map(e => e.path)).toContain('usr/share/hello/README');
  });

  it('throws on a truncated header', () => {
    expect(() => parseRpm(sampleRpm().slice(0, 120))).toThrow();
  });
});

describe('rpm archives in core', () => {
  it('detects gzip-payload RPMs (and leaves xz ones to libarchive)', () => {
    const gz = sampleRpm();
    const xz = sampleRpm({ compressor: 'xz' });
    expect(rpmPayloadCompressor(gz)).toBe('gzip');
    expect(archive.detect(content(gz))).toBe(0.8);
    expect(libarchiveDetector.detect(content(gz))).toBe(0);
    expect(archive.detect(content(xz))).toBe(0);
    expect(libarchiveDetector.detect(content(xz))).toBe(0.8);
  });

  it('lists from the header and extracts through the gzip cpio payload', async () => {
    const v: ArchiveValue = await archive.parse(content(sampleRpm()), ctx);
    expect(v.format).toBe('rpm');
    expect(archive.label(v)).toBe('RPM · hello-1.0-1.el9.x86_64 · 2 files');
    const out = await archive.derive?.(v, 'usr/share/hello/README', noTask());
    expect(td.decode(out?.bytes)).toBe('Hello from the RPM payload.\n');
    expect(out?.name).toBe('README');
    const stats = (await archive.summarise(v)).stats;
    expect(stats).toContainEqual({ label: 'Package', value: 'RPM' });
    expect(stats).toContainEqual({ label: 'Not listed', value: '1 symlink, 1 %ghost' });
  });

  it('runs Manifest as JSON and Scriptlets as text', async () => {
    const e = new Engine({ loaders: {} });
    const bytes = sampleRpm();
    const blob = new Blob([bytes]);
    await e.ingest({
      id: 'en-1',
      mime: 'application/x-rpm',
      size: blob.size,
      blob,
      name: 'hello.rpm',
    });
    expect(await e.actions('en-1', 'archive')).toEqual(
      expect.arrayContaining(['archive.listing', 'archive.manifest', 'archive.scriptlets']),
    );
    const [scripts] = await e.runAction('en-1', 'archive', 'archive.scriptlets', {});
    expect(scripts?.name).toBe('hello-scriptlets.txt');
    expect(td.decode(scripts?.bytes)).toBe(
      '# %pre (/bin/sh)\ngetent group hello || groupadd hello\n\n' +
        '# %post\necho installed\n\n' +
        '# %postun (/sbin/ldconfig)\n\n',
    );
    const [manifest] = await e.runAction('en-1', 'archive', 'archive.manifest', {});
    expect(JSON.parse(td.decode(manifest?.bytes))).toMatchObject({ type: 'rpm', name: 'hello' });
  });
});

describe('rpm archives in the libarchive module', () => {
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(
    require.resolve('libarchive.js/src/webworker/wasm-gen/libarchive.wasm'),
  );
  let lib: Promise<Libarchive> | null = null;
  const load = () => (lib ??= createLibarchive(wasm));
  const la = createLibarchiveInterpreter(load);

  it('lists an xz-payload RPM from its header and extracts through libarchive', async () => {
    const bytes = new Uint8Array(
      readFileSync(new URL('../fixtures/archives/hello-xz.rpm', import.meta.url)),
    );
    const c = content(bytes, 'hello-xz.rpm');
    expect(la.detect(c)).toBe(0.8);
    const v = await la.parse(c, ctx);
    expect(la.label(v)).toBe('RPM · hello-xz-1.0-1.el9.x86_64 · 2 files');
    expect(v.source.type).toBe('external');
    const out = await la.derive?.(v, 'usr/bin/hello', noTask());
    expect(td.decode(out?.bytes)).toBe('#!/bin/sh\necho hello\n');
  });
});
