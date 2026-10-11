import { onCaptureEvent } from './captureStore';
import { useUiStore } from './uiStore';

/**
 * The phone layout follows new captures: a paste, a share, an opened file or an action's result
 * switches to the Inspector, which selects it. (Restored history doesn't fire `added`, so the app
 * still opens on Pastes.) Choosing a paste in the Pastes pane does the same, in its click handlers.
 */
export function startMobileNavigation(): void {
  onCaptureEvent(e => {
    if (e.type === 'added') useUiStore.getState().showPane('inspector');
  });
}
