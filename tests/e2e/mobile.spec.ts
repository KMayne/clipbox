import { devices, expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { samplePdf } from '../fixtures/pdf';
import { dropBytes, dropFile, paste } from './helpers';

/** Wider than any phone. */
const WIDE_PNG = path.resolve(import.meta.dirname, '../../vite/icons/icon-512.png');

// A phone: 412×839 CSS px, touch, mobile viewport
test.use({ ...devices['Pixel 7'] });

const JSON_TEXT = JSON.stringify({
  users: Array.from({ length: 5 }, (_, i) => ({
    id: i,
    name: `user${i}`,
    email: `someone.with.a.long.address${i}@example.com`,
    tags: ['alpha', 'beta', 'gamma', 'delta'],
  })),
});
const CSV = [
  'id,name,email,team,city,country,joined,score',
  ...Array.from(
    { length: 10 },
    (_, i) => `${i},user${i},user${i}@example.com,core,London,UK,2024-01-0${i % 9},${i * 7}`,
  ),
].join('\n');
const TS = 'export function greet(name: string): string {\n  return `hello ${name}`;\n}\n';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Panes' });
const tab = (page: Page, name: string) => nav(page).getByRole('button', { name });

async function expectPane(page: Page, name: 'Pastes' | 'Inspector' | 'Actions') {
  await expect(tab(page, name)).toHaveAttribute('aria-current', 'page');
}

/**
 * Nothing sticks out past the viewport's right edge, except inside a container that scrolls or
 * clips it (wide tables and code scroll within their pane, which is fine).
 */
async function expectNoHorizontalOverflow(page: Page) {
  const offenders = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const { overflowX } = getComputedStyle(p);
        if (overflowX !== 'visible' && p.getBoundingClientRect().right <= width + 1) return true;
      }
      return false;
    };
    const out: string[] = [];
    if (document.documentElement.scrollWidth > width)
      out.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${width}`);
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= width + 1 || clipped(el)) continue;
      const id = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? '';
      out.push(`${el.tagName.toLowerCase()}${id ? `[${id}]` : ''} right=${Math.round(r.right)}`);
    }
    return out.slice(0, 10);
  });
  expect(offenders).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('one pane at a time, switched with the bottom navigation', async ({ page }) => {
  await expectPane(page, 'Pastes');
  await expect(page.getByRole('region', { name: 'Pastes' })).toBeVisible();
  await expect(page.getByRole('separator')).toHaveCount(0);

  await tab(page, 'Inspector').tap();
  await expectPane(page, 'Inspector');
  await expect(page.getByRole('region', { name: 'Pastes' })).toHaveCount(0);

  await tab(page, 'Actions').tap();
  await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();

  // A new paste opens in the Inspector
  await paste(page, { 'text/plain': JSON_TEXT });
  await expectPane(page, 'Inspector');
  await expect(page.getByTestId('json-tree')).toBeVisible();

  // Choosing a paste does too
  await paste(page, { 'text/plain': CSV });
  await expect(page.getByTestId('records-table')).toBeVisible();
  await tab(page, 'Pastes').tap();
  await expect(tab(page, 'Pastes')).toContainText('2');
  // Older captures collapse when a new one arrives
  await page.getByTestId('capture').nth(1).getByRole('button', { name: 'Expand' }).tap();
  await page.locator('[data-kind=json]').tap();
  await expectPane(page, 'Inspector');
  await expect(page.getByTestId('json-tree')).toBeVisible();

  // Running an action goes to its result
  await tab(page, 'Actions').tap();
  await page.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Minify' }).tap();
  await expectPane(page, 'Inspector');
  await expect(page.getByTestId('json-tree')).toBeVisible();
  await tab(page, 'Pastes').tap();
  await expect(page.getByTestId('capture')).toHaveCount(3);
  await expect(page.getByTestId('capture').first()).toContainText('Minify');
});

test('touch targets are at least 40px', async ({ page }) => {
  await paste(page, { 'text/plain': JSON_TEXT });
  await tab(page, 'Pastes').tap();
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('header button, nav button, [data-testid=chip]')]
      .map(el => {
        const r = el.getBoundingClientRect();
        return { name: el.getAttribute('aria-label') ?? el.textContent, w: r.width, h: r.height };
      })
      .filter(b => b.h < 40 || b.w < 40),
  );
  expect(small).toEqual([]);
});

test('the top bar keeps Commands and Settings; Pastes has Paste, Open file and Clear all', async ({
  page,
}) => {
  const bar = page.getByRole('banner');
  for (const name of ['Commands', 'Settings'])
    await expect(bar.getByRole('button', { name })).toBeInViewport();
  const tools = page.getByRole('toolbar', { name: 'Pastes' });
  for (const name of ['Read clipboard', 'Open file', 'Clear all'])
    await expect(tools.getByRole('button', { name })).toBeInViewport();
  await expect(bar.getByText('Ctrl+V')).toHaveCount(0);

  await bar.getByRole('button', { name: 'Commands' }).tap();
  await expect(page.getByPlaceholder('Type a command…')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByText('Settings', { exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('Read clipboard pastes on a phone', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('{"from":"the clipboard"}'));
  // The empty Pastes pane offers it too; use the heading's
  await page
    .getByRole('toolbar', { name: 'Pastes' })
    .getByRole('button', { name: 'Read clipboard' })
    .tap();
  await expectPane(page, 'Inspector');
  await expect(page.getByTestId('json-tree')).toContainText('the clipboard');
  await tab(page, 'Pastes').tap();
  await expect(page.getByTestId('capture-count')).toHaveText(/^read · /);
});

for (const width of [360, 412]) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page);

    const views: [string, () => Promise<void>, string][] = [
      ['JSON', () => paste(page, { 'text/plain': JSON_TEXT }), 'json-tree'],
      ['records', () => paste(page, { 'text/plain': CSV }), 'records-table'],
      ['code', () => paste(page, { 'text/plain': TS }), 'monaco-view'],
      [
        'image',
        async () => dropBytes(page, 'wide.png', 'image/png', await readFile(WIDE_PNG)),
        'image-view',
      ],
      ['PDF', () => dropFile(page, 'sample.pdf', 'application/pdf', samplePdf()), 'pdf-page'],
    ];
    for (const [name, add, testId] of views) {
      await test.step(name, async () => {
        await add();
        await expectPane(page, 'Inspector');
        await expect(page.getByTestId(testId).first()).toBeVisible();
        await expectNoHorizontalOverflow(page);
        if (name === 'image') {
          // Actual size scrolls within the preview
          await page.getByRole('button', { name: '1:1' }).tap();
          await expectNoHorizontalOverflow(page);
        }
      });
    }
    await tab(page, 'Pastes').tap();
    await expectNoHorizontalOverflow(page);
    await tab(page, 'Actions').tap();
    await expectNoHorizontalOverflow(page);
  });
}
