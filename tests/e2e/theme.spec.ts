import { expect, test } from '@playwright/test';
import { paste, savedCount } from './helpers';

const bodyBackground = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('defaults to Nord and switches scheme from Settings, keeping pastes', async ({ page }) => {
  await page.goto('/');
  expect(await bodyBackground(page)).toBe('rgb(46, 52, 64)'); // Nord #2e3440
  await paste(page, { 'text/plain': '{"kept":true}' });
  await expect(page.getByTestId('capture')).toHaveCount(1);
  await expect.poll(() => savedCount(page)).toBe(1); // saved before the reload

  await page.getByRole('button', { name: 'Settings' }).click();
  const schemes = page.getByRole('radiogroup', { name: 'Colour scheme' });
  await expect(schemes.getByRole('radio', { name: 'Nord' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await schemes.getByRole('radio', { name: 'Tokyo Night' }).click();

  // The page reloads with the new scheme, and the paste is restored from history
  await expect.poll(() => bodyBackground(page)).toBe('rgb(26, 27, 38)'); // Tokyo Night #1a1b26
  await expect(page.getByTestId('capture')).toHaveCount(1);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(
    page
      .getByRole('radiogroup', { name: 'Colour scheme' })
      .getByRole('radio', { name: 'Tokyo Night' }),
  ).toHaveAttribute('aria-checked', 'true');
});

test('?theme= previews a scheme without saving it', async ({ page }) => {
  await page.goto('/?theme=one-dark');
  expect(await bodyBackground(page)).toBe('rgb(40, 44, 52)'); // One Dark #282c34
  await page.goto('/');
  expect(await bodyBackground(page)).toBe('rgb(46, 52, 64)'); // back to Nord
});

const fontScale = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim(),
  );
const bodyFontSize = (page: import('@playwright/test').Page) =>
  page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));

test('text size defaults to 125% and changes from Settings, keeping pastes', async ({ page }) => {
  await page.goto('/');
  expect(await fontScale(page)).toBe('1.25');
  expect(await bodyFontSize(page)).toBeCloseTo(16.25); // 13px × 1.25
  await paste(page, { 'text/plain': '{"kept":true}' });
  await expect.poll(() => savedCount(page)).toBe(1);

  await page.getByRole('button', { name: 'Settings' }).click();
  const sizes = page.getByRole('radiogroup', { name: 'Text size' });
  await expect(sizes.getByRole('radio', { name: '125%' })).toHaveAttribute('aria-checked', 'true');
  await sizes.getByRole('radio', { name: '100%' }).click();

  // Reloads at the new size, with the paste restored
  await expect.poll(() => fontScale(page)).toBe('1');
  expect(await bodyFontSize(page)).toBe(13);
  await expect(page.getByTestId('capture')).toHaveCount(1);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(
    page.getByRole('radiogroup', { name: 'Text size' }).getByRole('radio', { name: '100%' }),
  ).toHaveAttribute('aria-checked', 'true');
});

test('?textScale= previews a text size without saving it', async ({ page }) => {
  await page.goto('/?textScale=1.5');
  expect(await fontScale(page)).toBe('1.5');
  await page.goto('/');
  expect(await fontScale(page)).toBe('1.25');
});
