import { describe, expect, it } from 'vitest';
import { detectMagic } from '../../src/core/magic';
import type { EntryId } from '../../src/core/types';
import { Engine } from '../../src/engine/engine';
import { selfSigned } from '../fixtures/certs';
import {
  makeElf,
  makeMacho,
  makePe,
  pemToDer,
  samplePe,
  signedData,
} from '../fixtures/executables';

const td = new TextDecoder();

async function engineWith(bytes: Uint8Array<ArrayBuffer>, name = 'example.exe') {
  const engine = new Engine({ loaders: {} });
  const blob = new Blob([bytes], { type: 'application/x-msdownload' });
  const id: EntryId = 'en-1';
  const result = await engine.ingest({ id, mime: blob.type, name, size: blob.size, blob });
  const run = async (action: string, params: Record<string, unknown> = {}) =>
    engine.runAction(id, 'executable', action, params);
  return { engine, result, run };
}

describe('executable ingest', () => {
  it('offers the executable kind first, labelled, with binary still on offer', async () => {
    const { result } = await engineWith(samplePe());
    expect(result.interpretations.map(i => i.kind)).toEqual(['executable', 'binary']);
    expect(result.interpretations[0]?.label).toBe('Windows x64 GUI app · Example Corp · v1.2.3');
  });

  it('serves the preview model and the icon', async () => {
    const { engine } = await engineWith(samplePe());
    const layout = await engine.slice('en-1', 'executable', { type: 'json' });
    expect(layout).toMatchObject({
      title: 'Windows x64 GUI app · Example Corp · v1.2.3',
      hasIcon: true,
    });
    const icon = await engine.slice('en-1', 'executable', { type: 'image' });
    expect(icon).toMatchObject({ mime: 'image/png' });
  });
});

describe('executable actions', () => {
  it('extracts the icon as .ico and PNG', async () => {
    const { run } = await engineWith(samplePe());
    const out = await run('executable.extractIcon');
    expect(out.map(o => [o.name, o.mime])).toEqual([
      ['example-icon.ico', 'image/x-icon'],
      ['example-icon.png', 'image/png'],
    ]);
    expect(detectMagic(out[0]?.bytes ?? new Uint8Array())).toBe('ico');
    expect(detectMagic(out[1]?.bytes ?? new Uint8Array())).toBe('png');
  });

  it("isn't offered without an icon", async () => {
    const { run } = await engineWith(makePe());
    await expect(run('executable.extractIcon')).rejects.toThrow("Extract icon doesn't apply");
  });

  it('gives version info as JSON', async () => {
    const { run } = await engineWith(samplePe());
    const [json] = await run('executable.versionInfo');
    expect(json).toMatchObject({ mime: 'application/json', name: 'example-version.json' });
    expect(JSON.parse(td.decode(json?.bytes))).toMatchObject({
      fileVersion: '1.2.3.0',
      strings: { CompanyName: 'Example Corp', ProductName: 'Example' },
      translations: ['0409 04B0'],
    });
  });

  it('gives imports as CSV', async () => {
    const { run } = await engineWith(samplePe());
    const [csv] = await run('executable.importsCsv');
    expect(csv?.mime).toBe('text/csv');
    expect(td.decode(csv?.bytes)).toBe(
      [
        'dll,function,ordinal,delay_loaded',
        'KERNEL32.dll,CreateFileW,,false',
        'KERNEL32.dll,ExitProcess,,false',
        'KERNEL32.dll,GetLastError,,false',
        'USER32.dll,MessageBoxW,,false',
        'USER32.dll,,42,false',
        'WININET.dll,InternetOpenW,,true',
        '',
      ].join('\r\n'),
    );
  });

  it('lists ELF needed libraries as imports', async () => {
    const { run } = await engineWith(makeElf({ needed: ['libc.so.6'] }), 'tool');
    const [csv] = await run('executable.importsCsv');
    expect(td.decode(csv?.bytes)).toBe(
      'dll,function,ordinal,delay_loaded\r\nlibc.so.6,,,false\r\n',
    );
    expect(csv?.name).toBe('tool-imports.csv');
  });

  it('gives exports as CSV', async () => {
    const pe = makePe({
      dll: true,
      exports: [{ name: 'Run' }, { name: 'Fwd', forwarder: 'NTDLL.Foo' }],
    });
    const { run } = await engineWith(pe, 'lib.dll');
    const [csv] = await run('executable.exportsCsv');
    const lines = td.decode(csv?.bytes).split('\r\n');
    expect(lines[0]).toBe('ordinal,name,address,forwarder');
    expect(lines[1]).toBe('1,Run,0x00001000,');
    expect(lines[2]).toMatch(/^2,Fwd,0x[0-9A-F]{8},NTDLL\.Foo$/);
  });

  it('gives sections as CSV', async () => {
    const { run } = await engineWith(samplePe());
    const [csv] = await run('executable.sectionsCsv');
    const lines = td.decode(csv?.bytes).split('\r\n');
    expect(lines[0]).toBe('name,address,virtual_size,raw_offset,raw_size,flags,entropy,packed');
    expect(lines[1]).toMatch(/^\.text,0x00001000,256,512,512,R-X code,\d\.\d{3},false$/);
  });

  it('extracts the manifest', async () => {
    const { run } = await engineWith(samplePe());
    const [xml] = await run('executable.manifest');
    expect(xml?.mime).toBe('application/xml');
    expect(td.decode(xml?.bytes)).toContain('requestedExecutionLevel level="asInvoker"');
  });

  it('extracts strings, ASCII and UTF-16', async () => {
    const { run } = await engineWith(samplePe());
    const [txt] = await run('executable.strings', {});
    const lines = td.decode(txt?.bytes).split('\n');
    expect(lines).toContain('KERNEL32.dll');
    expect(lines).toContain('Example Corp'); // UTF-16 in the version resource
    expect(lines).toContain('OVERLAY-DATA:hello installer payload');

    const [ascii] = await run('executable.strings', {
      encoding: 'ascii',
      minLength: 12,
      offsets: true,
    });
    const text = td.decode(ascii?.bytes);
    expect(text).not.toContain('Example Corp\n');
    expect(text).toMatch(/^[0-9a-f]{8} GetLastError$/m);
    await expect(run('executable.strings', { minLength: 1 })).rejects.toThrow('Invalid settings');
  });

  it('extracts the overlay', async () => {
    const { run } = await engineWith(samplePe());
    const [bin] = await run('executable.overlay');
    expect(bin).toMatchObject({ mime: 'application/octet-stream', name: 'example-overlay.bin' });
    expect(td.decode(bin?.bytes)).toBe('OVERLAY-DATA:hello installer payload');
    const { run: none } = await engineWith(makePe());
    await expect(none('executable.overlay')).rejects.toThrow("doesn't apply");
  });

  it('extracts signing certificates as PEM', async () => {
    const pem = await selfSigned('Example Signer', 30);
    const { run } = await engineWith(samplePe({ pkcs7: signedData([pemToDer(pem)]) }));
    const [out] = await run('executable.certificates');
    expect(out?.mime).toBe('application/x-pem-file');
    expect(pemToDer(td.decode(out?.bytes))).toEqual(pemToDer(pem));
  });

  it('runs the generic actions on Mach-O too', async () => {
    const { run } = await engineWith(makeMacho({ weakDylibs: ['/usr/lib/libz.1.dylib'] }), 'tool');
    const [csv] = await run('executable.importsCsv');
    expect(td.decode(csv?.bytes)).toContain('/usr/lib/libz.1.dylib,,,false');
    await expect(run('executable.versionInfo')).rejects.toThrow("doesn't apply");
  });
});
