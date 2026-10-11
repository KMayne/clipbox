import { expect, test, type Page } from '@playwright/test';
import { actionsPane, paste } from './helpers';

const derivedFrom = (page: Page) => page.getByTestId('capture').first().getByTestId('derived-from');
/** The selected value's text, in the Text view's editor. */
const rawView = async (page: Page) => {
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Text' }).click();
  return page.getByRole('region', { name: 'View' }).getByTestId('monaco-view');
};

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
const segment = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function signed(alg: string, key: CryptoKey, params: AlgorithmIdentifier | EcdsaParams) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${segment({ alg, typ: 'JWT' })}.${segment({ sub: 'e2e', iat: now, exp: now + 7200 })}`;
  const sig = await crypto.subtle.sign(params, key, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

const spkiPem = async (key: CryptoKey) => {
  const b64 = Buffer.from(await crypto.subtle.exportKey('spki', key)).toString('base64');
  return `-----BEGIN PUBLIC KEY-----\n${(b64.match(/.{1,64}/g) ?? []).join('\n')}\n-----END PUBLIC KEY-----`;
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('Open in new tab opens the URL without adding a capture', async ({ page, context }) => {
  await context.route('https://example.com/**', route =>
    route.fulfill({ contentType: 'text/html', body: '<title>Example</title>' }),
  );
  await paste(page, { 'text/plain': 'https://example.com/docs?utm_source=x&id=7' });
  await expect(page.locator('[data-kind=url]')).toHaveAttribute('aria-pressed', 'true');

  const popup = context.waitForEvent('page');
  await actionsPane(page).getByRole('button', { name: 'Open in new tab' }).click();
  const tab = await popup;
  await expect(tab).toHaveURL('https://example.com/docs?utm_source=x&id=7');
  // noopener: the new tab can't reach back into Clipbox
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  await expect(page.getByTestId('capture')).toHaveCount(1);

  // Strip tracking params does make a capture
  await actionsPane(page).getByRole('button', { name: 'Strip tracking params' }).click();
  await actionsPane(page)
    .getByRole('form', { name: 'Strip tracking params settings' })
    .getByRole('button', { name: 'Run' })
    .click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  await expect(await rawView(page)).toContainText('https://example.com/docs?id=7');
});

const ALGS: [string, () => Promise<CryptoKeyPair>, AlgorithmIdentifier | EcdsaParams][] = [
  [
    'ES256',
    () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']),
    { name: 'ECDSA', hash: 'SHA-256' },
  ],
  [
    'EdDSA',
    async () => {
      const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign']);
      if (!('privateKey' in keys)) throw new Error('expected a key pair');
      return keys;
    },
    'Ed25519',
  ],
];

for (const [alg, generate, params] of ALGS) {
  test(`verifies a ${alg} JWT with crypto.subtle in the browser`, async ({ page }) => {
    const keys = await generate();
    const token = await signed(alg, keys.privateKey, params);
    const pem = await spkiPem(keys.publicKey);

    await paste(page, { 'text/plain': token });
    await expect(page.locator('[data-kind=jwt]')).toHaveAttribute('aria-pressed', 'true');
    const pane = actionsPane(page);
    await pane.getByRole('button', { name: 'Verify signature' }).click();
    const form = pane.getByRole('form', { name: 'Verify signature settings' });
    const key = form.getByRole('textbox', { name: /^Key/ });
    await expect(key).toHaveAttribute('autocomplete', 'off');
    await key.fill(pem);
    await form.getByRole('button', { name: 'Run' }).click();

    await expect(page.getByTestId('capture')).toHaveCount(2);
    await expect(derivedFrom(page)).toContainText('› Verify signature');
    await expect(derivedFrom(page)).not.toContainText('BEGIN');
    const raw = await rawView(page);
    await expect(raw).toContainText(`Signature valid (${alg}) · expires in`);
    await expect(raw).toContainText('Key:        PEM public key');
    await expect(raw).not.toContainText('BEGIN PUBLIC KEY');
  });
}
