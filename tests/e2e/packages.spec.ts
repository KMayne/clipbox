import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { crx3, sampleRpm, zipOf } from '../fixtures/packages';
import { dropBytes } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const classFile = (major: number) => new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, major]);

test('a CRX shows its manifest card with risky permissions flagged', async ({ page }) => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const der = new Uint8Array(publicKey.export({ type: 'spki', format: 'der' }));
  const digest = createHash('sha256').update(der).digest();
  const zip = zipOf({
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'Tab Tamer',
      version: '1.4.0',
      permissions: ['storage', 'debugger'],
      host_permissions: ['<all_urls>'],
      background: { service_worker: 'bg.js' },
    }),
    'bg.js': 'chrome.runtime.onInstalled.addListener(() => {});',
  });
  await dropBytes(
    page,
    'tamer.crx',
    'application/x-chrome-extension',
    crx3(zip, der, digest.subarray(0, 16)),
  );

  await expect(page.locator('[data-kind=archive]')).toHaveText(
    'Chrome extension · MV3 · 3 permissions',
  );
  const card = page.getByTestId('package-card');
  await expect(card).toContainText('Tab Tamer');
  await expect(card).toContainText('1.4.0');
  await expect(card).toContainText('service worker: bg.js');
  await expect(card.getByTestId('package-warnings')).toContainText('Requests debugger');
  await expect(card.locator('[data-flagged=true]')).toHaveText([/debugger/, /<all_urls>/]);
  // The file table still lists the zip behind the header
  await expect(page.getByTestId('archive-row')).toHaveCount(2);
});

test('a JAR shows its manifest card and Java target', async ({ page }) => {
  const jar = zipOf({
    'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\nMain-Class: app.Main\nCreated-By: 17.0.2\n\n',
    'app/Main.class': classFile(61),
    'app/Util.class': classFile(52),
  });
  await dropBytes(page, 'app.jar', 'application/java-archive', jar);
  await expect(page.locator('[data-kind=archive]')).toHaveText(
    'Java archive · 2 classes · Java 17',
  );
  const card = page.getByTestId('package-card');
  await expect(card).toContainText('Main-Class');
  await expect(card).toContainText('app.Main');
  await expect(card).toContainText('Java 17');
});

test('an RPM lists from its header and extracts from the gzip payload', async ({ page }) => {
  await dropBytes(page, 'hello.rpm', 'application/x-rpm', sampleRpm());
  await expect(page.locator('[data-kind=archive]')).toHaveText(
    'RPM · hello-1.0-1.el9.x86_64 · 2 files',
  );
  const card = page.getByTestId('package-card');
  await expect(card).toContainText('glibc >= 2.34');
  await expect(card.getByTestId('package-warnings')).toContainText('Has 3 scriptlets');
  await expect(card).toContainText('groupadd hello');

  const table = page.getByTestId('archive-table');
  await expect(table.getByTestId('archive-row')).toHaveCount(3);
  await table.getByRole('button', { name: 'Open usr/share/hello/README' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toContainText('README');
  await expect(derived).toContainText('Hello from the RPM payload.');
});

test('an xz-payload RPM extracts through the libarchive module', async ({ page }) => {
  const bytes = readFileSync(new URL('../fixtures/archives/hello-xz.rpm', import.meta.url));
  await dropBytes(page, 'hello-xz.rpm', 'application/x-rpm', bytes);
  await expect(page.locator('[data-kind=archive]')).toHaveText(
    'RPM · hello-xz-1.0-1.el9.x86_64 · 2 files',
  );
  const table = page.getByTestId('archive-table');
  await table.getByRole('button', { name: 'Open usr/bin/hello' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toContainText('usr/bin/hello');
  await expect(derived).toContainText('echo hello');
});
