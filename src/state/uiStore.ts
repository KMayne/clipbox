import { create } from 'zustand';

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

interface UiState {
  tab: InspectorTab;
  wrap: boolean;
  paletteOpen: boolean;
  /** Open Settings dialog, optionally highlighting a module. */
  settings: { open: boolean; focus?: string };
  notice: Notice | null;
  setTab(tab: InspectorTab): void;
  toggleWrap(): void;
  setPaletteOpen(open: boolean): void;
  openSettings(focus?: string): void;
  closeSettings(): void;
  notify(message: string, tone?: Notice['tone'], action?: NoticeAction): void;
  dismissNotice(): void;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useUiStore = create<UiState>(set => ({
  tab: 'preview',
  wrap: false,
  paletteOpen: false,
  settings: { open: false },
  notice: null,
  setTab: tab => set({ tab }),
  toggleWrap: () => set(s => ({ wrap: !s.wrap })),
  setPaletteOpen: paletteOpen => set({ paletteOpen }),
  openSettings: focus => set({ settings: { open: true, focus } }),
  closeSettings: () => set({ settings: { open: false } }),
  notify(message, tone = 'info', action) {
    clearTimeout(noticeTimer);
    set({ notice: { message, tone, action } });
    // Actionable notices stay until dismissed
    if (!action) noticeTimer = setTimeout(() => set({ notice: null }), 4000);
  },
  dismissNotice: () => set({ notice: null }),
}));
