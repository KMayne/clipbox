import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

// Production build only: the manifest, icons and service worker come from `pnpm build`

const manifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  short_name: z.string(),
  start_url: z.string(),
  scope: z.string(),
  display: z.literal('standalone'),
  theme_color: z.string(),
  background_color: z.string(),
  icons: z.array(
    z.object({ src: z.string(), sizes: z.string(), type: z.string(), purpose: z.string() }),
  ),
  share_target: z.object({ action: z.string(), method: z.literal('POST') }),
});

async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function fetchManifest(page: Page) {
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');
  const res = await page.request.get(href ?? '');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('manifest+json');
  return manifestSchema.parse(await res.json());
}

test('the manifest is valid, its icons load, and Chromium finds the app installable', async ({
  page,
}) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  const manifest = await fetchManifest(page);
  expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', name: 'Clipbox' });
  await expect(page.locator('meta[name=theme-color]')).toHaveAttribute(
    'content',
    manifest.theme_color,
  );

  for (const icon of manifest.icons) {
    const res = await page.request.get(icon.src);
    expect(res.ok(), icon.src).toBe(true);
    const png = await res.body();
    const [w, h] = icon.sizes.split('x').map(Number);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], icon.src).toEqual([w, h]);
  }
  const apple = await page.locator('link[rel=apple-touch-icon]').getAttribute('href');
  expect((await page.request.get(apple ?? '')).ok()).toBe(true);

  // Chromium's own checks: the manifest parses, and a service worker with a fetch handler
  // controls start_url
  const cdp = await page.context().newCDPSession(page);
  const { errors } = await cdp.send('Page.getAppManifest');
  expect(errors).toEqual([]);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});

test('sharing text, a link and a file posts to the service worker and becomes a capture', async ({
  page,
}) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  // What Android's share sheet sends: a multipart POST to the manifest's share_target action
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = 'share-target';
    form.enctype = 'multipart/form-data';
    for (const [name, value] of [
      ['title', 'A page'],
      ['text', '{"shared": true}'],
      ['url', 'https://example.com/page'],
    ]) {
      const input = document.createElement('input');
      input.name = name ?? '';
      input.value = value ?? '';
      form.append(input);
    }
    const files = document.createElement('input');
    files.type = 'file';
    files.name = 'files';
    files.id = 'share-files';
    files.multiple = true;
    form.append(files);
    document.body.append(form);
  });
  await page.setInputFiles('#share-files', [
    { name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from('id,name\n1,Ada\n2,Linus\n') },
  ]);
  await page.evaluate(() => document.querySelector('form')?.submit());

  // Redirected back to the app, which drops ?share= once it has ingested the share
  await expect(page.getByTestId('capture-count')).toHaveText('share · 3 items');
  await expect(page).toHaveURL(/\/$/);
  const entries = page.getByTestId('entry');
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText('{"shared": true}');
  await expect(entries.nth(1)).toContainText('https://example.com/page');
  await expect(entries.nth(2)).toContainText('people.csv');
  await expect(entries.nth(2).getByTestId('chip').first()).toHaveText('Records 2×2');
  await expect(page.getByTestId('json-tree')).toBeVisible();

  // The stash is emptied, so a reload doesn't add it again
  expect(
    await page.evaluate(async () => (await (await caches.open('clipbox-share')).keys()).length),
  ).toBe(0);
  await page.reload();
  await expect(page.getByTestId('capture')).toHaveCount(1);
});

test('the installed app starts offline from its start_url', async ({ page, context }) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  const manifest = await fetchManifest(page);

  await context.setOffline(true);
  await page.goto(manifest.start_url);
  await expect(page.getByRole('button', { name: 'Read clipboard' })).toBeVisible();
  // The manifest and icons come from the precache too
  const offline = await page.evaluate(
    async urls => Promise.all(urls.map(async u => (await fetch(u)).ok)),
    ['/manifest.webmanifest', ...manifest.icons.map(i => i.src)],
  );
  expect(offline.every(Boolean)).toBe(true);
});
