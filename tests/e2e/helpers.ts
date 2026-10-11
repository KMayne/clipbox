import type { Page } from '@playwright/test';

/** Dispatches a synthetic paste carrying the given MIME → string entries. */
export async function paste(page: Page, data: Record<string, string>) {
  await page.evaluate(data => {
    const dt = new DataTransfer();
    for (const [type, value] of Object.entries(data)) dt.setData(type, value);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, data);
}

export async function dropFile(page: Page, name: string, type: string, content: string) {
  await page.evaluate(
    ({ name, type, content }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([content], name, { type }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    },
    { name, type, content },
  );
}

export const stat = (page: Page, label: string) =>
  page.getByTestId('stats').locator(`span:text-is("${label}") + span`).first();

/** Number of captures saved in IndexedDB. */
export const savedCount = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('clipbox');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('captures')) return resolve(0);
          const req = db.transaction('captures').objectStore('captures').count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        };
      }),
  );
