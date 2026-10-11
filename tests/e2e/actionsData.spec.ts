import { expect, test, type Page } from '@playwright/test';
import { actionsPane, paste } from './helpers';

const derivedFrom = (page: Page) => page.getByTestId('capture').first().getByTestId('derived-from');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('CSV to SQL INSERTs with the table name setting', async ({ page }) => {
  await paste(page, { 'text/plain': "id,name\n1,O'Brien\n2,Lee\n3,\n" });
  await page.locator('[data-kind=records]').click();
  const pane = actionsPane(page);

  await pane.getByRole('button', { name: 'To SQL INSERTs' }).click();
  const form = pane.getByRole('form', { name: 'To SQL INSERTs settings' });
  await form.getByLabel('Table name').fill('people');
  await form.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  await expect(derivedFrom(page)).toContainText('SQL INSERTs into people (ANSI SQL)');
});

test('CSV to a Markdown table, detected as Markdown', async ({ page }) => {
  await paste(page, { 'text/plain': 'id,name\n1,a|b\n2,Lee\n3,Kim\n' });
  await page.locator('[data-kind=records]').click();
  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'To Markdown table' }).click();
  await pane
    .getByRole('form', { name: 'To Markdown table settings' })
    .getByRole('button', { name: 'Run' })
    .click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  await expect(page.getByTestId('capture').first().locator('[data-kind=markdown]')).toBeVisible();
});

test('NDJSON to JSON notes the skipped lines in the label', async ({ page }) => {
  const lines = Array.from({ length: 20 }, (_, i) => JSON.stringify({ i }));
  lines.splice(3, 0, '{oops');
  await paste(page, { 'text/plain': lines.join('\n') });
  await expect(page.locator('[data-kind=ndjson]')).toHaveAttribute('aria-pressed', 'true');
  await actionsPane(page).getByRole('button', { name: 'To JSON array' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  await expect(derivedFrom(page)).toContainText('To JSON array · 1 invalid line skipped');
  await expect(page.getByTestId('capture').first().locator('[data-kind=json]')).toBeVisible();
});
