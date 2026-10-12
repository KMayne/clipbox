import { expect, test } from '@playwright/test';
import { sampleEml } from '../fixtures/email';
import { actionsPane, dropBytes, naturalSize, paste, stat } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a dropped .eml shows its headers, sandboxed HTML body and attachments', async ({ page }) => {
  await dropBytes(page, 'report.eml', 'message/rfc822', sampleEml());

  const chip = page.locator('[data-kind=email]');
  await expect(chip).toHaveText('Email · Quarterly report — final · 1 attachment');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  const view = page.getByTestId('email-view');
  const card = view.getByTestId('email-headers');
  await expect(card).toContainText('Quarterly report — final');
  await expect(card).toContainText('Alïce Example <alice@example.net>');
  await expect(card).toContainText('"Bob, the builder" <bob@example.org>');
  await expect(card).toContainText('2025-07-01 11:00:00 +01:00');
  await expect(card).toContainText('SPF pass (example.net)');
  await expect(view.getByTestId('email-blocked')).toContainText('1 remote image was blocked');

  // The body: sanitised HTML with the cid: image inlined as a data URL
  const body = page.frameLocator('iframe[title="Email body"]');
  await expect(body.locator('b')).toHaveText('Bob');
  await expect(body.locator('script')).toHaveCount(0);
  expect(await naturalSize(body.locator('img[alt=chart]'))).toEqual([4, 3]);

  await expect(stat(page, 'DKIM')).toHaveText('pass (example.net)');

  // A tile opens its attachment as a new capture
  const tile = view.getByTestId('email-attachment');
  await expect(tile).toHaveCount(1);
  await expect(tile).toContainText('Résumé 2025.pdf');
  await tile.click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toContainText('Résumé 2025.pdf');
  await expect(derived.locator('[data-kind=pdf]')).toHaveCount(1);
});

test('a pasted message is detected, and Attachments makes a capture', async ({ page }) => {
  await paste(page, { 'text/plain': new TextDecoder().decode(sampleEml()) });
  await expect(page.locator('[data-kind=email]')).toHaveAttribute('aria-pressed', 'true');

  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Attachments' }).click();
  const form = pane.getByRole('form', { name: 'Attachments settings' });
  await form.getByLabel('Include inline images').check();
  await form.getByRole('button', { name: 'Run' }).click();

  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toContainText('Attachments');
  await expect(derived).toContainText('part-5.png');
  await expect(derived).toContainText('Résumé 2025.pdf');
});
