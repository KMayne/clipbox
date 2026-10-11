import { expect, test, type Page } from '@playwright/test';
import { dropFile, paste, stat } from './helpers';

const USERS = JSON.stringify(
  Array.from({ length: 42 }, (_, i) => ({
    id: i,
    name: `user${i}`,
    team: i % 3 ? 'core' : 'infra',
  })),
);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('paste shows every format with interpretations and stats', async ({ page }) => {
  await paste(page, { 'text/plain': USERS, 'text/html': `<pre>${USERS}</pre>` });

  await expect(page.getByTestId('entry')).toHaveCount(2);
  const plain = page.locator('[data-testid=entry][data-mime="text/plain"]');
  await expect(plain.getByTestId('chip')).toHaveText([
    'JSON array · 42',
    'Records 42×3',
    'JSON · 1 line',
  ]);
  await expect(
    page.locator('[data-testid=entry][data-mime="text/html"]').getByTestId('chip'),
  ).toHaveText([/^HTML/, /^Text/]);

  // Best interpretation auto-selected
  await expect(plain.locator('[data-kind=json]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('json-tree')).toContainText('{ id, name, team }');

  await page.keyboard.press('2');
  await expect(stat(page, 'Top-level type')).toHaveText('array');
  await expect(stat(page, 'Length')).toHaveText('42');

  await page.keyboard.press('3');
  await expect(page.getByRole('tabpanel')).toContainText('id: number;');
});

test('records interpretation renders a table', async ({ page }) => {
  await paste(page, { 'text/plain': 'name\tage\nAda\t36\nLinus\t54\nGrace\t85' });
  await expect(page.getByTestId('chip').first()).toHaveText('Records 3×2');
  await expect(page.getByTestId('records-table')).toContainText('Grace');
});

test('dropped CSV file becomes records', async ({ page }) => {
  await dropFile(page, 'people.csv', 'text/csv', 'id,name\n1,Ada\n2,Linus\n3,Grace\n');
  await expect(page.getByTestId('entry')).toContainText('people.csv');
  await expect(page.getByTestId('chip').first()).toHaveText('Records 3×2');
  await expect(page.getByTestId('capture')).toContainText('drop');
});

/** Records off-origin requests: Playwright reports CSP-blocked ones too, as failures with 'csp'. */
function watchNetwork(page: Page) {
  const leaked: string[] = [];
  const blocked: string[] = [];
  page.on('requestfinished', r => {
    if (!r.url().startsWith('http://localhost')) leaked.push(r.url());
  });
  page.on('requestfailed', r => {
    if (r.failure()?.errorText === 'csp') blocked.push(r.url());
    else if (!r.url().startsWith('http://localhost')) leaked.push(r.url());
  });
  return { leaked, blocked };
}

test('HTML preview blocks all network requests', async ({ page }) => {
  const { leaked, blocked } = watchNetwork(page);
  await paste(page, {
    'text/html':
      '<p>hi</p><img src="https://example.com/pixel.png"><link rel="stylesheet" href="https://example.com/x.css">',
  });
  await expect(page.locator('iframe[title="HTML preview"]')).toBeVisible();
  await expect.poll(() => blocked.length).toBe(2);
  expect(leaked).toEqual([]);
});

test('Markdown preview blocks remote images', async ({ page }) => {
  const { leaked, blocked } = watchNetwork(page);
  await paste(page, {
    'text/plain': '# Tracked\n\n![pixel](https://example.com/md-pixel.png)\n\n- [x] done\n',
  });
  await expect(page.getByTestId('chip').first()).toHaveText(/^Markdown/);
  await expect(page.locator('iframe[title="Markdown preview"]')).toBeVisible();
  await expect.poll(() => blocked).toEqual(['https://example.com/md-pixel.png']);
  expect(leaked).toEqual([]);
});

const README = `# Clipbox

Paste **anything**, then [read the docs](https://example.com).

## Install

- pnpm install
- pnpm dev
`;

test('Markdown renders and toggles to source', async ({ page }) => {
  await paste(page, { 'text/plain': README });
  const chip = page.locator('[data-kind=markdown]');
  await expect(chip).toHaveText(/^Markdown · 2 headings · \d+ words$/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const frame = page.frameLocator('iframe[title="Markdown preview"]');
  await expect(frame.locator('h1')).toHaveText('Clipbox');
  await expect(frame.locator('li')).toHaveCount(2);

  await page.getByRole('button', { name: 'Source' }).click();
  await expect(page.getByTestId('monaco-view')).toContainText('# Clipbox');

  await page.keyboard.press('2');
  await expect(stat(page, 'Headings')).toHaveText('2');
});

test('NDJSON shows a tree and records', async ({ page }) => {
  const ndjson = Array.from({ length: 3 }, (_, i) =>
    JSON.stringify({ id: i, name: `user${i}` }),
  ).join('\n');
  await paste(page, { 'text/plain': ndjson });
  const chips = page.getByTestId('chip');
  await expect(chips.nth(0)).toHaveText('NDJSON · 3 lines');
  await expect(chips.nth(1)).toHaveText('Records 3×2');
  await expect(page.getByTestId('json-tree')).toContainText('{ id, name }');

  await page.locator('[data-kind=records]').click();
  await expect(page.getByTestId('records-table')).toContainText('user2');
  await page.keyboard.press('2');
  await expect(stat(page, 'Source')).toHaveText('NDJSON');
});

test('j/k move between chips and Delete removes the capture', async ({ page }) => {
  await paste(page, { 'text/plain': USERS });
  await expect(page.locator('[data-kind=json]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('j');
  await expect(page.locator('[data-kind=records]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('capture')).toHaveCount(0);
});

test('command palette runs commands', async ({ page }) => {
  await paste(page, { 'text/plain': 'hello' });
  await page.keyboard.press('Control+k');
  await page.keyboard.type('stats');
  await page.keyboard.press('Enter');
  await expect(stat(page, 'Words')).toHaveText('1');
});

test('large paste keeps the UI responsive', async ({ page }) => {
  const maxGap = await page.evaluate(async () => {
    const rows = Array.from({ length: 200_000 }, (_, i) => ({
      id: i,
      name: `user ${i}`,
      email: `user${i}@example.com`,
      active: i % 2 === 0,
    }));
    const json = JSON.stringify(rows);
    let last = performance.now();
    let maxGap = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 10);
    const dt = new DataTransfer();
    dt.setData('text/plain', json);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    await new Promise<void>(resolve => {
      const check = () =>
        document.querySelector('[data-testid=json-tree]') ? resolve() : setTimeout(check, 20);
      check();
    });
    clearInterval(timer);
    return maxGap;
  });
  console.log(`max main-thread gap during 200k-row paste: ${Math.round(maxGap)}ms`);
  await expect(page.locator('[data-kind=json]')).toHaveText('JSON array · 200,000');
  expect(maxGap).toBeLessThan(250);
});

test('YAML paste shows a chip and a JSON tree', async ({ page }) => {
  await paste(page, {
    'text/plain':
      'name: clipbox\nversion: 3\nservers:\n  - host: a.example.com\n  - host: b.example.com\n',
  });
  await expect(page.getByTestId('chip').first()).toHaveText('YAML · mapping · 3 keys');
  await expect(page.getByTestId('json-tree')).toContainText('servers');
});

test('XML paste shows a chip and a JSON tree', async ({ page }) => {
  await paste(page, {
    'text/plain': '<?xml version="1.0"?>\n<feed><entry id="1"><title>One</title></entry></feed>',
  });
  await expect(page.getByTestId('chip').first()).toHaveText('XML · <feed> · 3 elements');
  await expect(page.getByTestId('json-tree')).toContainText('feed');
});
