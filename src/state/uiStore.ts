import { z } from 'zod';
import { create } from 'zustand';
import type { EntryId, Kind } from '../core/types';

/** How the Inspector shows a value: rendered, raw text, or both side by side. */
export type InspectorView = 'preview' | 'split' | 'raw';

/** The sidebar's collapsible sections. */
export type SidebarSection = 'info' | 'actions' | 'schema';

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

interface UiState {
  /** Remembered per browser. */
  view: InspectorView;
  wrap: boolean;
  paletteOpen: boolean;
  /** The right sidebar, Info and Actions (toggled with `A`); remembered per browser. */
  sidebarOpen: boolean;
  /** Which sidebar sections are expanded; remembered per browser. */
  sections: Record<SidebarSection, boolean>;
  /** An action whose settings form the sidebar should expand and focus (from the palette). */
  focusedAction: { id: string; seq: number } | null;
  settings: { open: boolean };
  notice: Notice | null;
  /** Only the inspected value's; other values show (and copy) their first table. */
  activeTable: ActiveTable | null;
  setView(view: InspectorView): void;
  toggleWrap(): void;
  setPaletteOpen(open: boolean): void;
  setSidebarOpen(open: boolean): void;
  toggleSidebar(): void;
  /** Expands or collapses one section, opening the sidebar if it's hidden. */
  setSection(section: SidebarSection, expanded: boolean): void;
  toggleSection(section: SidebarSection): void;
  /** Opens the sidebar with `actionId`'s settings form expanded and focused. */
  focusAction(actionId: string): void;
  openSettings(): void;
  closeSettings(): void;
  notify(message: string, tone?: Notice['tone'], action?: NoticeAction): void;
  dismissNotice(): void;
  setActiveTable(table: ActiveTable): void;
}

/** Index of the table shown for `entryId`/`kind`: the active one if it's this value's, else 0. */
export const tableIndexFor = (active: ActiveTable | null, entryId: EntryId, kind: Kind) =>
  active && active.entryId === entryId && active.kind === kind ? active.index : 0;

const SIDEBAR_KEY = 'clipbox.sidebarOpen';
/** Before the sidebar held Info too, it was the Actions sidebar. */
const OLD_SIDEBAR_KEY = 'clipbox.actionsOpen';
const SECTIONS_KEY = 'clipbox.sidebarSections';
const VIEW_KEY = 'clipbox.inspectorView';

// Schema arrived later, so older saves don't have it
const sectionsSchema = z.object({
  info: z.boolean(),
  actions: z.boolean(),
  schema: z.boolean().default(false),
});
const DEFAULT_SECTIONS: Record<SidebarSection, boolean> = {
  info: true,
  actions: true,
  schema: false,
};
const viewSchema = z.enum(['preview', 'split', 'raw']);

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

const parseView = (raw: string | null) => {
  const parsed = viewSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
};

/** Open by default. */
const loadSidebarOpen = () =>
  load(SIDEBAR_KEY, parseBool) ?? load(OLD_SIDEBAR_KEY, parseBool) ?? true;

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useUiStore = create<UiState>((set, get) => ({
  view: load(VIEW_KEY, parseView) ?? 'preview',
  wrap: false,
  paletteOpen: false,
  sidebarOpen: loadSidebarOpen(),
  sections: load(SECTIONS_KEY, parseSections) ?? DEFAULT_SECTIONS,
  focusedAction: null,
  settings: { open: false },
  notice: null,
  activeTable: null,
  setView(view) {
    save(VIEW_KEY, view);
    set({ view });
  },
  toggleWrap: () => set(s => ({ wrap: !s.wrap })),
  setPaletteOpen: paletteOpen => set({ paletteOpen }),
  setSidebarOpen(sidebarOpen) {
    save(SIDEBAR_KEY, String(sidebarOpen));
    set({ sidebarOpen });
  },
  toggleSidebar: () => get().setSidebarOpen(!get().sidebarOpen),
  setSection(section, expanded) {
    const sections = { ...get().sections, [section]: expanded };
    save(SECTIONS_KEY, JSON.stringify(sections));
    set({ sections });
    if (expanded) get().setSidebarOpen(true);
  },
  toggleSection: section => get().setSection(section, !get().sections[section]),
  focusAction(id) {
    get().setSection('actions', true);
    set(s => ({ focusedAction: { id, seq: (s.focusedAction?.seq ?? 0) + 1 } }));
  },
  openSettings: () => set({ settings: { open: true } }),
  closeSettings: () => set({ settings: { open: false } }),
  notify(message, tone = 'info', action) {
    clearTimeout(noticeTimer);
    set({ notice: { message, tone, action } });
    // Actionable notices stay until dismissed
    if (!action) noticeTimer = setTimeout(() => set({ notice: null }), 4000);
  },
  dismissNotice: () => set({ notice: null }),
  setActiveTable: activeTable => set({ activeTable }),
}));
