import type { AnyActionImpl } from '../types';
import { anyImpls } from './any';
import { imageImpls } from './image';
import { jsonImpls } from './json';
import { presentationImpls } from './presentation';
import { textImpls } from './text';

/**
 * Worker-side implementations, one file per area (mirroring `catalog/`). Only the engine imports
 * this; the UI only needs the catalog.
 */
export const actionImpls: AnyActionImpl[] = [
  ...jsonImpls,
  ...textImpls,
  ...imageImpls,
  ...presentationImpls,
  ...anyImpls,
];

const byId = new Map(actionImpls.map(a => [a.info.id, a]));

export const actionImpl = (id: string): AnyActionImpl | undefined => byId.get(id);
