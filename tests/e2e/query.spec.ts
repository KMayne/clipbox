import { expect, test, type Page } from '@playwright/test';
import { actionsPane, paste } from './helpers';

/** The selected value's text, in the Text view's highlighting editor, checked line by line. */
async function expectRaw(page: Page, text: string) {
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Text' }).click();
  const editor = page.getByRole('region', { name: 'View' }).getByTestId('monaco-view');
  for (const line of text.split('\n')) await expect(editor).toContainText(line);
}

const derivedFrom = (page: Page) => page.getByTestId('capture').first().getByTestId('derived-from');

const PEOPLE = JSON.stringify([
  { name: 'Ada', age: 36, team: 'core' },
  { name: 'Linus', age: 54, team: 'kernel' },
  { name: 'Grace', age: 85, team: 'core' },
  { name: 'Tim', age: 30, team: 'web' },
]);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await paste(page, { 'text/plain': PEOPLE });
  await page.locator('[data-kind=json]').click();
});

test('runs a jq select/map filter in the jq module', async ({ page }) => {
  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'jq', exact: true }).click();
  const form = pane.getByRole('form', { name: 'jq settings' });
  await form
    .getByLabel('Filter')
    .fill('map(select(.age > 40) | {name, decade: (.age / 10 | floor)})');
  await form.getByLabel('Compact (-c)').check();
  await form.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  await expect(derivedFrom(page)).toContainText('jq map(select(.age > 40)');
  await expectRaw(page, '[{"name":"Linus","decade":5},{"name":"Grace","decade":8}]');

  // jq's own error message comes back as the notice
  await pane.getByRole('button', { name: 'jq', exact: true }).click();
  await form.getByLabel('Filter').fill('.[] | foo(');
  await form.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText(/jq failed: jq: error: syntax error/)).toBeVisible();
  await expect(page.getByTestId('capture')).toHaveCount(2);
});

test('groups an array of objects into a summary table', async ({ page }) => {
  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Group by' }).click();
  const form = pane.getByRole('form', { name: 'Group by settings' });
  await form.getByLabel(/^Field/).fill('nope');
  await form.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText('No field "nope" (fields: name, age, team)')).toBeVisible();

  await form.getByLabel(/^Field/).fill('team');
  await form.getByLabel('Aggregates').fill('avg:age, max:name');
  await form.getByLabel('Sort groups').selectOption('countDesc');
  await form.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  await expect(derivedFrom(page)).toContainText('Group by team (summary table)');
  // An array of objects: it opens as records too
  await expect(page.getByTestId('capture').first().locator('[data-kind=records]')).toBeVisible();
  await page.getByTestId('capture').first().locator('[data-kind=json]').click();
  await expectRaw(
    page,
    [
      '"team": "core",',
      '"count": 2,',
      '"avg_age": 60.5,',
      '"max_name": "Grace"',
      '"team": "kernel",',
      '"team": "web",',
    ].join('\n'),
  );
});
