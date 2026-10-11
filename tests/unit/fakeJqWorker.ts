import { loadJq } from 'jq-wasm';
import { createJqRunner, type JqRequest, type JqWorker } from '../../src/modules/jq/jq';

/** Records what the service does with its workers. */
export interface FakeJqWorker extends JqWorker {
  posted: JqRequest[];
  terminated: boolean;
}

/**
 * A runner "worker" in this thread: `answer` gets each request and replies (or never does, to
 * stand in for a filter that never ends).
 */
export function fakeJqWorker(answer: (req: JqRequest, reply: (data: unknown) => void) => void) {
  let onMessage: (data: unknown) => void = () => {};
  let onError: (message: string) => void = () => {};
  const w: FakeJqWorker & { fail(message: string): void } = {
    posted: [],
    terminated: false,
    post(req) {
      w.posted.push(req);
      answer(req, data => {
        if (!w.terminated) setTimeout(() => onMessage(data), 0);
      });
    },
    listen(m, e) {
      onMessage = m;
      onError = e;
    },
    terminate() {
      w.terminated = true;
    },
    fail(message) {
      onError(message);
    },
  };
  return w;
}

/** A worker running real jq-wasm in this thread, as the runner worker does. */
export function inlineJqWorker(): FakeJqWorker {
  const handle = createJqRunner(() => loadJq());
  return fakeJqWorker((req, reply) => void handle(req).then(reply));
}
