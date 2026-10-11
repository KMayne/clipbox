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

/**
 * Records what the app copies instead of touching the real clipboard. Call before `page.goto`;
 * read the last copy with `lastCopy`.
 */
export async function recordClipboard(page: Page) {
  await page.addInitScript(() => {
    const copies: Record<string, string>[] = [];
    Object.defineProperty(window, '__copies', { value: copies });
    navigator.clipboard.write = async items => {
      for (const item of items) {
        const copy: Record<string, string> = {};
        for (const type of item.types) {
          const blob = await item.getType(type);
          // Text as-is; anything else as its size and first bytes, enough to identify it
          const head = [...new Uint8Array(await blob.slice(0, 8).arrayBuffer())];
          copy[type] = type.startsWith('text/')
            ? await blob.text()
            : `${blob.size} bytes: ${head.map(b => b.toString(16).padStart(2, '0')).join(' ')}`;
        }
        copies.push(copy);
      }
    };
  });
}

/** The most recent copy recorded by `recordClipboard` (MIME type → text or byte summary). */
export async function lastCopy(page: Page): Promise<Record<string, string> | undefined> {
  return page.evaluate(() => {
    const copies: unknown = Reflect.get(window, '__copies');
    if (!Array.isArray(copies)) return undefined;
    const last: unknown = copies.at(-1);
    if (typeof last !== 'object' || last === null) return undefined;
    return Object.fromEntries(Object.entries(last).map(([k, v]) => [k, String(v)]));
  });
}
