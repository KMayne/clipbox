import { expect, test, type Page } from '@playwright/test';
import { paste, savedCount } from './helpers';

/** Drops one capture of small solid-colour PNGs, one per name. */
async function dropImages(page: Page, names: string[]) {
  await page.evaluate(async names => {
    const dt = new DataTransfer();
    for (const [i, name] of names.entries()) {
      const canvas = new OffscreenCanvas(4 + i, 3);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.fillStyle = `hsl(${(i * 47) % 360} 70% 50%)`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      dt.items.add(new File([blob], name, { type: 'image/png' }));
    }
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  }, names);
}

const collection = (page: Page) => page.getByTestId('collection');
const tiles = (page: Page) => collection(page).getByTestId('tile');
const inspectorTitle = (page: Page) => page.getByRole('region', { name: 'Inspector' });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a multi-file drop opens as a collection grid', async ({ page }) => {
  await dropImages(page, ['red.png', 'green.png', 'blue.png', 'cyan.png']);
  const capture = page.getByTestId('capture');
  await expect(capture.getByTestId('capture-count')).toHaveText('drop · 4 files');
  await expect(capture.locator('[data-kind=image]')).toHaveCount(4);

  await capture.getByTestId('capture-header').click();
  await expect(collection(page).getByTestId('collection-count')).toHaveText(/^4 items · \d+ B$/);
  await expect(tiles(page)).toHaveCount(4);
  await expect(tiles(page).first()).toContainText('red.png');
  await expect(tiles(page).first().getByTestId('tile-kind')).toHaveText('Image');
  await expect(tiles(page).first().locator('img')).toHaveAttribute('loading', 'lazy');

  // Clicking a tile selects that entry
  await tiles(page).nth(2).click();
  await expect(collection(page)).toHaveCount(0);
  await expect(inspectorTitle(page)).toContainText('blue.png');
  await expect(capture.locator('[aria-pressed=true]')).toHaveText(/PNG 6×3/);

  // k from the first chip goes back up to the collection header
  await capture.locator('[data-kind=image]').first().click();
  await page.keyboard.press('k');
  await expect(collection(page)).toBeVisible();
  await expect(capture.getByTestId('capture-header')).toHaveAttribute('aria-current', 'true');

  // Arrow keys and Enter navigate the grid
  await tiles(page).first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(tiles(page).nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(tiles(page).nth(3)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tiles(page).nth(2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tiles(page).nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown'); // all four fit on one row: stays on the last
  await expect(tiles(page).nth(3)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(inspectorTitle(page)).toContainText('cyan.png');
});

test('Enter on a selected collection header moves focus into the grid', async ({ page }) => {
  await dropImages(page, ['a.png', 'b.png']);
  await page.getByTestId('capture-header').click();
  await page.getByRole('region', { name: 'Pastes' }).focus();
  await page.keyboard.press('Enter');
  await expect(tiles(page).first()).toBeFocused();
});

test('large captures list a few compact rows until "Show all"', async ({ page }) => {
  const names = Array.from({ length: 30 }, (_, i) => `slide-${i + 1}.png`);
  await dropImages(page, names);
  const capture = page.getByTestId('capture');
  await expect(capture.getByTestId('entry')).toHaveCount(8);
  await expect(capture.getByTestId('show-all')).toHaveText('Show all 30 (22 more)');

  await capture.getByTestId('capture-header').click();
  await expect(tiles(page)).toHaveCount(30);
  // Selecting a hidden entry reveals it
  await tiles(page).nth(20).click();
  await expect(capture.getByTestId('entry')).toHaveCount(30);
  await expect(capture.getByTestId('show-all')).toHaveCount(0);
});

/** Replaces the directory picker with an in-memory folder that records what's written. */
async function stubDirectoryPicker(page: Page, existing: string[], cancel = false) {
  await page.addInitScript(
    ({ existing, cancel }) => {
      const written: { name: string; size: number; type: string }[] = [];
      Object.defineProperty(window, '__written', { value: written });
      const dir = {
        kind: 'directory',
        name: 'Exports',
        async *keys() {
          yield* existing;
        },
        async getFileHandle(name: string) {
          return {
            kind: 'file',
            name,
            async createWritable() {
              return {
                async write(blob: Blob) {
                  written.push({ name, size: blob.size, type: blob.type });
                },
                async close() {},
                async abort() {},
              };
            },
          };
        },
      };
      Object.defineProperty(window, 'showDirectoryPicker', {
        value: async () => {
          Reflect.set(
            window,
            '__pickerCalls',
            Number(Reflect.get(window, '__pickerCalls') ?? 0) + 1,
          );
          if (cancel) throw new DOMException('The user aborted a request.', 'AbortError');
          return dir;
        },
      });
    },
    { existing, cancel },
  );
}

const written = (page: Page) =>
  page.evaluate(() => {
    const list: unknown = Reflect.get(window, '__written');
    return Array.isArray(list)
      ? list.map((w: unknown) => String(Reflect.get(Object(w), 'name')))
      : [];
  });

test('Download all writes every entry into the picked folder', async ({ page }) => {
  await stubDirectoryPicker(page, ['green.png']);
  await page.goto('/');
  await dropImages(page, ['red.png', 'green.png', 'red.png']);
  await page.getByTestId('capture-header').click();
  await collection(page).getByRole('button', { name: 'Download all' }).click();

  await expect(page.getByRole('status')).toHaveText('Saved 3 files to Exports');
  expect(await written(page)).toEqual(['red.png', 'green (2).png', 'red (2).png']);
  await expect(collection(page).getByRole('button', { name: 'Download all' })).toBeEnabled();
});

test('Download all from the palette, and cancelling the picker', async ({ page }) => {
  await stubDirectoryPicker(page, [], true);
  await page.goto('/');
  await dropImages(page, ['a.png', 'b.png']);
  await expect(page.locator('[data-kind=image]')).toHaveCount(2);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Download all');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__pickerCalls'))).toBe(1);
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(await written(page)).toEqual([]);
});

test('Download saves one entry from its row and the Inspector', async ({ page }) => {
  await dropImages(page, ['one.png', 'two.png']);
  const row = page.getByTestId('entry').nth(1);
  await row.hover();
  const fromRow = page.waitForEvent('download');
  await row.getByTestId('entry-download').click();
  expect((await fromRow).suggestedFilename()).toBe('two.png');

  await page.getByTestId('chip').first().click();
  const fromInspector = page.waitForEvent('download');
  await inspectorTitle(page).getByRole('button', { name: 'Download' }).click();
  expect((await fromInspector).suggestedFilename()).toBe('one.png');

  // An unnamed paste gets a generated name
  await paste(page, { 'text/plain': 'hello' });
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const fromPalette = page.waitForEvent('download');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Download current');
  await page.keyboard.press('Enter');
  expect((await fromPalette).suggestedFilename()).toBe('text-1.txt');
});

/** Adds a derived capture with several results through the store, as an action would. */
async function addDerivedCollection(page: Page) {
  await page.evaluate(async () => {
    const url = '/src/state/captureStore.ts';
    const mod: unknown = await import(/* @vite-ignore */ url);
    const store: unknown = Reflect.get(Object(mod), 'useCaptureStore');
    if (typeof store !== 'function') throw new Error('no store');
    const state: unknown = Reflect.apply(Reflect.get(store, 'getState'), store, []);
    const captures: unknown = Reflect.get(Object(state), 'captures');
    if (!Array.isArray(captures)) throw new Error('no captures');
    const entryId: unknown = Reflect.get(
      Object(Reflect.get(Object(captures[0]), 'entries'))[0],
      'id',
    );
    const entries = ['alpha', 'beta', 'gamma'].map((word, i) => {
      const blob = new Blob([JSON.stringify({ word, i })], { type: 'application/json' });
      return {
        mime: 'application/json',
        size: blob.size,
        blob,
        ...(i === 0 && { name: 'first.json' }),
      };
    });
    Reflect.apply(Reflect.get(Object(state), 'add'), state, [
      'derived',
      entries,
      { entryId, kind: 'text', label: 'Split into parts' },
    ]);
  });
}

test('a derived capture with several results opens as a collection and survives a reload', async ({
  page,
}) => {
  await paste(page, { 'text/plain': 'alpha beta gamma' });
  await expect(page.getByTestId('chip').first()).toBeVisible();
  await addDerivedCollection(page);

  await expect(collection(page)).toBeVisible();
  await expect(collection(page).getByTestId('collection-count')).toHaveText(/^3 items/);
  await expect(collection(page).getByTestId('derived-from')).toHaveText(
    /^from .* › Split into parts$/,
  );
  await expect(tiles(page)).toHaveText([/first\.json/, /json-2\.json/, /json-3\.json/]);
  await expect(tiles(page).first().getByTestId('tile-kind')).toHaveText('JSON');
  await expect(page.getByTestId('capture').first().getByTestId('capture-count')).toHaveText(
    '· 3 items',
  );
  await expect.poll(() => savedCount(page)).toBe(2);

  await page.reload();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  await expect(collection(page)).toBeVisible();
  await expect(tiles(page)).toHaveCount(3);
  await expect(collection(page).getByTestId('derived-from')).toHaveText(
    /^from .* › Split into parts$/,
  );
  // The parent link still selects the original paste
  await collection(page).getByTestId('derived-from').click();
  await expect(page.getByTestId('capture').nth(1).locator('[aria-pressed=true]')).toHaveCount(1);
});

test('a dropped collection survives a reload', async ({ page }) => {
  await dropImages(page, ['x.png', 'y.png', 'z.png']);
  await expect.poll(() => savedCount(page)).toBe(1);
  await page.reload();
  await page.getByTestId('capture-header').click();
  await expect(tiles(page)).toHaveCount(3);
  await expect(tiles(page).nth(1)).toContainText('y.png');
  await expect(tiles(page).nth(1).locator('img')).toBeVisible();
});
