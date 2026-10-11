import { expect, test } from '@playwright/test';
import { samplePe } from '../fixtures/executables';
import { actionsPane, dropBytes, naturalSize, stat } from './helpers';

const EXE = 'application/x-msdownload';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a dropped .exe shows its headers, sections, imports and version info', async ({ page }) => {
  await dropBytes(page, 'example.exe', EXE, samplePe());

  const chip = page.locator('[data-kind=executable]');
  await expect(chip).toHaveText('Windows x64 GUI app · Example Corp · v1.2.3');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-kind=binary]')).toHaveCount(1);

  // Header card, with the icon rendered from the worker
  const header = page.getByTestId('executable-header');
  await expect(header).toContainText('Example');
  await expect(header).toContainText('v1.2.3 · Example Corp · Example tool');
  await expect(header.getByTestId('signing-badge')).toHaveText('Not signed');
  await expect(header).toContainText('x64');
  expect(await naturalSize(header.getByTestId('executable-icon'))).toEqual([48, 48]);

  const sections = page.getByTestId('exe-section');
  await expect(sections.locator('xpath=./summary')).toHaveText([
    'Headers',
    'Sections3',
    'Imports3· 6 functions',
    'Resources5',
    'Version info',
    'Manifest',
  ]);
  await expect(page.getByTestId('section-row')).toHaveCount(3);
  await expect(page.getByTestId('section-row').first()).toContainText('.text');

  // Imports start collapsed; the filter narrows them to matching functions
  const imports = page.locator('[data-testid=exe-section][data-title=Imports]');
  await imports.locator('summary').first().click();
  await expect(imports.getByTestId('import-dll')).toHaveCount(3);
  await imports.getByLabel('Filter imports').fill('messagebox');
  await expect(imports.getByTestId('import-dll')).toHaveCount(1);
  await expect(imports.getByTestId('import-dll')).toContainText('USER32.dll');
  await expect(imports.getByText('MessageBoxW')).toBeVisible();

  await expect(page.locator('[data-testid=exe-section][data-title="Version info"]')).toContainText(
    'LegalCopyright© 2024 Example Corp',
  );

  // Sidebar Info
  await expect(stat(page, 'Product')).toHaveText('Example');
  await expect(stat(page, 'Architecture')).toHaveText('x64');
  await expect(stat(page, 'Overlay')).toHaveText(/^36 B at 0x/);
});

test('Extract icon makes a collection of the .ico and a PNG', async ({ page }) => {
  await dropBytes(page, 'example.exe', EXE, samplePe());
  await expect(page.locator('[data-kind=executable]')).toHaveAttribute('aria-pressed', 'true');

  await actionsPane(page).getByRole('button', { name: 'Extract icon' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toContainText('Extract icon');
  await expect(derived.locator('[data-kind=image]')).toHaveCount(2);
  await expect(derived).toContainText('example-icon.ico');
  await expect(derived).toContainText('example-icon.png');

  // Both render as images in the collection grid
  await derived.getByTestId('capture-count').click();
  const tiles = page.getByTestId('collection').getByTestId('tile');
  await expect(tiles).toHaveCount(2);
  for (const i of [0, 1]) {
    const [w] = await naturalSize(tiles.nth(i).locator('img'));
    expect(w).toBeGreaterThanOrEqual(16);
  }
});
