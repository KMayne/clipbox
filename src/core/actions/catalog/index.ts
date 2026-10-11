import type { ActionInfo } from '../types';
import { anyActions } from './any';
import { base64Actions } from './base64';
import { binaryActions } from './binary';
import { colourActions } from './colour';
import { imageActions } from './image';
import { jsonActions } from './json';
import { jwtActions } from './jwt';
import { mediaActions } from './media';
import { pdfActions } from './pdf';
import { pemActions } from './pem';
import { presentationActions } from './presentation';
import { textActions } from './text';
import { xmlActions } from './xml';
import { yamlActions } from './yaml';
import { ndjsonActions } from './ndjson';
import { recordsActions } from './records';
import { timestampActions } from './timestamp';
import { urlActions } from './url';
import { uuidActions } from './uuid';

/**
 * Every action's metadata, shared by the UI and the worker. Each area has its own file (one line
 * here per area), so parallel work on different kinds doesn't touch the same lists.
 * Order within a group is the order shown in the sidebar; area order decides ties across areas.
 */
export const catalog: ActionInfo[] = [
  ...jsonActions,
  ...textActions,
  ...xmlActions,
  ...yamlActions,
  ...ndjsonActions,
  ...recordsActions,
  ...imageActions,
  ...mediaActions,
  ...presentationActions,
  ...pdfActions,
  ...jwtActions,
  ...timestampActions,
  ...uuidActions,
  ...urlActions,
  ...colourActions,
  ...base64Actions,
  ...binaryActions,
  ...pemActions,
  ...anyActions,
];

const byId = new Map(catalog.map(a => [a.id, a]));

export const actionById = (id: string): ActionInfo | undefined => byId.get(id);
