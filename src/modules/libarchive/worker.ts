import wasmUrl from 'libarchive.js/src/webworker/wasm-gen/libarchive.wasm?url';
import { register } from '../../core/interpreter';
import { createLibarchiveInterpreter } from './interpreter';
import { createLibarchive, type Libarchive } from './reader';

let lib: Promise<Libarchive> | null = null;

/** Fetches and instantiates the WASM on first use; a failure is retried next time. */
function load(): Promise<Libarchive> {
  if (!lib) {
    lib = (async () => {
      const res = await fetch(wasmUrl);
      if (!res.ok) throw new Error(`Failed to load libarchive: ${res.status}`);
      return createLibarchive(await res.arrayBuffer());
    })();
    lib.catch(() => (lib = null));
  }
  return lib;
}

export const interpreters = [register(createLibarchiveInterpreter(load))];
