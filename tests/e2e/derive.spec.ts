import { expect, test } from '@playwright/test';
import { actionsPane, lastCopy, paste, recordClipboard, stat } from './helpers';

const b64url = (s: string) =>
  Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const jwt = (payload: object) =>
  `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.${b64url('not-a-real-signature-0123456789!')}`;

const now = () => Math.floor(Date.now() / 1000);

test.beforeEach(async ({ page }) => {
  await recordClipboard(page);
  await page.goto('/');
});

test('base64 copies a decoded image as PNG and other binary as its base64', async ({ page }) => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  await paste(page, { 'text/plain': png });
  await expect(page.locator('[data-kind=base64]')).toHaveText('Base64 · PNG · 70 B');
  const copy = page.getByRole('button', { name: 'Copy' });
  await copy.click();
  await expect
    .poll(() => lastCopy(page))
    .toEqual({ 'image/png': '70 bytes: 89 50 4e 47 0d 0a 1a 0a' });

  const random = Buffer.from(Array.from({ length: 48 }, (_, i) => (i * 97 + 13) % 256)).toString(
    'base64',
  );
  await paste(page, { 'text/plain': random });
  await expect(page.locator('[data-kind=base64]').first()).toHaveText('Base64 · binary · 48 B');
  await copy.click();
  await expect.poll(() => lastCopy(page)).toEqual({ 'text/plain': random });
});

test('base64 JSON opens as a derived capture via Open as → Decode', async ({ page }) => {
  const json = '{"user":"ada","roles":["admin","dev"]}';
  await paste(page, { 'text/plain': Buffer.from(json).toString('base64') });

  const chip = page.locator('[data-kind=base64]');
  await expect(chip).toHaveText(`Base64 · JSON · ${json.length} B`);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  await actionsPane(page).getByRole('button', { name: 'Decode' }).click();

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

test('command palette runs a derivation', async ({ page }) => {
  await paste(page, { 'text/plain': 'name,age\nAda,36\nLinus,54\nGrace,85' });
  await expect(page.locator('[data-kind=records]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('As JSON');
  await expect(page.getByRole('option').first()).toHaveText('Open: As JSON');
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

  await expect(stat(page, 'Status')).toHaveText('valid');
  await expect(stat(page, 'Verification')).toHaveText('Signature not verified');

  await paste(page, { 'text/plain': jwt({ sub: 'old', exp: now() - 3 * 86400 - 60 }) });
  await expect(page.locator('[data-kind=jwt]').first()).toHaveText('JWT · HS256 · expired 3d ago');
  await page.keyboard.press('1');
  await expect(page.getByTestId('jwt-status')).toHaveText('Expired 3 days ago');
});
