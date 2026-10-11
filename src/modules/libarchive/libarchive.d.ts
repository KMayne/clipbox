/* Types for the parts of libarchive.js we use directly (its own types only cover the DOM-worker API). */

declare module 'libarchive.js/src/webworker/wasm-module.js' {
  /** Emscripten module options; `initFunctions` wires up `runCode` once instantiated. */
  export class WasmModule {
    wasmBinary?: ArrayBuffer | Uint8Array;
    print(...text: unknown[]): void;
    printErr(...text: unknown[]): void;
    initFunctions(): void;
  }
}

declare module 'libarchive.js/src/webworker/wasm-gen/libarchive.js' {
  import type { WasmModule } from 'libarchive.js/src/webworker/wasm-module.js';
  /** Instantiates the WASM; resolves with the same module object, now initialised. */
  export default function libarchive(module: WasmModule): Promise<WasmModule>;
}

declare module 'libarchive.js/src/webworker/archive-reader.js' {
  import type { WasmModule } from 'libarchive.js/src/webworker/wasm-module.js';
  export interface ReaderEntry {
    path: string | null;
    size: number;
    /** FILE, DIR, SYMBOLIC_LINK, … */
    type?: string;
    fileData?: Uint8Array;
  }
  export class ArchiveReader {
    constructor(module: WasmModule);
    open(file: Blob): Promise<void>;
    close(): void;
    /** Walks the archive; with `skipExtraction`, only `except` gets its data read. */
    entries(skipExtraction?: boolean, except?: string | null): Generator<ReaderEntry>;
  }
}
