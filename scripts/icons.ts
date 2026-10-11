/*
 * Generates the app icons in vite/icons/ from the top bar's mark (MDI "package-variant-closed",
 * Apache-2.0) in the default Nord scheme. The PNGs are committed; run this after changing the mark:
 *
 *   node scripts/icons.ts
 *
 * Renders with Playwright's Chromium (pnpm exec playwright install chromium).
 */
import { mdiPackageVariantClosed } from '@mdi/js';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SCHEME, schemes } from '../src/theme.ts';

const OUT = path.resolve(import.meta.dirname, '../vite/icons');
const nord = schemes[DEFAULT_SCHEME];

/**
 * The mark on a 512-unit canvas. `glyph` is the MDI 24-unit box's size as a fraction of the
 * canvas; `radius` rounds the background (0 = full bleed, for maskable and Apple icons).
 */
function svg({ glyph, radius }: { glyph: number; radius: number }): string {
  const size = 512;
  const scale = (size * glyph) / 24;
  const offset = (size - 24 * scale) / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${nord.panel}"/>`,
    `<path transform="translate(${offset} ${offset}) scale(${scale})" fill="${nord.hue.blue}" d="${mdiPackageVariantClosed}"/>`,
    `</svg>`,
  ].join('');
}

// "any" icons keep the glyph large on a rounded tile; maskable ones keep it inside the 80% safe zone
const any = svg({ glyph: 0.66, radius: 112 });
const maskable = svg({ glyph: 0.5, radius: 0 });
const apple = svg({ glyph: 0.62, radius: 0 });

const pngs: [file: string, source: string, px: number][] = [
  ['icon-192.png', any, 192],
  ['icon-512.png', any, 512],
  ['icon-maskable-192.png', maskable, 192],
  ['icon-maskable-512.png', maskable, 512],
  ['apple-touch-icon.png', apple, 180],
];

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'icon.svg'), `${any}\n`);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [file, source, px] of pngs) {
    await page.setViewportSize({ width: px, height: px });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${source}`,
    );
    await page.locator('svg').screenshot({ path: path.join(OUT, file), omitBackground: true });
  }
} finally {
  await browser.close();
}
console.log(`Wrote ${pngs.length} PNGs and icon.svg to ${path.relative(process.cwd(), OUT)}`);
