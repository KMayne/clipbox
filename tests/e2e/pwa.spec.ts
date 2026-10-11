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
