import { expect, test } from '@playwright/test';
import { paste } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('the Pastes heading pastes from the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('{"from":"the clipboard"}'));
  const tools = page.getByRole('toolbar', { name: 'Pastes' });
  await expect(tools.getByRole('button', { name: 'Clear all' })).toBeDisabled();
  await tools.getByRole('button', { name: 'Read clipboard' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(1);
  // The top bar no longer has them
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Read clipboard' }),
  ).toHaveCount(0);
});

test('Clear all asks first, from the heading and from the palette', async ({ page }) => {
  await paste(page, { 'text/plain': 'one' });
  await paste(page, { 'text/plain': 'two' });
  const tools = page.getByRole('toolbar', { name: 'Pastes' });
  const dialog = page.getByRole('alertdialog', { name: 'Clear all pastes?' });

  await tools.getByRole('button', { name: 'Clear all' }).click();
  await expect(dialog).toContainText('all 2 pastes');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('capture')).toHaveCount(2);

  await page.keyboard.press('Control+k');
  await page.keyboard.type('clear all');
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(0);
});

test('Pastes collapses with P or the top bar toggle, and is remembered', async ({ page }) => {
  const pastes = page.getByRole('region', { name: 'Pastes' });
  const toggle = page.getByRole('banner').getByRole('button', { name: 'Pastes panel' });
  await expect(pastes).toBeVisible();
  await page.keyboard.press('p');
  await expect(pastes).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(pastes).toBeHidden();
  await toggle.click();
  await expect(pastes).toBeVisible();
});

test('the footer has the source and site links; shortcuts live in the sidebar', async ({
  page,
}) => {
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: /Source/ })).toHaveAttribute(
    'href',
    'https://github.com/KMayne/clipbox',
  );
  await expect(footer.getByRole('link', { name: /KianMayne\.co\.uk/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pastes' }).getByRole('link')).toHaveCount(0);

  await expect(page.getByRole('banner').getByText('Ctrl+V')).toHaveCount(0);
  const shortcuts = page.getByRole('region', { name: 'Shortcuts' });
  await shortcuts.getByRole('button', { name: 'SHORTCUTS' }).click();
  await expect(shortcuts.getByTestId('shortcuts')).toContainText('Ctrl+K');
  await expect(shortcuts.getByTestId('shortcuts')).toContainText('Show / hide Pastes');
});
