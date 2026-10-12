/**
 * The wabt runner: a dedicated worker, spawned by the wabt module inside the engine worker, that
 * disassembles one module at a time. wabt runs synchronously, so a huge module only blocks this
 * worker, and the module terminates it on Cancel. wabt's own WASM is embedded in its script.
 */
import loadWabt from 'wabt';
import { createWabtRunner } from './wabt';

const handle = createWabtRunner(() => loadWabt());

self.onmessage = async (e: MessageEvent) => {
  self.postMessage(await handle(e.data));
};
