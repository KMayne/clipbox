/**
 * The jq runner: a dedicated worker, spawned by the jq module inside the engine worker, that runs
 * one filter at a time. jq-wasm runs synchronously, so a filter that never ends only blocks this
 * worker, and the module terminates it on Cancel or timeout.
 */
import { loadJq } from 'jq-wasm';
// Imported as a URL so the build emits it and the modules manifest lists it under 'jq'
import wasmUrl from 'jq-wasm/jq.wasm?url';
import { createJqRunner } from './jq';

const handle = createJqRunner(() => loadJq({ wasmURL: wasmUrl }));

self.onmessage = async (e: MessageEvent) => {
  self.postMessage(await handle(e.data));
};
