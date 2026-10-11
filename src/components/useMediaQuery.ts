import { useSyncExternalStore } from 'react';
import { MOBILE_QUERY } from './ui';

/** Whether `query` matches, updating as it changes (window resizes, rotation). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    onChange => {
      const list = matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => matchMedia(query).matches,
  );
}

/** The phone layout: one pane at a time with a bottom navigation bar. */
export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);
