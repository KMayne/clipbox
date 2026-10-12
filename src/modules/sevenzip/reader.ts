/**
 * 7-Zip 24.09 (7z-wasm) run directly in the engine worker, one command at a time through
 * `callMain`. The build keeps the runtime alive after `main` returns (`noExitRuntime`), so one
 * instance serves many commands: a failing command just returns its exit code. If the runtime
 * itself dies (an abort, out of memory), the instance is dropped and the next call makes a new one.
 */
import sevenZipFactory, { type FileSystem, type SevenZipModule } from '7z-wasm/7zz.es6.js';
import { parseSlt, type SltListing } from './listing';

/** 7-Zip's archive handler: `-tiso` or `-tudf`. Forcing it keeps hybrid images from opening as MBR. */
export type DiscHandler = 'iso' | 'udf';

export interface SevenZip {
  /** `7zz l -slt`: the archive's properties and items. Throws with 7-Zip's error on failure. */
  list(bytes: Uint8Array<ArrayBuffer>, handler: DiscHandler): Promise<SltListing>;
  /** Extracts one file by the path the listing gave. */
  extract(
    bytes: Uint8Array<ArrayBuffer>,
    handler: DiscHandler,
    path: string,
  ): Promise<Uint8Array<ArrayBuffer>>;
}

const INPUT_DIR = '/in';
const INPUT = `${INPUT_DIR}/disc.img`;
const OUTPUT_DIR = '/out';
/** After extracting more than this, the instance is dropped so its grown heap can be freed. */
const RECYCLE_BYTES = 64 * 1024 * 1024;
/** No progress bar (it writes carriage returns to stdout), and UTF-8 console output. */
const QUIET = ['-bd', '-sccUTF-8'];

interface Run {
  code: number;
  out: string[];
  err: string[];
}

/** One blob per input, so listing and every extraction share it. */
const blobs = new WeakMap<Uint8Array, Blob>();

function blobOf(bytes: Uint8Array<ArrayBuffer>): Blob {
  let blob = blobs.get(bytes);
  if (!blob) {
    blob = new Blob([bytes]);
    blobs.set(bytes, blob);
  }
  return blob;
}

/**
 * Makes the input visible at INPUT. In a worker, WORKERFS serves reads straight from a Blob with
 * FileReaderSync, so a multi-GB image is never copied into the WASM heap (which is capped at
 * 4 GB, and would need a second copy's worth of memory). The Blob is one more copy, made once per
 * entry, but it lives outside the heap and Chromium can page large blobs to disk. Elsewhere
 * (Node, in the unit tests) the bytes are written into MEMFS, which does copy them into the heap.
 */
function mountInput(m: SevenZipModule, bytes: Uint8Array<ArrayBuffer>): () => void {
  const fs = m.FS;
  fs.mkdir(INPUT_DIR);
  if ('FileReaderSync' in globalThis) {
    fs.mount(m.WORKERFS, { blobs: [{ name: 'disc.img', data: blobOf(bytes) }] }, INPUT_DIR);
    return () => {
      fs.unmount(INPUT_DIR);
      fs.rmdir(INPUT_DIR);
    };
  }
  fs.writeFile(INPUT, bytes);
  return () => {
    fs.unlink(INPUT);
    fs.rmdir(INPUT_DIR);
  };
}

const exists = (fs: FileSystem, path: string) => {
  try {
    fs.stat(path);
    return true;
  } catch {
    return false;
  }
};

/** Deletes a directory tree in MEMFS (an explicit stack: the tree comes from the image). */
function removeTree(fs: FileSystem, root: string): void {
  if (!exists(fs, root)) return;
  const dirs: string[] = [];
  const stack = [root];
  for (let dir = stack.pop(); dir !== undefined; dir = stack.pop()) {
    dirs.push(dir);
    for (const name of fs.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      const path = `${dir}/${name}`;
      if (fs.isDir(fs.lstat(path).mode)) stack.push(path);
      else fs.unlink(path);
    }
  }
  for (let i = dirs.length - 1; i >= 0; i--) {
    const dir = dirs[i];
    if (dir !== undefined) fs.rmdir(dir);
  }
}

/** The first regular file under `root`, depth first. */
function findFile(fs: FileSystem, root: string): string | null {
  const stack = [root];
  for (let dir = stack.pop(); dir !== undefined; dir = stack.pop()) {
    for (const name of fs.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      const path = `${dir}/${name}`;
      const mode = fs.lstat(path).mode;
      if (fs.isFile(mode)) return path;
      if (fs.isDir(mode)) stack.push(path);
    }
  }
  return null;
}

/** 7-Zip's own error lines ("ERROR: …", "Can't open as archive"), else its exit code. */
function failure(run: Run, what: string): Error {
  const lines = [...run.err, ...run.out]
    .map(l => l.trim())
    .filter(l => /error|can(no|')t|unsupported|not/i.test(l) && !l.startsWith('7-Zip'));
  return new Error(
    lines.length > 0 ? lines.join(' ') : `7-Zip couldn't ${what} (exit ${run.code})`,
  );
}

/** Instantiates 7-Zip from its WASM bytes (fetched in the worker, read from disk in tests). */
export async function createSevenZip(wasm: ArrayBuffer | Uint8Array): Promise<SevenZip> {
  const wasmBinary = wasm instanceof ArrayBuffer ? wasm : new Uint8Array(wasm).buffer;
  // Lines from the running command; everything else 7-Zip prints is dropped
  let sink: Run | null = null;
  let instance: Promise<SevenZipModule> | null = null;

  const module = () => {
    instance ??= sevenZipFactory({
      wasmBinary,
      print: line => sink?.out.push(line),
      printErr: line => sink?.err.push(line),
    });
    instance.catch(() => (instance = null));
    return instance;
  };

  /** Runs one command against the mounted input, cleaning up the file system whatever happens. */
  async function run<T>(
    bytes: Uint8Array<ArrayBuffer>,
    args: string[],
    after: (m: SevenZipModule, run: Run) => T,
  ): Promise<T> {
    const m = await module();
    const unmount = mountInput(m, bytes);
    const result: Run = { code: 0, out: [], err: [] };
    sink = result;
    try {
      try {
        result.code = Number(m.callMain(args)) || 0;
      } catch (err) {
        // The runtime aborted: this instance can't be trusted again
        instance = null;
        throw err;
      }
      return after(m, result);
    } finally {
      sink = null;
      removeTree(m.FS, OUTPUT_DIR);
      unmount();
    }
  }

  // Instantiate now, so a broken download fails the module load (and is retried) up front
  await module();
  return {
    list: (bytes, handler) =>
      run(bytes, ['l', '-slt', `-t${handler}`, ...QUIET, '--', INPUT], (_, r) => {
        const listing = parseSlt(r.out);
        if (r.code !== 0 && listing.items.length === 0) throw failure(r, 'read the image');
        return listing;
      }),
    extract: (bytes, handler, path) =>
      // `e` drops the folders, `-spd` treats the name literally (no wildcards), `--` ends switches
      run(
        bytes,
        ['e', `-t${handler}`, ...QUIET, '-y', '-spd', `-o${OUTPUT_DIR}`, '--', INPUT, path],
        (m, r) => {
          const file = exists(m.FS, OUTPUT_DIR) ? findFile(m.FS, OUTPUT_DIR) : null;
          if (!file) throw r.code !== 0 ? failure(r, `extract ${path}`) : notFound(path);
          const data = m.FS.readFile(file);
          if (data.byteLength > RECYCLE_BYTES) instance = null;
          return data.buffer instanceof ArrayBuffer
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data);
        },
      ),
  };
}

const notFound = (path: string) => new Error(`${path} not found in the image`);
