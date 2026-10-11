import { ArchiveReader } from 'libarchive.js/src/webworker/archive-reader.js';
import libarchive from 'libarchive.js/src/webworker/wasm-gen/libarchive.js';
import { WasmModule } from 'libarchive.js/src/webworker/wasm-module.js';

export interface ListedEntry {
  /** As stored in the archive; used again to extract. */
  name: string;
  size: number;
  isDir: boolean;
}

/** libarchive's WASM build, run directly in our worker (no nested worker, no DOM). */
export interface Libarchive {
  list(bytes: Uint8Array<ArrayBuffer>): Promise<ListedEntry[]>;
  extract(bytes: Uint8Array<ArrayBuffer>, name: string): Promise<Uint8Array<ArrayBuffer>>;
}

/** Instantiates libarchive from its WASM bytes (fetched in the worker, read from disk in tests). */
export async function createLibarchive(wasm: ArrayBuffer | Uint8Array): Promise<Libarchive> {
  const options = new WasmModule();
  options.wasmBinary = wasm;
  // libarchive reports recoverable errors on stderr; we surface failures ourselves
  options.print = () => {};
  options.printErr = () => {};
  const module = await libarchive(options);
  module.initFunctions();

  const withReader = async <T>(bytes: Uint8Array<ArrayBuffer>, run: (r: ArchiveReader) => T) => {
    const reader = new ArchiveReader(module);
    await reader.open(new Blob([bytes]));
    try {
      return run(reader);
    } finally {
      reader.close();
    }
  };

  return {
    list: bytes =>
      withReader(bytes, r => {
        const out: ListedEntry[] = [];
        for (const e of r.entries(true)) {
          if (e.path === null || (e.type !== 'FILE' && e.type !== 'DIR')) continue;
          out.push({ name: e.path, size: e.size, isDir: e.type === 'DIR' });
        }
        return out;
      }),
    extract: (bytes, name) =>
      withReader(bytes, r => {
        for (const e of r.entries(true, name)) {
          if (e.path === name && e.fileData) return new Uint8Array(e.fileData);
        }
        throw new Error(`${name} not found in the archive`);
      }),
  };
}
