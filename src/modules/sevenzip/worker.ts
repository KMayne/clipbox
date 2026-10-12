// Imported as a URL so the build emits it and the modules manifest lists it under 'sevenzip'
import wasmUrl from '7z-wasm/7zz.wasm?url';
import { register } from '../../core/interpreter';
import { createSevenZipInterpreter } from './interpreter';
import { createSevenZip, type SevenZip } from './reader';

let lib: Promise<SevenZip> | null = null;

/** Fetches 7-Zip's WASM on first use; a failure is retried next time. */
function load(): Promise<SevenZip> {
  if (!lib) {
    lib = (async () => {
      const res = await fetch(wasmUrl);
      if (!res.ok) throw new Error(`Failed to load 7-Zip: ${res.status}`);
      return createSevenZip(await res.arrayBuffer());
    })();
    lib.catch(() => (lib = null));
  }
  return lib;
}

/** Disc images (ISO 9660, UDF) through 7-Zip (LGPL-2.1 with the unRAR restriction). */
export const interpreters = [register(createSevenZipInterpreter(load))];
