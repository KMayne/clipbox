import { expect, test } from '@playwright/test';
import { MASTER, MEDIA_VOD } from '../fixtures/playlists';
import { actionsPane, paste, stat } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a pasted master playlist shows its variants by bandwidth, then renditions', async ({
  page,
}) => {
  await paste(page, { 'text/plain': MASTER });
  const chip = page.locator('[data-kind=playlist]');
  await expect(chip).toHaveText('HLS master · 3 variants · up to 1080p');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('2'); // Playlist
  const view = page.getByTestId('playlist-view');
  await expect(view.getByTestId('playlist-facts')).toContainText('Highest1080p · 5.00 Mbps');
  const rows = view.getByTestId('records-table');
  await expect(rows).toContainText('1080p/index.m3u8');
  // Highest bandwidth first
  const text = (await rows.textContent()) ?? '';
  expect(text.indexOf('1080p/index.m3u8')).toBeLessThan(text.indexOf('720p/index.m3u8'));
  expect(text.indexOf('720p/index.m3u8')).toBeLessThan(text.indexOf('360p/index.m3u8'));

  await view.getByRole('tab', { name: /Renditions/ }).click();
  await expect(view.getByTestId('records-table')).toContainText('Français, VF');
  await expect(stat(page, 'Variants')).toHaveText('3');
});

test('a pasted media playlist shows its segments, label and actions', async ({ page }) => {
  await paste(page, { 'text/plain': MEDIA_VOD });
  await expect(page.locator('[data-kind=playlist]')).toHaveText(
    'HLS media · 3 segments · 0:17 · VOD',
  );
  await page.keyboard.press('2'); // Playlist
  const view = page.getByTestId('playlist-view');
  const facts = view.getByTestId('playlist-facts');
  await expect(facts).toContainText('Playlist typeVOD');
  await expect(facts).toContainText('EncryptionAES-128 · 2 segments');
  await expect(facts).toContainText('Discontinuities1');
  const table = view.getByTestId('records-table');
  await expect(table).toContainText('seg100.m4s');
  await expect(table).toContainText('https://other.example.com/ad.ts');

  const actions = actionsPane(page);
  await expect(actions.getByRole('button', { name: 'Segments as CSV' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Variants as JSON' })).toHaveCount(0);
});
