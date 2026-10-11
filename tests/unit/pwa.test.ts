import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { headTags, MANIFEST_FILE, webManifest } from '../../vite/pwa.ts';

const ICONS = path.resolve(import.meta.dirname, '../../vite/icons');

/** A PNG's width and height, from its IHDR chunk. */
async function pngSize(file: string): Promise<[number, number]> {
  const bytes = await readFile(file);
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('web app manifest', () => {
  it.each([
    ['/', '/'],
    ['/clipbox/', '/clipbox/'],
  ])('scopes every URL to base %s', (base, prefix) => {
    const m = webManifest(base);
    expect(m.id).toBe(prefix);
    expect(m.start_url).toBe(prefix);
    expect(m.scope).toBe(prefix);
    expect(m.share_target.action).toBe(`${prefix}share-target`);
    expect(m.file_handlers.map(h => h.action)).toEqual([prefix]);
    for (const icon of m.icons) expect(icon.src.startsWith(`${prefix}icons/`)).toBe(true);
    // start_url must be within scope for Chromium's installability check
    expect(m.start_url.startsWith(m.scope)).toBe(true);
  });

  it('has what Chromium needs to install it', () => {
    const m = webManifest('/clipbox/');
    expect(m.name).toBe('Clipbox');
    expect(m.short_name.length).toBeLessThanOrEqual(12);
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/);
    const sizes = (purpose: string) => m.icons.filter(i => i.purpose === purpose).map(i => i.sizes);
    expect(sizes('any')).toEqual(['192x192', '512x512']);
    expect(sizes('maskable')).toEqual(['192x192', '512x512']);
  });

  it('shares text, URLs and files with a multipart POST', () => {
    const { share_target } = webManifest('/');
    expect(share_target.method).toBe('POST');
    expect(share_target.enctype).toBe('multipart/form-data');
    expect(share_target.params).toMatchObject({ title: 'title', text: 'text', url: 'url' });
    expect(share_target.params.files[0]?.name).toBe('files');
  });

  it('declares only extensions that start with a dot', () => {
    for (const exts of Object.values(webManifest('/').file_handlers[0]?.accept ?? {}))
      for (const ext of exts) expect(ext).toMatch(/^\.\w+$/);
  });

  it.each([
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['icon-maskable-192.png', 192],
    ['icon-maskable-512.png', 512],
    ['apple-touch-icon.png', 180],
  ])('icon %s is %ipx square', async (file, px) => {
    expect(await pngSize(path.join(ICONS, file))).toEqual([px, px]);
  });
});

describe('head tags', () => {
  it.each(['/', '/clipbox/'])('link the manifest and icons under %s', base => {
    const hrefs = headTags(base).flatMap(t =>
      t.attrs && typeof t.attrs.href === 'string' ? [t.attrs.href] : [],
    );
    expect(hrefs).toContain(`${base}${MANIFEST_FILE}`);
    expect(hrefs).toContain(`${base}icons/apple-touch-icon.png`);
    for (const href of hrefs) expect(href.startsWith(base)).toBe(true);
  });

  it('sets the theme colour to the manifest’s', () => {
    const meta = headTags('/').find(t => t.attrs?.name === 'theme-color');
    expect(meta?.attrs?.content).toBe(webManifest('/').theme_color);
  });
});
