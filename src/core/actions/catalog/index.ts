import type { ActionInfo } from '../types';
import { anyActions } from './any';
import { imageActions } from './image';
import { jsonActions } from './json';
import { mediaActions } from './media';
import { textActions } from './text';

/**
 * Every action's metadata, shared by the UI and the worker. Each area has its own file (one line
 * here per area), so parallel work on different kinds doesn't touch the same lists.
 * Order within a group is the order shown in the sidebar; area order decides ties across areas.
 */
export const catalog: ActionInfo[] = [
  ...jsonActions,
  ...textActions,
  ...imageActions,
  ...mediaActions,
  ...anyActions,
];

const byId = new Map(catalog.map(a => [a.id, a]));

export const actionById = (id: string): ActionInfo | undefined => byId.get(id);
