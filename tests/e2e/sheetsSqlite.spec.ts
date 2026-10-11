import { expect, test, type Page } from '@playwright/test';
import initSqlJs from 'sql.js';
import * as XLSX from 'xlsx';
import { lastCopy, recordClipboard } from './helpers';

/** Drops a binary file; the bytes travel as base64 because page.evaluate takes JSON. */
async function dropBytes(page: Page, name: string, type: string, bytes: Uint8Array) {
  await page.evaluate(
    ({ name, type, b64 }) => {
      const bin = atob(b64);
      const data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([data], name, { type }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    },
    { name, type, b64: Buffer.from(bytes).toString('base64') },
  );
}

function xlsxFixture(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['name', 'age'],
      ['Ada', 36],
      ['Linus', 54],
      ['Grace', 85],
    ]),
    'People',
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['city', 'country'],
      ['Lyon', 'France'],
      ['Osaka', 'Japan'],
      ['Quito', 'Ecuador'],
    ]),
    'Places',
  );
  const out: unknown = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  if (!(out instanceof ArrayBuffer)) throw new Error('Expected an ArrayBuffer');
  return new Uint8Array(out);
}

async function sqliteFixture(): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE planets (id INTEGER PRIMARY KEY, name TEXT, moons INTEGER);
    INSERT INTO planets (name, moons) VALUES ('Mercury', 0), ('Earth', 1), ('Mars', 2);
    CREATE TABLE tags (tag TEXT);
    INSERT INTO tags VALUES ('rocky'), ('gas'), ('ice');
  `);
  const bytes = db.export();
  db.close();
  return bytes;
}

test.beforeEach(async ({ page }) => {
  await recordClipboard(page);
  await page.goto('/');
});

test('xlsx shows sheet tabs and switches sheets', async ({ page }) => {
  await dropBytes(
    page,
    'book.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xlsxFixture(),
  );
  const chip = page.locator('[data-kind=spreadsheet]');
  await expect(chip).toHaveText('XLSX · 2 sheets · People 3×2');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  const sheets = page.getByRole('tablist', { name: 'Sheets' });
  await expect(sheets.getByRole('tab')).toHaveCount(2);
  const table = page.getByTestId('records-table');
  await expect(table).toContainText('Grace');

  await sheets.getByRole('tab', { name: /Places/ }).click();
  await expect(sheets.getByRole('tab', { name: /Places/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(table).toContainText('Osaka');
  await expect(table).not.toContainText('Grace');

  // Copy takes the sheet on show
  const copy = page.getByRole('button', { name: 'Copy' });
  const copiedText = async () => (await lastCopy(page))?.['text/plain'];
  await copy.click();
  await expect.poll(copiedText).toMatch(/^city\tcountry\n/);
  await sheets.getByRole('tab', { name: /People/ }).click();
  await copy.click();
  await expect.poll(copiedText).toMatch(/^name\tage\n/);
});

test('sqlite lists tables, shows rows and opens a table as CSV', async ({ page }) => {
  await dropBytes(page, 'space.db', 'application/vnd.sqlite3', await sqliteFixture());
  const chip = page.locator('[data-kind=sqlite]');
  await expect(chip).toHaveText(/^SQLite · 2 tables · /);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  const tables = page.getByRole('navigation', { name: 'Tables' });
  await expect(tables.getByRole('button')).toHaveCount(2);
  const rows = page.getByTestId('records-table');
  await expect(rows).toContainText('Mars');

  // Row counts aren't computed at open; the selected table is counted on demand
  const tags = tables.getByRole('button', { name: /tags/ });
  await expect(tags).toContainText('—');
  await tags.click();
  await expect(rows).toContainText('rocky');
  await expect(tags).not.toContainText('—');

  await page.getByText('Schema SQL').click();
  await expect(page.getByText(/CREATE TABLE planets/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Open as' }).click();
  await page.getByRole('menuitem', { name: 'Table planets as CSV' }).click();
  await expect(page.getByTestId('capture')).toHaveCount(2);
  const derived = page.getByTestId('capture').first();
  await expect(derived.getByTestId('derived-from')).toContainText('Table planets as CSV');
  await expect(derived.locator('[data-kind=records]')).toHaveText('Records 3×3');
  await expect(page.getByTestId('records-table')).toContainText('Earth');
});
