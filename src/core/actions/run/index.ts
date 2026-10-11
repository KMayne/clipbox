import type { AnyActionImpl } from '../types';
import { anyImpls } from './any';
import { base64Impls } from './base64';
import { binaryImpls } from './binary';
import { colourImpls } from './colour';
import { imageImpls } from './image';
import { jsonImpls } from './json';
import { jwtImpls } from './jwt';
import { archiveImpls } from './archive';
import { htmlImpls } from './html';
import { markdownImpls } from './markdown';
import { mediaImpls } from './media';
import { pdfImpls } from './pdf';
import { pemImpls } from './pem';
import { presentationImpls } from './presentation';
import { executableImpls } from './executable';
import { spreadsheetImpls } from './spreadsheet';
import { sqliteImpls } from './sqlite';
import { textImpls } from './text';
import { xmlImpls } from './xml';
import { yamlImpls } from './yaml';
import { ndjsonImpls } from './ndjson';
import { recordsImpls } from './records';
import { timestampImpls } from './timestamp';
import { urlImpls } from './url';
import { uuidImpls } from './uuid';

/**
 * Worker-side implementations, one file per area (mirroring `catalog/`). Only the engine imports
 * this; the UI only needs the catalog.
 */
export const actionImpls: AnyActionImpl[] = [
  ...jsonImpls,
  ...textImpls,
  ...xmlImpls,
  ...yamlImpls,
  ...ndjsonImpls,
  ...recordsImpls,
  ...imageImpls,
  ...mediaImpls,
  ...presentationImpls,
  ...executableImpls,
  ...pdfImpls,
  ...jwtImpls,
  ...timestampImpls,
  ...uuidImpls,
  ...urlImpls,
  ...colourImpls,
  ...base64Impls,
  ...binaryImpls,
  ...pemImpls,
  ...htmlImpls,
  ...markdownImpls,
  ...spreadsheetImpls,
  ...sqliteImpls,
  ...archiveImpls,
  ...anyImpls,
];

const byId = new Map(actionImpls.map(a => [a.info.id, a]));

export const actionImpl = (id: string): AnyActionImpl | undefined => byId.get(id);
