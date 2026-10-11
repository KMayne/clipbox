import type { AnyActionImpl } from '../types';
import { anyImpls } from './any';
import { archiveImpls } from './archive';
import { htmlImpls } from './html';
import { imageImpls } from './image';
import { jsonImpls } from './json';
import { markdownImpls } from './markdown';
import { mediaImpls } from './media';
import { pdfImpls } from './pdf';
import { presentationImpls } from './presentation';
import { spreadsheetImpls } from './spreadsheet';
import { sqliteImpls } from './sqlite';
import { textImpls } from './text';

/**
 * Worker-side implementations, one file per area (mirroring `catalog/`). Only the engine imports
 * this; the UI only needs the catalog.
 */
export const actionImpls: AnyActionImpl[] = [
  ...jsonImpls,
  ...textImpls,
  ...imageImpls,
  ...mediaImpls,
  ...presentationImpls,
  ...pdfImpls,
  ...htmlImpls,
  ...markdownImpls,
  ...spreadsheetImpls,
  ...sqliteImpls,
  ...archiveImpls,
  ...anyImpls,
];

const byId = new Map(actionImpls.map(a => [a.info.id, a]));

export const actionImpl = (id: string): AnyActionImpl | undefined => byId.get(id);
