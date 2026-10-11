import { injectGlobal } from '@emotion/css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { onCaptureEvent, useCaptureStore } from './state/captureStore';
import { useModuleStore } from './state/moduleStore';
import { startPersistence } from './state/persistence';
import { sw } from './swClient';
import { theme } from './theme';

injectGlobal`
  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root { height: 100%; margin: 0; }
  body {
    background: ${theme.bg};
    color: ${theme.text};
    font: 13px/1.4 ${theme.sans};
    color-scheme: dark;
  }
  button { font: inherit; color: inherit; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: ${theme.scrollbar}; border-radius: 5px; }
  ::-webkit-scrollbar-corner { background: transparent; }
`;

sw.register();
useModuleStore.getState().init();
void startPersistence(
  {
    captures: () => useCaptureStore.getState().captures,
    restore: captures => useCaptureStore.getState().restore(captures),
    remove: id => useCaptureStore.getState().remove(id),
    subscribe: onCaptureEvent,
  },
  () => useCaptureStore.getState().clear(),
);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
