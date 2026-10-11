import { createJqService } from './jq';
import type { JqService } from './service';

/**
 * jq 1.8 compiled to WebAssembly (jq-wasm), used by the "jq" action through
 * `ctx.service('jq', isJqService)`. It owns no kinds. Each run goes to a runner worker
 * (`runner.worker.ts`), nested in the engine worker, so it can be cancelled or time out.
 */
export const service: JqService = createJqService(() => {
  const w = new Worker(new URL('./runner.worker.ts', import.meta.url), {
    type: 'module',
    name: 'jq',
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
