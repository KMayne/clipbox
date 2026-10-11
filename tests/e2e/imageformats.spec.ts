import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  colorRef,
  emf,
  g4,
  lzw,
  makeEmf,
  makeTiff,
  makeWmf,
  packBits,
  plus,
  SAMPLE_EMF_RECORDS,
  samples,
  wmf,
} from '../fixtures/images';
import { makePptx, solidPng } from '../fixtures/pptx';
import { actionsPane, dropBytes, naturalSize, stat } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const view = (page: Page) => page.getByRole('region', { name: 'View' }).locator('img');

/** RGBA of one pixel of a decoded <img>. */
const pixel = (img: Locator, x: number, y: number) =>
  img.evaluate(
    (el, [x, y]) => {
      if (!(el instanceof HTMLImageElement)) return [];
      const c = document.createElement('canvas');
      c.width = el.naturalWidth;
      c.height = el.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return [];
      ctx.drawImage(el, 0, 0);
      return [...ctx.getImageData(x ?? 0, y ?? 0, 1, 1).data];
    },
    [x, y],
  );

const near = (got: number[], want: number[], tolerance = 12) =>
  expect(
    got.every((v, i) => Math.abs(v - (want[i] ?? 0)) <= tolerance),
    `${got} ≈ ${want}`,
  ).toBe(true);

async function runAction(page: Page, name: string, settings?: (form: Locator) => Promise<unknown>) {
  const pane = actionsPane(page);
  await pane.getByRole('button', { name, exact: true }).click();
  const form = pane.getByRole('form', { name: `${name} settings` });
  if (settings) await settings(form);
  await form.getByRole('button', { name: 'Run' }).click();
}

const W = 16;
const H = 12;
const rgb = (x: number) => (x < 8 ? [220, 20, 30] : [10, 40, 230]);
const bilevel = (x: number, y: number) => (x === y || x === 15 - y ? 1 : 0);

const threePageTiff = () =>
  makeTiff([
    {
      width: W,
      height: H,
      data: lzw(samples(W, H, 3, rgb)),
      compression: 5,
      photometric: 2,
      bitsPerSample: [8, 8, 8],
      dpi: 300,
    },
    {
      width: 16,
      height: 16,
      data: g4(16, 16, bilevel),
      compression: 4,
      photometric: 0,
      bitsPerSample: [1],
    },
    {
      width: 4,
      height: 2,
      data: packBits(samples(4, 2, 3, () => [0, 200, 0])),
      compression: 32773,
      photometric: 2,
      bitsPerSample: [8, 8, 8],
    },
  ]);

test('a multi-page TIFF previews every page and splits into PNGs', async ({ page }) => {
  await dropBytes(page, 'scan.tif', 'image/tiff', threePageTiff());
  const chip = page.locator('[data-kind=image]');
  await expect(chip).toHaveText(/TIFF 16×12 · 3 pages/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(stat(page, 'Compression')).toHaveText('LZW');
  await expect(stat(page, 'DPI')).toHaveText('300');

  const img = view(page);
  expect(await naturalSize(img)).toEqual([16, 12]);
  expect(await pixel(img, 1, 1)).toEqual([220, 20, 30, 255]);
  expect(await pixel(img, 12, 6)).toEqual([10, 40, 230, 255]);

  // Page picker: page 2 is the G4 fax page
  const pager = page.getByTestId('image-pages');
  await expect(pager).toContainText('Page 1 / 3');
  await pager.getByRole('button', { name: 'Next page' }).click();
  await expect(pager).toContainText('Page 2 / 3');
  await expect.poll(async () => (await naturalSize(img)).join()).toBe('16,16');
  expect(await pixel(img, 0, 0)).toEqual([0, 0, 0, 255]);
  expect(await pixel(img, 1, 0)).toEqual([255, 255, 255, 255]);

  // No settings: it runs on click
  await actionsPane(page).getByRole('button', { name: 'Pages as PNG' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.locator('[data-kind=image]')).toHaveCount(3);
  await expect(derived).toContainText('scan-page03.png');
});

test('Convert re-encodes a TIFF’s first page', async ({ page }) => {
  await dropBytes(page, 'scan.tif', 'image/tiff', threePageTiff());
  await expect(page.locator('[data-kind=image]')).toHaveText(/TIFF 16×12 · 3 pages/);
  await runAction(page, 'Convert', form => form.getByLabel('Format').selectOption('png'));
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const converted = page.getByTestId('capture').first();
  await expect(converted.locator('[data-kind=image]')).toHaveText(/PNG 16×12/);
  await expect(converted).toContainText('scan.png');
  const img = view(page);
  expect(await naturalSize(img)).toEqual([16, 12]);
  expect(await pixel(img, 1, 1)).toEqual([220, 20, 30, 255]);
});

test('JPEG-compressed TIFF decodes', async ({ page }) => {
  // The browser encodes the JPEG; the TIFF wraps it as one strip
  const jpeg = await page.evaluate(async () => {
    const c = new OffscreenCanvas(32, 16);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#d02020';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#2040e0';
    ctx.fillRect(16, 0, 16, 16);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const tiff = makeTiff([
    {
      width: 32,
      height: 16,
      data: new Uint8Array(jpeg),
      compression: 7,
      photometric: 6,
      bitsPerSample: [8, 8, 8],
    },
  ]);
  await dropBytes(page, 'photo.tiff', 'image/tiff', tiff);
  await expect(page.locator('[data-kind=image]')).toHaveText(/TIFF 32×16/);
  await expect(stat(page, 'Compression')).toHaveText('JPEG');
  const img = view(page);
  expect(await naturalSize(img)).toEqual([32, 16]);
  near(await pixel(img, 4, 8), [208, 32, 32, 255]);
  near(await pixel(img, 28, 8), [32, 64, 224, 255]);
});

test('an EMF renders as a vector image and converts to PNG', async ({ page }) => {
  await dropBytes(page, 'chart.emf', 'image/emf', makeEmf(800, 600, SAMPLE_EMF_RECORDS));
  const chip = page.locator('[data-kind=image]');
  await expect(chip).toHaveText(/EMF 800×600 \(vector\)/);
  const img = view(page);
  expect(await naturalSize(img)).toEqual([800, 600]);
  expect(await pixel(img, 200, 175)).toEqual([255, 0, 0, 255]);
  expect(await pixel(img, 500, 200)).toEqual([0, 0, 255, 255]);
  expect(await pixel(img, 200, 480)).toEqual([0, 160, 0, 255]);
  // Outside the shapes: transparent
  expect((await pixel(img, 750, 50))[3]).toBe(0);
  // "Hello" in black near (400, 450): some dark pixels in its box
  const dark = await img.evaluate(el => {
    if (!(el instanceof HTMLImageElement)) return 0;
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(el, 0, 0);
    const d = ctx.getImageData(400, 415, 120, 40).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if ((d[i] ?? 0) > 128) n++;
    return n;
  });
  expect(dark).toBeGreaterThan(50);

  await runAction(page, 'Convert', form => form.getByLabel('Format').selectOption('png'));
  const converted = page.getByTestId('capture').first();
  await expect(converted.locator('[data-kind=image]')).toHaveText(/PNG 800×600/);
  expect(await naturalSize(view(page))).toEqual([800, 600]);
});

test('EMF+ records draw instead of their EMF fallback', async ({ page }) => {
  const bytes = makeEmf(100, 100, [
    emf.plus([plus.header(true)]),
    emf.plus([plus.fillRect(0xff00ff00, 10, 10, 30, 20)]),
    // The dual-mode GDI fallback: a red square that EMF+ playback skips
    emf.select(0x80000008),
    emf.createBrush(1, colorRef(255, 0, 0)),
    emf.select(1),
    emf.rectangle(60, 60, 90, 90),
  ]);
  await dropBytes(page, 'plus.emf', 'image/emf', bytes);
  await expect(page.locator('[data-kind=image]')).toHaveText(/EMF 100×100/);
  await expect(stat(page, 'Rendered from')).toHaveText('EMF+ records');
  const img = view(page);
  expect(await pixel(img, 20, 20)).toEqual([0, 255, 0, 255]);
  expect((await pixel(img, 75, 75))[3]).toBe(0);
});

test('a WMF renders through its placeable header', async ({ page }) => {
  const bytes = makeWmf(1500, 1125, 180, [
    wmf.nullPen(),
    wmf.select(0),
    wmf.brush(colorRef(255, 0, 0)),
    wmf.select(1),
    wmf.rectangle(150, 150, 450, 375),
  ]);
  await dropBytes(page, 'clip.wmf', 'image/wmf', bytes);
  await expect(page.locator('[data-kind=image]')).toHaveText(/WMF 800×600 \(vector\)/);
  const img = view(page);
  expect(await naturalSize(img)).toEqual([800, 600]);
  expect(await pixel(img, 160, 140)).toEqual([255, 0, 0, 255]);
});

test('Chromium shows cursors (.cur) natively', async ({ page }) => {
  const png = solidPng(8, 8, [10, 200, 30]);
  const cur = new Uint8Array(22 + png.length);
  const dv = new DataView(cur.buffer);
  dv.setUint16(2, 2, true); // type: cursor
  dv.setUint16(4, 1, true);
  cur.set([8, 8, 0, 0], 6);
  dv.setUint32(14, png.length, true);
  dv.setUint32(18, 22, true);
  cur.set(png, 22);
  await dropBytes(page, 'pointer.cur', 'image/x-icon', cur);
  await expect(page.locator('[data-kind=image]')).toHaveText(/CUR 8×8/);
  expect(await naturalSize(view(page))).toEqual([8, 8]);
});

test('PowerPoint Extract images can convert EMF pictures to PNG', async ({ page }) => {
  const pptx = makePptx({
    slides: [{ title: 'Chart', images: ['chart.emf'] }],
    media: { 'chart.emf': makeEmf(800, 600, SAMPLE_EMF_RECORDS) },
  });
  await dropBytes(
    page,
    'deck.pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    pptx,
  );
  await expect(page.locator('[data-kind=presentation]')).toHaveAttribute('aria-pressed', 'true');
  await runAction(page, 'Extract images', form =>
    form.getByLabel('Convert vector/legacy images to PNG').check(),
  );
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toContainText('Extract images as PNG');
  await expect(derived.locator('[data-kind=image]')).toHaveText(/PNG 800×600/);
  await expect(derived).toContainText('slide-01-image1.png');
});
