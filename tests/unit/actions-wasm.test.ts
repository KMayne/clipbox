import loadWabt from 'wabt';
import { describe, expect, it } from 'vitest';
import type { EntryId } from '../../src/core/types';
import type { RunProgress } from '../../src/engine/engine';
import { Engine } from '../../src/engine/engine';
import {
  createWabtRunner,
  createWabtService,
  wabtMessage,
  type WabtRequest,
  type WabtWorker,
} from '../../src/modules/wabt/wabt';
import type { WabtService } from '../../src/modules/wabt/service';
import { WAT_SIZE_LIMIT } from '../../src/core/actions/catalog/wasm';
import { custom, sampleComponent, sampleWasm, section, wasmModule } from '../fixtures/wasm';

const td = new TextDecoder();

interface FakeWorker extends WabtWorker {
  posted: WabtRequest[];
  terminated: boolean;
}

/** A runner "worker" in this thread; `answer` replies to each request (or never does). */
function fakeWorker(answer: (req: WabtRequest, reply: (data: unknown) => void) => void) {
  let onMessage: (data: unknown) => void = () => {};
  const w: FakeWorker = {
    posted: [],
    terminated: false,
    post(req) {
      w.posted.push(req);
      answer(req, data => {
        if (!w.terminated) setTimeout(() => onMessage(data), 0);
      });
    },
    listen(m) {
      onMessage = m;
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

/** Real wabt (its WASM is embedded in the package's script), run as the runner worker does. */
function inlineWorker(): FakeWorker {
  const handle = createWabtRunner(() => loadWabt());
  return fakeWorker((req, reply) => void handle(req).then(reply));
}

async function engineWith(bytes: Uint8Array<ArrayBuffer>, service?: WabtService) {
  const engine = new Engine({
    loaders: service ? { wabt: async () => ({ service }) } : {},
  });
  const blob = new Blob([bytes], { type: 'application/wasm' });
  const id: EntryId = 'en-1';
  await engine.ingest({ id, mime: blob.type, name: 'sample.wasm', size: blob.size, blob });
  const run = (action: string, params: Record<string, unknown> = {}, runId?: string) =>
    engine.runAction(id, 'wasm', action, params, runId);
  return { engine, run };
}

describe('Imports/exports as JSON', () => {
  it('lists imports and exports with their types', async () => {
    const { run } = await engineWith(sampleWasm());
    const [out] = await run('wasm.interface');
    expect(out?.name).toBe('sample-interface.json');
    expect(out?.mime).toBe('application/json');
    const json: unknown = JSON.parse(td.decode(out?.bytes));
    expect(json).toMatchObject({
      imports: [
        {
          module: 'wasi_snapshot_preview1',
          name: 'proc_exit',
          kind: 'func',
          type: '(i32) → ()',
          params: ['i32'],
          results: [],
        },
        { module: 'env', name: 'emscripten_notify_memory_growth', kind: 'func' },
        { module: 'env', name: '__indirect_function_table', kind: 'table' },
        { module: 'env', name: '__memory_base', kind: 'global', type: 'i32' },
      ],
      exports: [
        {
          name: 'add',
          kind: 'func',
          index: 2,
          function: 'add',
          type: '(i32, i32) → i32',
          params: ['i32', 'i32'],
          results: ['i32'],
        },
        { name: 'memory', kind: 'memory', index: 0 },
        { name: '_start', kind: 'func', function: '_start' },
        { name: '__stack_pointer', kind: 'global', type: 'mut i32 = 1024' },
        { name: 'table', kind: 'table' },
        { name: 'pair', kind: 'func', results: ['i32', 'i64'] },
      ],
    });
  });

  it('is only offered for core modules', async () => {
    const own = async (bytes: Uint8Array<ArrayBuffer>) => {
      const { engine } = await engineWith(bytes);
      return (await engine.actions('en-1', 'wasm')).filter(id => id.startsWith('wasm.'));
    };
    expect(await own(sampleComponent())).toEqual([]);
    expect(await own(sampleWasm())).toEqual(['wasm.disassemble', 'wasm.interface']);
  });
});

describe('Disassemble to WAT (real wabt)', () => {
  it('prints the module with its names, flat or folded', async () => {
    const { run } = await engineWith(sampleWasm(), createWabtService(inlineWorker));
    const [flat] = await run('wasm.disassemble');
    expect(flat?.name).toBe('sample.wat');
    expect(flat?.mime).toBe('text/plain');
    const text = td.decode(flat?.bytes);
    expect(text).toMatch(/^\(module \$sample/);
    expect(text).toContain('(import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit');
    expect(text).toContain('(func $add (type 0) (param $a i32) (param $b i32) (result i32)');
    expect(text).toContain('local.get $a\n    local.get $b\n    i32.add');
    expect(text).toContain('(export "add" (func $add))');
    expect(text).toContain('(start $_start)');
    expect(text).toContain('(data (;0;) (i32.const 8) "hi")');

    const [folded] = await run('wasm.disassemble', { foldExprs: true, inlineExport: true });
    const f = td.decode(folded?.bytes);
    expect(f).toContain('(i32.add\n      (local.get $a)\n      (local.get $b))');
    expect(f).toContain('(func $add (export "add")');
  });

  it("reports wabt's error for a module it can't read", async () => {
    const service = createWabtService(inlineWorker);
    // A function section without a type section: wabt rejects the type index
    const bad = wasmModule(section(3, [1, 0]), custom('x', []));
    await expect(service.toWat(bad, { foldExprs: false, inlineExport: false })).rejects.toThrow(
      /^0x[0-9a-f]+: /,
    );
  });

  it('formats wabt messages on one line', () => {
    expect(
      wabtMessage('readWasm failed:\n000000a: error: invalid section size: extends past end\n'),
    ).toBe('0xa: invalid section size: extends past end');
    expect(wabtMessage('')).toBe('wabt could not read the module');
  });
});

describe('Disassemble to WAT: limits', () => {
  it('needs "Allow large modules" over the size limit', async () => {
    const echo = createWabtService(() =>
      fakeWorker((req, reply) => reply({ id: req.id, ok: true, text: '(module)' })),
    );
    const big = wasmModule(custom('pad', Array<number>(WAT_SIZE_LIMIT).fill(0)));
    const { run } = await engineWith(big, echo);
    await expect(run('wasm.disassemble')).rejects.toThrow(
      'This module is 8.0 MB; its text could be ten times that. Turn on "Allow large modules"',
    );
    const [out] = await run('wasm.disassemble', { allowLarge: true });
    expect(td.decode(out?.bytes)).toBe('(module)');
  });

  it('Cancel terminates the runner worker', async () => {
    const spawned: FakeWorker[] = [];
    const service = createWabtService(() => {
      const w = fakeWorker(() => {});
      spawned.push(w);
      return w;
    });
    const { engine, run } = await engineWith(sampleWasm(), service);
    const reports: RunProgress[] = [];
    engine.onProgress(p => {
      reports.push(p);
      // Once the run has reached its worker
      setTimeout(() => engine.cancelAction(p.runId), 10);
    });
    await expect(run('wasm.disassemble', {}, 'run-wat')).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(reports[0]).toMatchObject({ runId: 'run-wat', message: 'Disassembling…' });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.terminated).toBe(true);
  });

  it('keeps one worker warm between runs', async () => {
    const spawned: FakeWorker[] = [];
    const service = createWabtService(() => {
      const w = inlineWorker();
      spawned.push(w);
      return w;
    });
    const opts = { foldExprs: false, inlineExport: false };
    await service.toWat(sampleWasm(), opts);
    await service.toWat(sampleWasm(), opts);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.terminated).toBe(false);
  });
});
