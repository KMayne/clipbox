import { loadJq } from 'jq-wasm';
// Imported as a URL so the build emits it and the modules manifest lists it under 'jq'
import wasmUrl from 'jq-wasm/jq.wasm?url';
import { createJqService } from './jq';
import type { JqService } from './service';

/**
 * jq 1.8 compiled to WebAssembly (jq-wasm), used by the "jq" action through
 * `ctx.service('jq', isJqService)`. It owns no kinds.
 */
export const service: JqService = createJqService(() => loadJq({ wasmURL: wasmUrl }));
