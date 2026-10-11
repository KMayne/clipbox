import { create } from 'zustand';

export type InspectorTab = 'preview' | 'stats' | 'schema' | 'raw';

interface Notice {
  message: string;
  tone: 'info' | 'error';
}

interface UiState {
  tab: InspectorTab;
  wrap: boolean;
  paletteOpen: boolean;
  notice: Notice | null;
  setTab(tab: InspectorTab): void;
  toggleWrap(): void;
  setPaletteOpen(open: boolean): void;
  notify(message: string, tone?: Notice['tone']): void;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useUiStore = create<UiState>(set => ({
  tab: 'preview',
  wrap: false,
  paletteOpen: false,
  notice: null,
  setTab: tab => set({ tab }),
  toggleWrap: () => set(s => ({ wrap: !s.wrap })),
  setPaletteOpen: paletteOpen => set({ paletteOpen }),
  notify(message, tone = 'info') {
    clearTimeout(noticeTimer);
    set({ notice: { message, tone } });
    noticeTimer = setTimeout(() => set({ notice: null }), 4000);
  },
}));
