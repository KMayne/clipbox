import { isBinaryKind } from '../core/kinds';
import type { Kind } from '../core/types';
import type { InspectorView, ViewClass } from './uiStore';

/** Which remembered view a kind uses; with nothing selected, the text one. */
export const viewClassOf = (kind: Kind | undefined): ViewClass =>
  kind !== undefined && isBinaryKind(kind) ? 'binary' : 'text';

/** The rendered view's name for each kind; anything unlisted is "Preview". */
const RENDERED: Record<string, string> = {
  json: 'Tree',
  yaml: 'Tree',
  xml: 'Tree',
  ndjson: 'Tree',
  records: 'Table',
  jwt: 'Claims',
  base64: 'Decoded',
  timestamp: 'Details',
  uuid: 'Details',
  url: 'Details',
  colour: 'Details',
  pem: 'Certificate',
  image: 'Image',
  pdf: 'Pages',
  audio: 'Player',
  video: 'Player',
  spreadsheet: 'Sheets',
  sqlite: 'Tables',
  archive: 'Files',
  presentation: 'Slides',
  executable: 'Details',
};

export interface ViewOption {
  view: InspectorView;
  label: string;
}

/**
 * The views a kind offers, in button order:
 * - text-based kinds: Text | <rendered> | Split | Hex dump
 * - plain text, whose rendering is its text: Text | Hex dump
 * - binary kinds: <rendered> | Hex dump
 * - plain binary, whose rendering is a hex dump: Hex dump
 */
export function viewsFor(kind: Kind): ViewOption[] {
  const hex: ViewOption = { view: 'hex', label: 'Hex dump' };
  if (kind === 'binary') return [hex];
  if (kind === 'text') return [{ view: 'text', label: 'Text' }, hex];
  const rendered: ViewOption = { view: 'rendered', label: RENDERED[kind] ?? 'Preview' };
  if (isBinaryKind(kind)) return [rendered, hex];
  return [{ view: 'text', label: 'Text' }, rendered, { view: 'split', label: 'Split' }, hex];
}

/**
 * The view to show for `kind`, given the remembered ones. When the remembered view isn't offered
 * (e.g. Split for plain text), the kind's closest equivalent: its text, else its rendering.
 */
export function viewFor(kind: Kind, views: Record<ViewClass, InspectorView>): InspectorView {
  const offered = viewsFor(kind).map(o => o.view);
  const wanted = views[viewClassOf(kind)];
  if (offered.includes(wanted)) return wanted;
  if (offered.includes('text')) return 'text';
  if (offered.includes('rendered')) return 'rendered';
  return 'hex';
}
