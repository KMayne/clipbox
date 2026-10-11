import { useEffect, useState } from 'react';

export type AsyncState<T> =
  { status: 'loading' } | { status: 'ok'; value: T } | { status: 'error'; error: string };

/** Runs `load` whenever `key` changes; stale results are ignored. */
export function useAsync<T>(key: string, load: () => Promise<T>): AsyncState<T> {
  const [result, setResult] = useState<{ key: string; state: AsyncState<T> } | null>(null);
  useEffect(() => {
    let live = true;
    load().then(
      value => live && setResult({ key, state: { status: 'ok', value } }),
      err => live && setResult({ key, state: { status: 'error', error: String(err) } }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies `load`
  }, [key]);
  return result?.key === key ? result.state : { status: 'loading' };
}
