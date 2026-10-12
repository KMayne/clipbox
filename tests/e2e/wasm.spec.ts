import { expect, test } from '@playwright/test';
import { sampleWasm } from '../fixtures/wasm';
import { actionsPane, dropBytes, stat } from './helpers';

const WASM = 'application/wasm';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a dropped .wasm shows its label, facts, imports, exports and section sizes', async ({
  page,
}) => {
  await dropBytes(page, 'sample.wasm', WASM, sampleWasm());

  const chip = page.locator('[data-kind=wasm]');
  await expect(chip).toHaveText('WebAssembly · 3 functions · 6 exports · Rust');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-kind=binary]')).toHaveCount(1);

  const viewButtons = page.getByRole('group', { name: 'View' }).getByRole('button');
  await expect(viewButtons).toHaveText(['Module', 'Hex dump']);

  const view = page.getByTestId('wasm-view');
  const header = view.getByTestId('wasm-header');
  await expect(header).toContainText('WebAssembly core module, version 1');
  await expect(header).toContainText('WASI');
  await expect(header).toContainText('Start function_start');
  await expect(view.getByTestId('wasm-sections')).toContainText('code');

  // Imports first, with signatures
  const table = view.getByTestId('records-table');
  await expect(view.getByRole('tab', { selected: true })).toHaveText('Imports4');
  await expect(table).toContainText('wasi_snapshot_preview1');
  await expect(table).toContainText('(i32) → ()');

  await view.getByRole('tab', { name: /Exports/ }).click();
  await expect(view.getByTestId('records-table')).toContainText('(i32, i32) → i32');
  await expect(view.getByTestId('records-table')).toContainText('(i32, i64) → (i32, i64)');

  // Sidebar Info
  await expect(stat(page, 'Functions')).toHaveText('5 · 2 imported, 3 defined');
  await expect(stat(page, 'Language')).toHaveText('Rust 1.80.0');
});

test('Disassemble to WAT makes a text capture with the module source', async ({ page }) => {
  await dropBytes(page, 'sample.wasm', WASM, sampleWasm());
  await expect(page.locator('[data-kind=wasm]')).toHaveAttribute('aria-pressed', 'true');

  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Disassemble to WAT' }).click();
  const form = pane.getByRole('form', { name: 'Disassemble to WAT settings' });
  await form.getByLabel('Fold expressions').check();
  await form.getByRole('button', { name: 'Run' }).click();

  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toContainText('Disassemble to WAT (folded)');
  await expect(derived).toContainText('sample.wat');
  const source = page.getByRole('region', { name: 'View' });
  await expect(source).toContainText('(module $sample');
  await expect(source).toContainText('(func $add');

  // The interface as JSON, without a module: back to the parent through its link
  await derived.getByTestId('derived-from').click();
  await expect(page.locator('[data-kind=wasm]')).toHaveAttribute('aria-pressed', 'true');
  await pane.getByRole('button', { name: 'Imports/exports as JSON' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(3);
  await expect(page.getByTestId('capture').first()).toContainText('sample-interface.json');
});
