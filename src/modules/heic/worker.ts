// Imported as a URL so the build emits it and the modules manifest lists it under 'heic'
import wasmUrl from 'libheif-js/libheif-wasm/libheif.wasm?url';
import { register } from '../../core/interpreter';
import { createHeif, type Heif } from './heif';
import { createHeicInterpreter } from './interpreter';

let lib: Promise<Heif> | null = null;

/** Fetches and instantiates libheif's WASM on first use; a failure is retried next time. */
function load(): Promise<Heif> {
  if (!lib) {
    lib = (async () => {
      const res = await fetch(wasmUrl);
      if (!res.ok) throw new Error(`Failed to load libheif: ${res.status}`);
      return createHeif(await res.arrayBuffer());
    })();
    lib.catch(() => (lib = null));
  }
  return lib;
}

/** HEIC/HEIF images (libheif with libde265, LGPL-3.0), decoded to PNG for the `image` kind. */
export const interpreters = [register(createHeicInterpreter(load))];
