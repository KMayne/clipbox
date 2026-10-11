import { useCallback, useReducer, useState } from 'react';
import type { ValueHandle } from '../core/types';

const CHUNK = 500;

/** Lazily fetches 'lines' or 'rows' slices in fixed-size chunks for virtualised views. */
export function useChunks<T>(handle: ValueHandle, type: 'lines' | 'rows') {
  const [cache] = useState(() => new Map<number, T[] | 'pending'>());
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const ensure = useCallback(
    (from: number, to: number) => {
      for (let c = Math.floor(from / CHUNK); c <= Math.floor(to / CHUNK); c++) {
        if (cache.has(c)) continue;
        cache.set(c, 'pending');
        void handle.getSlice({ type, from: c * CHUNK, to: (c + 1) * CHUNK }).then(items => {
          cache.set(c, items as T[]);
          bump();
        });
      }
    },
    [cache, handle, type],
  );

  const get = (i: number): T | undefined => {
    const chunk = cache.get(Math.floor(i / CHUNK));
    return chunk === 'pending' ? undefined : chunk?.[i % CHUNK];
  };

  return { ensure, get };
}
