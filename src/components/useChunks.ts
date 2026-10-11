import { useCallback, useReducer, useState } from 'react';

const CHUNK = 500;

/**
 * Lazily fetches items in fixed-size chunks for virtualised views. `fetch` must be stable
 * (e.g. `handle.lines`).
 */
export function useChunks<T>(fetch: (from: number, to: number) => Promise<T[]>) {
  const [cache] = useState(() => new Map<number, T[] | 'pending'>());
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const ensure = useCallback(
    (from: number, to: number) => {
      for (let c = Math.floor(from / CHUNK); c <= Math.floor(to / CHUNK); c++) {
        if (cache.has(c)) continue;
        cache.set(c, 'pending');
        void fetch(c * CHUNK, (c + 1) * CHUNK).then(items => {
          cache.set(c, items);
          bump();
        });
      }
    },
    [cache, fetch],
  );

  const get = (i: number): T | undefined => {
    const chunk = cache.get(Math.floor(i / CHUNK));
    return chunk === 'pending' ? undefined : chunk?.[i % CHUNK];
  };

  return { ensure, get };
}
