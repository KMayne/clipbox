import { create } from 'zustand';

/*
 * "Install app": Chromium fires `beforeinstallprompt` when the app is installable; we keep the
 * event so the palette and Settings can show the browser's install dialog later.
 */

interface InstallState {
  /** The deferred prompt, while the browser offers installation. */
  prompt: BeforeInstallPromptEvent | null;
  /** Running as the installed app, or installed during this visit. */
  installed: boolean;
  /** Shows the browser's install dialog. */
  install(): Promise<void>;
}

export const useInstallStore = create<InstallState>((set, get) => ({
  prompt: null,
  installed: false,
  async install() {
    const prompt = get().prompt;
    if (!prompt) return;
    // A prompt can only be shown once
    set({ prompt: null });
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') set({ installed: true });
  },
}));

export const canInstall = (s: Pick<InstallState, 'prompt' | 'installed'>) =>
  s.prompt !== null && !s.installed;

/** Listens for installability; call once at startup. */
export function startInstallPrompt(): void {
  const standalone = matchMedia('(display-mode: standalone)');
  const update = () => {
    if (standalone.matches) useInstallStore.setState({ installed: true, prompt: null });
  };
  update();
  standalone.addEventListener('change', update);
  window.addEventListener('beforeinstallprompt', e => {
    // Our own "Install app" replaces the browser's mini-infobar
    e.preventDefault();
    if (!standalone.matches) useInstallStore.setState({ prompt: e });
  });
  window.addEventListener('appinstalled', () =>
    useInstallStore.setState({ installed: true, prompt: null }),
  );
}
