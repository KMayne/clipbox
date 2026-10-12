import { expect, test, type Page } from '@playwright/test';
import { actionsPane } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** Builds a mono 16-bit WAV of a quiet tone in the page and drops it (too big to send in). */
async function dropLongWav(page: Page, seconds: number) {
  await page.evaluate(seconds => {
    const rate = 44100;
    const frames = rate * seconds;
    const dv = new DataView(new ArrayBuffer(44 + frames * 2));
    const ascii = (at: number, s: string) =>
      [...s].forEach((ch, i) => dv.setUint8(at + i, ch.charCodeAt(0)));
    ascii(0, 'RIFF');
    dv.setUint32(4, 36 + frames * 2, true);
    ascii(8, 'WAVEfmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    ascii(36, 'data');
    dv.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++)
      dv.setInt16(44 + i * 2, Math.round(1000 * Math.sin((2 * Math.PI * 440 * i) / rate)), true);
    const dt = new DataTransfer();
    dt.items.add(new File([dv.buffer], 'long.wav', { type: 'audio/wav' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  }, seconds);
  await expect(page.locator('[data-kind=audio]')).toHaveAttribute('aria-pressed', 'true');
}

async function startNormalise(page: Page) {
  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Normalise audio' }).click();
  await pane
    .getByRole('form', { name: 'Normalise audio settings' })
    .getByRole('button', { name: 'Run' })
    .click();
}

const bar = (page: Page) =>
  actionsPane(page).getByRole('progressbar', { name: 'Normalise audio progress' });

test('Normalise audio shows its progress in the sidebar and cancels cleanly', async ({ page }) => {
  await dropLongWav(page, 120);
  await startNormalise(page);

  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toHaveAttribute('aria-valuetext', /^Pass [12] of 2 · .* · \d+%$/);
  // The bar moves
  const first = Number(await bar(page).getAttribute('aria-valuenow'));
  await expect
    .poll(async () => Number(await bar(page).getAttribute('aria-valuenow')))
    .toBeGreaterThan(first);
  // Shown in the sidebar (scrolled into view: below the fold the strip takes over), so not
  // repeated in the running-actions strip
  await bar(page).scrollIntoViewIfNeeded();
  await expect(page.getByRole('group', { name: 'Running actions' })).toHaveCount(0);

  await actionsPane(page).getByRole('button', { name: 'Cancel Normalise audio' }).click();
  await expect(bar(page)).toHaveCount(0);
  // No result and no failure notice
  await expect(page.getByTestId('capture')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('capture')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('the bar goes once Normalise audio finishes', async ({ page }) => {
  await dropLongWav(page, 60);
  await startNormalise(page);
  await expect(bar(page)).toBeVisible();
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 60_000 });
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Running actions' })).toHaveCount(0);
});

test('a palette-started run shows in the running-actions strip', async ({ page }) => {
  test.setTimeout(120_000);
  // A big TSV, built in the page; To CSV reports per row
  await page.evaluate(() => {
    const lines = ['id\tname\tscore'];
    for (let i = 0; i < 1_000_000; i++) lines.push(`${i}\trow number ${i}\t${i % 997}`);
    const dt = new DataTransfer();
    dt.items.add(new File([lines.join('\n')], 'big.tsv', { type: 'text/tab-separated-values' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  });
  await expect(page.locator('[data-kind=records]')).toHaveAttribute('aria-pressed', 'true', {
    timeout: 60_000,
  });

  // Sidebar closed: the strip is the only place progress can show
  await page.keyboard.press('a');
  await expect(actionsPane(page)).toBeHidden();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('To CSV');
  await expect(page.getByRole('option').first()).toHaveText('Convert: To CSV');
  await page.keyboard.press('Enter');

  const strip = page.getByRole('group', { name: 'Running actions' });
  await expect(strip.getByRole('progressbar', { name: 'To CSV progress' })).toBeVisible();
  await expect(strip).toContainText('To CSV');
  await expect(strip.getByRole('button', { name: 'Cancel To CSV' })).toBeVisible();
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 60_000 });
  await expect(strip).toHaveCount(0);
});
