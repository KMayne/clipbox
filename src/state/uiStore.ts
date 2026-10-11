import { z } from 'zod';
import { create } from 'zustand';
import type { EntryId, Kind } from '../core/types';

/** How the Inspector shows a value: rendered, raw text, or both side by side. */
/**
 * How the Inspector shows a value: rendered (named per kind: Tree, Table, Image…), its text, both
 * side by side, or a hex dump of its bytes. See `state/views.ts` for which kinds offer which.
 */
export type InspectorView = 'rendered' | 'text' | 'split' | 'hex';

/** Views are remembered separately for text-based and binary kinds. */
export type ViewClass = 'text' | 'binary';

/** The pane shown in the phone layout (one at a time, chosen with the bottom navigation). */
export type MobilePane = 'pastes' | 'inspector' | 'sidebar';

/** The sidebar's collapsible sections. */
export type SidebarSection = 'info' | 'actions' | 'schema' | 'shortcuts';

interface NoticeAction {
  label: string;
  run(): void;
}

interface Notice {
  message: string;
  tone: 'info' | 'error';
  action?: NoticeAction;
}

/** The table (sheet) shown for one value; "Copy" copies it. */
export interface ActiveTable {
  entryId: EntryId;
  kind: Kind;
  index: number;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  /** The confirm button's text, e.g. "Clear all". */
  confirmLabel: string;
  onConfirm(): void;
}

interface UiState {
  /**
   * The view for each class of kind, remembered per browser. Text-based kinds open in Split (raw
   * text beside the preview), binary ones in Preview (Split puts a hex dump beside it).
   */
  views: Record<ViewClass, InspectorView>;
  wrap: boolean;
  paletteOpen: boolean;
  /** The right sidebar, Info and Actions (toggled with `A`); remembered per browser. */
  sidebarOpen: boolean;
  /** The left Pastes panel (toggled with `P`, desktop only); remembered per browser. */
  pastesOpen: boolean;
  /** A pending "are you sure?" question, shown by `ConfirmDialog`. */
  confirm: ConfirmRequest | null;
  /** Which sidebar sections are expanded; remembered per browser. */
  sections: Record<SidebarSection, boolean>;
  /** An action whose settings form the sidebar should expand and focus (from the palette). */
  focusedAction: { id: string; seq: number } | null;
  settings: { open: boolean };
  /** Only used by the phone layout. */
  pane: MobilePane;
  notice: Notice | null;
  /** Only the inspected value's; other values show (and copy) their first table. */
  activeTable: ActiveTable | null;
  setView(viewClass: ViewClass, view: InspectorView): void;
  toggleWrap(): void;
  setPaletteOpen(open: boolean): void;
  setSidebarOpen(open: boolean): void;
  setPastesOpen(open: boolean): void;
  togglePastes(): void;
  /** Asks the user to confirm before `onConfirm` runs (e.g. Clear all). */
  askConfirm(request: ConfirmRequest): void;
  closeConfirm(): void;
  toggleSidebar(): void;
  /** Expands or collapses one section, opening the sidebar if it's hidden. */
  setSection(section: SidebarSection, expanded: boolean): void;
  toggleSection(section: SidebarSection): void;
  /** Opens the sidebar with `actionId`'s settings form expanded and focused. */
  focusAction(actionId: string): void;
  openSettings(): void;
  closeSettings(): void;
  showPane(pane: MobilePane): void;
  notify(message: string, tone?: Notice['tone'], action?: NoticeAction): void;
  dismissNotice(): void;
  setActiveTable(table: ActiveTable): void;
}

/** Index of the table shown for `entryId`/`kind`: the active one if it's this value's, else 0. */
export const tableIndexFor = (active: ActiveTable | null, entryId: EntryId, kind: Kind) =>
  active && active.entryId === entryId && active.kind === kind ? active.index : 0;

const SIDEBAR_KEY = 'clipbox.sidebarOpen';
const PASTES_KEY = 'clipbox.pastesOpen';
/** Before the sidebar held Info too, it was the Actions sidebar. */
const OLD_SIDEBAR_KEY = 'clipbox.actionsOpen';
const SECTIONS_KEY = 'clipbox.sidebarSections';
const VIEW_KEY = 'clipbox.inspectorView';

// Schema arrived later, so older saves don't have it
const sectionsSchema = z.object({
  info: z.boolean(),
  actions: z.boolean(),
  schema: z.boolean().default(false),
  shortcuts: z.boolean().default(false),
});
const DEFAULT_SECTIONS: Record<SidebarSection, boolean> = {
  info: true,
  actions: true,
  schema: false,
  shortcuts: false,
};
const viewSchema = z.enum(['rendered', 'text', 'split', 'hex']);
const DEFAULT_VIEWS: Record<ViewClass, InspectorView> = { text: 'split', binary: 'rendered' };
/** Names saved before views were per kind: Preview, Split and Raw. */
const legacyViewSchema = z.enum(['preview', 'split', 'raw']);
const fromLegacy = (viewClass: ViewClass, v: z.infer<typeof legacyViewSchema>): InspectorView =>
  v === 'preview' ? 'rendered' : v === 'raw' ? (viewClass === 'text' ? 'text' : 'hex') : v;
const savedView = (viewClass: ViewClass) =>
  z
    .union([viewSchema, legacyViewSchema.transform(v => fromLegacy(viewClass, v))])
    .catch(DEFAULT_VIEWS[viewClass]);
const viewsSchema = z.object({ text: savedView('text'), binary: savedView('binary') });

function load<T>(key: string, parse: (raw: string | null) => T | undefined): T | undefined {
  try {
    return parse(localStorage.getItem(key));
  } catch {
    return undefined; // no storage (e.g. blocked)
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not remembered; fine
  }
}

const parseBool = (raw: string | null) => {
  const parsed = z.enum(['true', 'false']).safeParse(raw);
  return parsed.success ? parsed.data === 'true' : undefined;
};

const parseSections = (raw: string | null) => {
  try {
    const parsed = sectionsSchema.safeParse(JSON.parse(raw ?? ''));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

export const parseViews = (raw: string | null): Record<ViewClass, InspectorView> | undefined => {
  // Before views were remembered per class, one view name was saved; it was a text-kind choice
  const single = legacyViewSchema.safeParse(raw);
  if (single.success) return { ...DEFAULT_VIEWS, text: fromLegacy('text', single.data) };
  try {
    const parsed = viewsSchema.safeParse(JSON.parse(raw ?? ''));
    if (!parsed.success) return undefined;
    // Binary kinds no longer split
    const { text, binary } = parsed.data;
    return { text, binary: binary === 'split' ? 'rendered' : binary };
  } catch {
    return undefined;
  }
};

/** Open by default. */
const loadSidebarOpen = () =>
  load(SIDEBAR_KEY, parseBool) ?? load(OLD_SIDEBAR_KEY, parseBool) ?? true;

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useUiStore = create<UiState>((set, get) => ({
  views: load(VIEW_KEY, parseViews) ?? DEFAULT_VIEWS,
  wrap: false,
  paletteOpen: false,
  sidebarOpen: loadSidebarOpen(),
  pastesOpen: load(PASTES_KEY, parseBool) ?? true,
  confirm: null,
  sections: load(SECTIONS_KEY, parseSections) ?? DEFAULT_SECTIONS,
  focusedAction: null,
  settings: { open: false },
  pane: 'pastes',
  notice: null,
  activeTable: null,
  setView(viewClass, view) {
    const views = { ...get().views, [viewClass]: view };
    save(VIEW_KEY, JSON.stringify(views));
    set({ views });
  },
  toggleWrap: () => set(s => ({ wrap: !s.wrap })),
  setPaletteOpen: paletteOpen => set({ paletteOpen }),
  setSidebarOpen(sidebarOpen) {
    save(SIDEBAR_KEY, String(sidebarOpen));
    set({ sidebarOpen });
  },
  toggleSidebar: () => get().setSidebarOpen(!get().sidebarOpen),
  setPastesOpen(pastesOpen) {
    save(PASTES_KEY, String(pastesOpen));
    set({ pastesOpen });
  },
  togglePastes: () => get().setPastesOpen(!get().pastesOpen),
  askConfirm: confirm => set({ confirm }),
  closeConfirm: () => set({ confirm: null }),
  setSection(section, expanded) {
    const sections = { ...get().sections, [section]: expanded };
    save(SECTIONS_KEY, JSON.stringify(sections));
    set({ sections });
    if (expanded) get().setSidebarOpen(true);
  },
  toggleSection: section => get().setSection(section, !get().sections[section]),
  focusAction(id) {
    get().setSection('actions', true);
    // The phone layout shows the sidebar's pane for it
    set(s => ({ focusedAction: { id, seq: (s.focusedAction?.seq ?? 0) + 1 }, pane: 'sidebar' }));
  },
  openSettings: () => set({ settings: { open: true } }),
  closeSettings: () => set({ settings: { open: false } }),
  showPane: pane => set({ pane }),
  notify(message, tone = 'info', action) {
    clearTimeout(noticeTimer);
    set({ notice: { message, tone, action } });
    // Actionable notices stay until dismissed
    if (!action) noticeTimer = setTimeout(() => set({ notice: null }), 4000);
  },
  dismissNotice: () => set({ notice: null }),
  setActiveTable: activeTable => set({ activeTable }),
}));
