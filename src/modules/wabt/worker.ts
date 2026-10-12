import type { WabtService } from './service';
import { createWabtService } from './wabt';

/**
 * WABT (the WebAssembly Binary Toolkit, Apache-2.0), used by the "Disassemble to WAT" action
 * through `ctx.service('wabt', isWabtService)`. It owns no kinds. Each run goes to a runner
 * worker (`runner.worker.ts`), nested in the engine worker, so it can be cancelled.
 */
export const service: WabtService = createWabtService(() => {
  const w = new Worker(new URL('./runner.worker.ts', import.meta.url), {
    type: 'module',
    name: 'wabt',
  });
  return {
    post: request => w.postMessage(request),
    listen(onMessage, onError) {
      w.onmessage = e => onMessage(e.data);
      w.onerror = e => {
        e.preventDefault();
        onError(e.message);
      };
    },
    terminate: () => w.terminate(),
  };
});
