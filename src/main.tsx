import { injectGlobal } from '@emotion/css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { consumeShares, startFileHandling } from './capture/share';
import { onCaptureEvent, useCaptureStore } from './state/captureStore';
import { startBackgroundDownloads } from './state/backgroundDownloads';
import { startInstallPrompt } from './state/install';
import { startMobileNavigation } from './state/mobileNav';
import { useModuleStore } from './state/moduleStore';
import { startPersistence } from './state/persistence';
import { sw } from './swClient';
import { FONT_SCALE, TEXT_SIZES, theme, withAlpha } from './theme';

injectGlobal`
  :root {
    --font-scale: ${FONT_SCALE};
    ${Object.entries(TEXT_SIZES)
      .map(([name, px]) => `--text-${name}: calc(${px}px * var(--font-scale));`)
      .join('\n    ')}
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root { height: 100%; margin: 0; }
  body {
    background: ${theme.bg};
    color: ${theme.text};
    font: var(--text-base)/1.4 ${theme.sans};
    color-scheme: dark;
    /* App-like on phones: no pull-to-refresh or rubber-banding, no grey tap flashes */
    overscroll-behavior: none;
    -webkit-tap-highlight-color: transparent;
    /* Native controls (checkboxes, radios, ranges) */
    accent-color: ${theme.accent};
  }
  button, input, select, textarea { font: inherit; color: inherit; }
  ::placeholder { color: ${theme.faint}; }
  ::selection { background: ${withAlpha(theme.accent, 0.35)}; }
  :focus-visible { outline: 2px solid ${theme.accent}; outline-offset: 1px; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: ${theme.scrollbar}; border-radius: 5px; }
  ::-webkit-scrollbar-corner { background: transparent; }
`;

sw.register();
// The browser UI (title bar, Android status bar) follows the chosen scheme, not just Nord
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.panel);
startInstallPrompt();
startMobileNavigation();
useModuleStore.getState().init();
startBackgroundDownloads();
void startPersistence(
  {
    captures: () => useCaptureStore.getState().captures,
    restore: captures => useCaptureStore.getState().restore(captures),
    remove: id => useCaptureStore.getState().remove(id),
    subscribe: onCaptureEvent,
  },
  () => useCaptureStore.getState().clear(),
);

// After the listeners above, so a shared item opens in the Inspector
void consumeShares();
startFileHandling();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
