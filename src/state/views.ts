import { isBinaryKind } from '../core/kinds';
import type { Kind } from '../core/types';
import type { InspectorView, ViewClass } from './uiStore';

/** Which remembered view a kind uses; with nothing selected, the text one. */
export const viewClassOf = (kind: Kind | undefined): ViewClass =>
  kind !== undefined && isBinaryKind(kind) ? 'binary' : 'text';

/**
 * Split shows the source (text, or a hex dump) beside the preview. Plain text's and plain binary's
 * previews already are that source.
 */
export const canSplit = (kind: Kind) => kind !== 'text' && kind !== 'binary';

/** The view to show for `kind`, given the remembered ones. */
export function viewFor(kind: Kind, views: Record<ViewClass, InspectorView>): InspectorView {
  const view = views[viewClassOf(kind)];
  return view === 'split' && !canSplit(kind) ? 'preview' : view;
}
