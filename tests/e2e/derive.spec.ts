import { expect, test } from '@playwright/test';
import { paste, stat } from './helpers';

const b64url = (s: string) =>
  Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const jwt = (payload: object) =>
  `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.${b64url('not-a-real-signature-0123456789!')}`;

const now = () => Math.floor(Date.now() / 1000);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('base64 JSON opens as a derived capture via Open as → Decode', async ({ page }) => {
  const json = '{"user":"ada","roles":["admin","dev"]}';
  await paste(page, { 'text/plain': Buffer.from(json).toString('base64') });

  const chip = page.locator('[data-kind=base64]');
  await expect(chip).toHaveText(`Base64 · JSON · ${json.length} B`);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Open as' }).click();
  await page.getByRole('menuitem', { name: 'Decode' }).click();

  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toHaveText(
    `from Base64 · JSON · ${json.length} B › Decode`,
  );
  const jsonChip = derived.locator('[data-kind=json]');
  await expect(jsonChip).toHaveText('JSON object · 2 keys');
  await expect(jsonChip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('json-tree')).toContainText('user');

  // Clicking the "from" text selects the parent again
  await derived.getByTestId('derived-from').click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
});

test('command palette opens the Open as menu', async ({ page }) => {
  await paste(page, { 'text/plain': 'name,age\nAda,36\nLinus,54\nGrace,85' });
  await expect(page.locator('[data-kind=records]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Open as');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'As JSON' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('capture').first().locator('[data-kind=json]')).toHaveText(
    'JSON array · 3',
  );
});

test('JWT shows claims and expiry', async ({ page }) => {
  await paste(page, {
    'text/plain': jwt({ sub: 'user-1', iss: 'clipbox-test', iat: now(), exp: now() + 7200 }),
  });
  const chip = page.locator('[data-kind=jwt]');
  await expect(chip).toHaveText(/^JWT · HS256 · expires in (1|2)h$/);
  await expect(page.getByTestId('jwt-status')).toHaveText(/^Valid · expires in/);
  const claims = page.getByTestId('jwt-claims');
  await expect(claims).toContainText('user-1');
  await expect(claims).toContainText('clipbox-test');
  await expect(claims).toContainText(/exp.*in (1|2) hours?/);

  await page.keyboard.press('2');
  await expect(stat(page, 'Status')).toHaveText('valid');
  await expect(stat(page, 'Verification')).toHaveText('Signature not verified');

  await paste(page, { 'text/plain': jwt({ sub: 'old', exp: now() - 3 * 86400 - 60 }) });
  await expect(page.locator('[data-kind=jwt]').first()).toHaveText('JWT · HS256 · expired 3d ago');
  await page.keyboard.press('1');
  await expect(page.getByTestId('jwt-status')).toHaveText('Expired 3 days ago');
});
