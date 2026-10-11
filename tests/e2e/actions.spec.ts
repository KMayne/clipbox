import { expect, test, type Page } from '@playwright/test';
import { actionsPane, paste } from './helpers';

/** The selected value's raw text (Raw tab). */
async function expectRaw(page: Page, text: string) {
  await page.getByRole('tab', { name: 'raw' }).click();
  await expect(page.getByRole('tabpanel').locator('pre')).toHaveText(text);
}

const derivedFrom = (page: Page) => page.getByTestId('capture').first().getByTestId('derived-from');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('runs Format from the sidebar as a new derived capture', async ({ page }) => {
  await paste(page, { 'text/plain': '{"b":1,"a":[1,2]}' });
  await expect(page.locator('[data-kind=json]')).toHaveAttribute('aria-pressed', 'true');
  const pane = actionsPane(page);

  // An action with settings expands its form; Run uses them
  await pane.getByRole('button', { name: 'Format', exact: true }).click();
  const form = pane.getByRole('form', { name: 'Format settings' });
  await expect(form.getByLabel('Indent')).toBeFocused();
  await form.getByLabel('Indent').selectOption('4');
  await form.getByRole('button', { name: 'Run' }).click();

  await expect(page.getByTestId('capture')).toHaveCount(2);
  await expect(derivedFrom(page)).toHaveText('from JSON object · 2 keys › Format (4 spaces)');
  const chip = page.getByTestId('capture').first().locator('[data-kind=json]');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expectRaw(page, '{\n    "b": 1,\n    "a": [\n        1,\n        2\n    ]\n}');

  // One without settings runs straight away
  await pane.getByRole('button', { name: 'Minify' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(3);
  await expect(derivedFrom(page)).toHaveText('from JSON object · 2 keys › Minify');
  await expectRaw(page, '{"b":1,"a":[1,2]}');
});

test('Find & replace takes its settings from the form', async ({ page }) => {
  await paste(page, { 'text/plain': 'hello world\nhello there' });
  await page.locator('[data-kind=text]').click();
  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Find & replace' }).click();
  const form = pane.getByRole('form', { name: 'Find & replace settings' });
  await form.getByLabel('Find').fill('hel+o');
  await form.getByLabel('Replace with').fill('bye');
  await form.getByLabel('Regular expression').check();
  await form.getByLabel('Replace with').press('Enter');

  await expect(page.getByTestId('capture')).toHaveCount(2);
  await expect(derivedFrom(page)).toHaveText('from Text · 2 lines › Find & replace /hel+o/ → bye');
  await expectRaw(page, 'bye world\nbye there');

  // Errors go to the notice, and no capture is added
  await pane.getByRole('button', { name: 'Find & replace' }).click();
  await form.getByLabel('Find').fill('(');
  await form.getByLabel('Regular expression').check();
  await form.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText(/Find & replace failed: Invalid regular expression/)).toBeVisible();
  await expect(page.getByTestId('capture')).toHaveCount(2);
});

test('runs actions from the command palette', async ({ page }) => {
  await paste(page, { 'text/plain': '{"b":1,"a":2}' });
  await expect(page.locator('[data-kind=json]')).toHaveAttribute('aria-pressed', 'true');

  // With settings: opens the sidebar form, focused, and Enter runs it
  await page.keyboard.press('a');
  await expect(actionsPane(page)).toBeHidden();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Format');
  await expect(page.getByRole('option').first()).toHaveText('Format: Format…');
  await page.keyboard.press('Enter');
  const indent = actionsPane(page).getByLabel('Indent');
  await expect(indent).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(derivedFrom(page)).toHaveText('from JSON object · 2 keys › Format (2 spaces)');

  // Without settings: runs directly
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Sort keys');
  await expect(page.getByRole('option').first()).toHaveText('Format: Sort keys');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('capture')).toHaveCount(3);
  await expect(derivedFrom(page)).toHaveText('from JSON object · 2 keys › Sort keys');
  await expectRaw(page, '{\n  "a": 2,\n  "b": 1\n}');
});

test('the sidebar toggles with A and lists only actions that fit the kind', async ({ page }) => {
  await paste(page, { 'text/plain': 'some plain words\nanother line' });
  await page.locator('[data-kind=text]').click();
  const pane = actionsPane(page);
  await expect(pane.getByRole('button', { name: 'Change case' })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Hash' })).toBeVisible();
  // No JSON or image actions for text
  await expect(pane.getByRole('button', { name: 'Minify' })).toHaveCount(0);
  await expect(pane.getByRole('button', { name: 'Convert' })).toHaveCount(0);

  // The filter narrows by title or group
  await pane.getByLabel('Filter actions').fill('lines');
  await expect(pane.getByRole('button', { name: 'Sort lines' })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Change case' })).toHaveCount(0);
  await pane.getByLabel('Filter actions').press('Escape');

  await page.keyboard.press('a');
  await expect(pane).toBeHidden();
  // Remembered across reloads
  await page.reload();
  await expect(page.getByRole('button', { name: 'Read clipboard' })).toBeVisible();
  await expect(pane).toBeHidden();
  await page.keyboard.press('a');
  await expect(pane).toBeVisible();
});

test('converts an image to WebP', async ({ page }) => {
  // A 2×1 PNG drawn in the page, pasted as a file
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(2, 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#f00';
    ctx.fillRect(0, 0, 1, 1);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'dot.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await expect(page.locator('[data-kind=image]')).toHaveText(/PNG 2×1/);

  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Convert' }).click();
  const form = pane.getByRole('form', { name: 'Convert settings' });
  await expect(form.getByLabel('Format')).toHaveValue('webp');
  await form.getByRole('button', { name: 'Run' }).click();

  await expect(derivedFrom(page)).toHaveText('from PNG 2×1 › Convert to WebP (90%)');
  const chip = page.getByTestId('capture').first().locator('[data-kind=image]');
  await expect(chip).toHaveText(/WEBP 2×1/);
  await expect(page.getByTestId('capture').first().getByTestId('entry')).toHaveAttribute(
    'data-mime',
    'image/webp',
  );
});
