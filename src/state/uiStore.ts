import { z } from 'zod';
import { create } from 'zustand';
import type { EntryId, Kind } from '../core/types';

export type InspectorTab = 'preview' | 'stats' | 'schema' | 'raw';

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
  tab: InspectorTab;
  wrap: boolean;
  paletteOpen: boolean;
  /** The Actions sidebar (toggled with `A`); remembered per browser. */
  actionsOpen: boolean;
  /** An action whose settings form the sidebar should expand and focus (from the palette). */
  focusedAction: { id: string; seq: number } | null;
  settings: { open: boolean };
  notice: Notice | null;
  /** Only the inspected value's; other values show (and copy) their first table. */
  activeTable: ActiveTable | null;
  setTab(tab: InspectorTab): void;
  toggleWrap(): void;
  setPaletteOpen(open: boolean): void;
  setActionsOpen(open: boolean): void;
  toggleActions(): void;
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

const ACTIONS_KEY = 'clipbox.actionsOpen';

function loadActionsOpen(): boolean {
  try {
    const parsed = z.enum(['true', 'false']).safeParse(localStorage.getItem(ACTIONS_KEY));
    return parsed.success ? parsed.data === 'true' : true;
  } catch {
    return true; // no storage (e.g. blocked): default to open
  }
}

function saveActionsOpen(open: boolean): void {
  try {
    localStorage.setItem(ACTIONS_KEY, String(open));
  } catch {
    // not remembered; fine
  }
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useUiStore = create<UiState>((set, get) => ({
  tab: 'preview',
  wrap: false,
  paletteOpen: false,
  actionsOpen: loadActionsOpen(),
  focusedAction: null,
  settings: { open: false },
  notice: null,
  activeTable: null,
  setTab: tab => set({ tab }),
  toggleWrap: () => set(s => ({ wrap: !s.wrap })),
  setPaletteOpen: paletteOpen => set({ paletteOpen }),
  setActionsOpen(actionsOpen) {
    saveActionsOpen(actionsOpen);
    set({ actionsOpen });
  },
  toggleActions: () => get().setActionsOpen(!get().actionsOpen),
  focusAction(id) {
    get().setActionsOpen(true);
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
