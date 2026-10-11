import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { modules } from '../../src/modules/registry';
import { libraryVersions, packageVersion } from '../../vite/modulesManifest';
import pkg from '../../package.json';

const ROOT = path.resolve(import.meta.dirname, '../..');

describe('packageVersion', () => {
  it('reads the version field', () => {
    expect(packageVersion('{"name":"pdfjs-dist","version":"6.4.299"}')).toBe('6.4.299');
  });

  it.each(['{}', '{"version":""}', '{"version":6}', 'not json', '[]'])(
    'returns undefined for %s',
    json => {
      expect(packageVersion(json)).toBeUndefined();
    },
  );
});

describe('libraryVersions', () => {
  it('finds a version for every module in the installed node_modules', async () => {
    const versions = await libraryVersions(ROOT);
    expect(Object.keys(versions).sort()).toEqual(modules.map(m => m.id).sort());
    for (const v of Object.values(versions)) expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reads SheetJS from its CDN tarball install', async () => {
    const tarball = /xlsx-(\d+\.\d+\.\d+)\.tgz$/.exec(pkg.dependencies.xlsx)?.[1];
    expect(tarball).toBeDefined();
    expect((await libraryVersions(ROOT)).sheets).toBe(tarball);
  });

  it('leaves out packages it cannot read', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'clipbox-manifest-'));
    try {
      await mkdir(path.join(dir, 'node_modules/pdfjs-dist'), { recursive: true });
      await writeFile(
        path.join(dir, 'node_modules/pdfjs-dist/package.json'),
        '{"version":"1.2.3"}',
      );
      await mkdir(path.join(dir, 'node_modules/sql.js'), { recursive: true });
      await writeFile(path.join(dir, 'node_modules/sql.js/package.json'), 'broken');
      expect(await libraryVersions(dir)).toEqual({ pdf: '1.2.3' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
