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
  /** The Inspector's "Open as" menu. */
  openAsOpen: boolean;
  settings: { open: boolean };
  notice: Notice | null;
  /** Only the inspected value's; other values show (and copy) their first table. */
  activeTable: ActiveTable | null;
  setTab(tab: InspectorTab): void;
  toggleWrap(): void;
  setPaletteOpen(open: boolean): void;
  setOpenAsOpen(open: boolean): void;
  openSettings(): void;
  closeSettings(): void;
  notify(message: string, tone?: Notice['tone'], action?: NoticeAction): void;
  dismissNotice(): void;
  setActiveTable(table: ActiveTable): void;
}

/** Index of the table shown for `entryId`/`kind`: the active one if it's this value's, else 0. */
export const tableIndexFor = (active: ActiveTable | null, entryId: EntryId, kind: Kind) =>
  active && active.entryId === entryId && active.kind === kind ? active.index : 0;

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useUiStore = create<UiState>(set => ({
  tab: 'preview',
  wrap: false,
  paletteOpen: false,
  openAsOpen: false,
  settings: { open: false },
  notice: null,
  activeTable: null,
  setTab: tab => set({ tab }),
  toggleWrap: () => set(s => ({ wrap: !s.wrap })),
  setPaletteOpen: paletteOpen => set({ paletteOpen }),
  setOpenAsOpen: openAsOpen => set({ openAsOpen }),
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
