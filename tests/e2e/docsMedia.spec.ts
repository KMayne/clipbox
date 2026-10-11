import { expect, test, type Page } from '@playwright/test';
import { QR_MODULES, QR_TEXT } from '../fixtures/qr';
import { actionsPane, dropBytes, naturalSize, paste } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const derived = (page: Page) => page.getByTestId('capture').first();

/** The selected value's text, in the Text view's editor, checked line by line. */
async function expectRaw(page: Page, text: string) {
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Text' }).click();
  const editor = page.getByRole('region', { name: 'View' }).getByTestId('monaco-view');
  for (const line of text.split('\n').filter(Boolean)) await expect(editor).toContainText(line);
}

/** Runs an action from the sidebar, filling its settings form if it has one. */
async function runAction(page: Page, title: string, fill?: Record<string, string>) {
  const pane = actionsPane(page);
  await pane.getByRole('button', { name: title, exact: true }).click();
  const form = pane.getByRole('form', { name: `${title} settings` });
  if (await form.count()) {
    for (const [label, value] of Object.entries(fill ?? {})) {
      const field = form.getByLabel(label);
      if ((await field.evaluate(el => el.tagName)) === 'SELECT') await field.selectOption(value);
      else await field.fill(value);
    }
    await form.getByRole('button', { name: 'Run' }).click();
  }
}

/** Pastes a PNG drawn in the page: the QR fixture, or colour bands left to right. */
async function pasteImage(
  page: Page,
  spec: { qr: string[] } | { width: number; height: number; bands: string[] },
  name = 'image.png',
) {
  await page.evaluate(
    async ({ spec, name }) => {
      let canvas: OffscreenCanvas;
      if ('qr' in spec) {
        const scale = 6;
        const size = (spec.qr.length + 8) * scale;
        canvas = new OffscreenCanvas(size, size);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no canvas');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#000';
        spec.qr.forEach((row, y) =>
          [...row].forEach((m, x) => {
            if (m === '#') ctx.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
          }),
        );
      } else {
        canvas = new OffscreenCanvas(spec.width, spec.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no canvas');
        const w = spec.width / spec.bands.length;
        spec.bands.forEach((colour, i) => {
          ctx.fillStyle = colour;
          ctx.fillRect(i * w, 0, w, spec.height);
        });
      }
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    },
    { spec, name },
  );
  await expect(page.locator('[data-kind=image]').first()).toHaveAttribute('aria-pressed', 'true');
}

test('Read QR / barcode decodes a QR code (jsQR where BarcodeDetector is missing)', async ({
  page,
}) => {
  await pasteImage(page, { qr: QR_MODULES }, 'qr.png');
  await runAction(page, 'Read QR / barcode');
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 15_000 });
  await expect(derived(page).getByTestId('derived-from')).toContainText('Read QR / barcode');
  await expectRaw(page, QR_TEXT);
});

test('Read QR / barcode explains when nothing is found', async ({ page }) => {
  await pasteImage(page, { width: 40, height: 40, bands: ['#888'] });
  await runAction(page, 'Read QR / barcode');
  const hasDetector = await page.evaluate(() => 'BarcodeDetector' in window);
  await expect(
    page.getByText(
      hasDetector
        ? /No QR codes or barcodes found/
        : /No QR code found\. Other barcode types need the browser's BarcodeDetector/,
    ),
  ).toBeVisible();
  await expect(page.getByTestId('capture')).toHaveCount(1);
});

test('Resize and Rotate / flip make new images', async ({ page }) => {
  await pasteImage(page, { width: 40, height: 20, bands: ['#f00', '#00f'] }, 'wide.png');
  await runAction(page, 'Resize', { Size: '25' });
  await expect(derived(page).getByTestId('derived-from')).toContainText('Resize to 25%');
  await expect(derived(page).locator('[data-kind=image]')).toHaveText(/PNG 10×5/);

  await runAction(page, 'Rotate / flip', { Transform: 'cw' });
  await expect(derived(page).getByTestId('derived-from')).toContainText('Rotate 90° clockwise');
  await expect(derived(page).locator('[data-kind=image]')).toHaveText(/PNG 5×10/);
  // The red left band is now on top
  const img = page.getByRole('region', { name: 'View' }).locator('img');
  expect(await naturalSize(img)).toEqual([5, 10]);
  const top = await img.evaluate(el => {
    if (!(el instanceof HTMLImageElement)) return [];
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(el, 0, 0);
    return [...ctx.getImageData(2, 1, 1, 1).data];
  });
  expect(top).toEqual([255, 0, 0, 255]);
});

test('Extract palette makes one colour capture per dominant colour', async ({ page }) => {
  await pasteImage(page, { width: 60, height: 20, bands: ['#ff0000', '#ff0000', '#0000ff'] });
  await runAction(page, 'Extract palette', { Colours: '2' });
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const colours = derived(page).locator('[data-kind=colour]');
  await expect(colours).toHaveCount(2);
  await expect(derived(page)).toContainText('colour-1.txt');
  await colours.first().click();
  await expectRaw(page, '#ff0000');
});

test('Video frame as PNG grabs a frame with WebCodecs', async ({ page }) => {
  // Half a second of solid green, recorded in the page
  const data = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const recorder = new MediaRecorder(canvas.captureStream(30), {
      mimeType: 'video/webm;codecs=vp8',
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    const done = new Promise(resolve => (recorder.onstop = resolve));
    recorder.start();
    const start = performance.now();
    await new Promise<void>(resolve => {
      const frame = () => {
        ctx.fillStyle = '#00c800';
        ctx.fillRect(0, 0, 160, 120);
        if (performance.now() - start < 500) requestAnimationFrame(frame);
        else resolve();
      };
      frame();
    });
    recorder.stop();
    await done;
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  await dropBytes(page, 'clip.webm', 'video/webm', new Uint8Array(data));
  await expect(page.locator('[data-kind=video]')).toHaveAttribute('aria-pressed', 'true');

  await runAction(page, 'Video frame as PNG', { Time: '0.2' });
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 15_000 });
  await expect(derived(page).getByTestId('derived-from')).toContainText('Frame at 0.2');
  await expect(derived(page).locator('[data-kind=image]')).toHaveText(/PNG 160×120/);
  await expect(derived(page)).toContainText(/clip \(frame at [\d.]+s\)\.png/);
  const img = page.getByRole('region', { name: 'View' }).locator('img');
  expect(await naturalSize(img)).toEqual([160, 120]);
  const pixel = await img.evaluate(el => {
    if (!(el instanceof HTMLImageElement)) return [];
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(el, 0, 0);
    return [...ctx.getImageData(80, 60, 1, 1).data];
  });
  // VP8 is lossy: close to the green drawn
  expect(pixel[0]).toBeLessThan(40);
  expect(pixel[1]).toBeGreaterThan(160);
  expect(pixel[2]).toBeLessThan(40);

  // Past the end is a clear error
  const source = page.getByTestId('capture').nth(1);
  await source.getByRole('button', { name: 'Expand' }).click();
  await source.locator('[data-kind=video]').click();
  await runAction(page, 'Video frame as PNG', { Time: '30' });
  await expect(page.getByText(/30 s is past the end of the video/)).toBeVisible();
});

test('HTML To Markdown runs on pasted HTML', async ({ page }) => {
  await paste(page, {
    'text/html':
      '<h2>Title</h2><p>See <a href="https://x.test/a">the docs</a> and <b>more</b>.</p>',
  });
  await page.locator('[data-kind=html]').click();
  await runAction(page, 'To Markdown');
  await expect(derived(page).getByTestId('derived-from')).toContainText('To Markdown');
  await expectRaw(page, '## Title\n\nSee [the docs](https://x.test/a) and **more**.\n');
});
