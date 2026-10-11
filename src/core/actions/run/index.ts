import type { AnyActionImpl } from '../types';
import { anyImpls } from './any';
import { imageImpls } from './image';
import { jsonImpls } from './json';
import { mediaImpls } from './media';
import { pdfImpls } from './pdf';
import { presentationImpls } from './presentation';
import { textImpls } from './text';
import { xmlImpls } from './xml';
import { yamlImpls } from './yaml';
import { ndjsonImpls } from './ndjson';
import { recordsImpls } from './records';

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
  ...pdfImpls,
  ...anyImpls,
];

const byId = new Map(actionImpls.map(a => [a.info.id, a]));

export const actionImpl = (id: string): AnyActionImpl | undefined => byId.get(id);
