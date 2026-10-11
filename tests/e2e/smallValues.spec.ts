import { expect, test } from '@playwright/test';
import { chain, selfSigned } from '../fixtures/certs';
import { paste, stat } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('epoch seconds become a timestamp with conversions', async ({ page }) => {
  await paste(page, { 'text/plain': '1700000000' });
  await expect(page.getByTestId('chip').first()).toHaveText('Timestamp · 2023-11-14 22:13:20 UTC');
  await expect(page.getByTestId('value-card')).toContainText('2023-11-14T22:13:20.000Z');
  await page.keyboard.press('2');
  await expect(stat(page, 'Detected as')).toHaveText('Unix seconds');
  await expect(stat(page, 'Unix milliseconds')).toHaveText('1700000000000');
  await expect(stat(page, 'Day of week (UTC)')).toHaveText('Tuesday');
});

test('UUID v7 shows its embedded time', async ({ page }) => {
  await paste(page, { 'text/plain': '017f22e2-79b0-7cc3-98c4-dc0c0c07398f' });
  await expect(page.getByTestId('chip').first()).toHaveText('UUID v7 · 2022-02-22 19:22:22 UTC');
  await expect(page.getByTestId('value-card')).toContainText('2022-02-22T19:22:22.000Z');
  await page.keyboard.press('2');
  await expect(stat(page, 'Version')).toHaveText('7 (Unix time-ordered)');
});

test('URL with a query shows a query table and a records interpretation', async ({ page }) => {
  await paste(page, { 'text/plain': 'https://example.com/search?q=clip%20box&page=2#top' });
  const chips = page.getByTestId('chip');
  await expect(chips).toHaveText(['URL · example.com', 'Records 2×2', /^Text/]);
  const table = page.getByTestId('value-card-table');
  await expect(table).toContainText('clip box');
  await expect(table).toContainText('page');

  await page.keyboard.press('2');
  await expect(stat(page, 'Query params')).toHaveText('2');
  await expect(stat(page, 'q')).toHaveText('clip box');

  await page.locator('[data-kind=records]').click();
  await page.keyboard.press('1');
  await expect(page.getByTestId('records-table')).toContainText('clip box');
});

test('colour shows a swatch and contrast', async ({ page }) => {
  await paste(page, { 'text/plain': 'hsl(210, 50%, 40%)' });
  await expect(page.getByTestId('chip').first()).toHaveText('Colour · #336699');
  await expect(page.getByTestId('value-card')).toContainText('rgb(51, 102, 153)');
  await page.keyboard.press('2');
  await expect(stat(page, 'Contrast vs white')).toHaveText('6.00:1 (AA)');
});

test('certificate gets a PEM chip, a card and an expiry badge', async ({ page }) => {
  const pem = await selfSigned('soon.example', 12, ['soon.example']);
  await paste(page, { 'text/plain': pem });
  await expect(page.getByTestId('chip').first()).toHaveText(
    'PEM · certificate · CN=soon.example · expires in 12d',
  );
  const card = page.getByTestId('pem-card');
  await expect(card).toContainText('DNS:soon.example');
  await expect(card).toContainText('RSA 2048-bit');
  const badge = card.getByTestId('expiry-badge');
  await expect(badge).toHaveText('expires in 12d');
  await expect(badge).toHaveAttribute('data-tone', 'expiring');
});

test('chain renders leaf first with an expired badge', async ({ page }) => {
  await paste(page, { 'text/plain': await chain() });
  const cards = page.getByTestId('pem-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('CN=leaf.example');
  await expect(cards.first().getByTestId('expiry-badge')).toHaveAttribute('data-tone', 'expired');
  await expect(cards.nth(1).getByTestId('expiry-badge')).toHaveAttribute('data-tone', 'valid');
});

test('a saved per-module Off policy from older versions is ignored and removed', async ({
  page,
}) => {
  await page.evaluate(() =>
    localStorage.setItem('clipbox.modules', JSON.stringify({ x509: 'off' })),
  );
  await page.reload();
  await paste(page, { 'text/plain': await selfSigned('off.example', 100) });
  await expect(page.locator('[data-kind=pem]')).toContainText('CN=off.example');
  expect(await page.evaluate(() => localStorage.getItem('clipbox.modules'))).toBeNull();
});
