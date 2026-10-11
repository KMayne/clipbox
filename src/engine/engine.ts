import * as Comlink from 'comlink';
import { actionImpl, actionImpls } from '../core/actions/run';
import { appliesToKind, type ActionContext, type ActionEffect } from '../core/actions/types';
import { makeContent, type EntryContent } from '../core/content';
import { oneLine, toBase64 } from '../core/format';
import { sha256 } from '../core/hash';
import { abortError, throttle, type ProgressReport, type TaskContext } from '../core/progress';
import type {
  AnyInterpreter,
  ExportOptions,
  ExportPayload,
  InterpretContext,
} from '../core/interpreter';
import { interpreters as coreInterpreters } from '../core/interpreters';
import type {
  DerivedContent,
  EntryId,
  IngestResult,
  Interpretation,
  Kind,
  RawEntry,
  RawView,
  SliceRequest,
  Summary,
} from '../core/types';
import { detectors } from '../modules/registry';
import type { ModuleId, WorkerModule } from '../modules/types';
import { workerLoaders } from '../modules/workerLoaders';

interface Candidate {
  kind: Kind;
  confidence: number;
  /** Owning module; 'core' for built-in kinds. */
  module: ModuleId;
}

interface EntryState {
  content: EntryContent;
  candidates: Candidate[];
  values: Map<Kind, Promise<unknown>>;
  summaries: Map<Kind, Promise<Summary>>;
}

/** A progress report for one run (`runAction`/`derive` with a run id), sent to the UI. */
export interface RunProgress extends ProgressReport {
  runId: string;
}

/** Receives every run's progress; the UI passes a `Comlink.proxy`'d function. */
export type ProgressListener = (progress: RunProgress) => void;

interface Run {
  entryId: EntryId;
  controller: AbortController;
}

export type ModuleLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

export interface EngineOptions {
  loaders?: Partial<Record<string, () => Promise<WorkerModule>>>;
}

/** Owns parsing, stats and values. Runs in a worker; plain class so it is unit-testable in Node. */
export class Engine {
  private entries = new Map<EntryId, EntryState>();
  private modules = new Map<ModuleId, Promise<WorkerModule>>();
  private moduleStates = new Map<ModuleId, ModuleLoadState>();
  private loaders: Partial<Record<string, () => Promise<WorkerModule>>>;
  private ctx: InterpretContext = { service: (id, guard) => this.service(id, guard) };
  private runs = new Map<string, Run>();
  private progressListener: ProgressListener | null = null;
  private nextRun = 0;

  constructor(options: EngineOptions = {}) {
    this.loaders = options.loaders ?? workerLoaders;
  }

  moduleLoadStates(): Record<string, ModuleLoadState> {
    return Object.fromEntries(this.moduleStates);
  }

  /** Detects candidates and parses those whose modules are already available. */
  async ingest(entry: RawEntry): Promise<IngestResult> {
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    const content = makeContent(entry.mime, bytes, entry.name);
    const candidates = this.detect(content);
    const state: EntryState = { content, candidates, values: new Map(), summaries: new Map() };
    this.entries.set(entry.id, state);

    const interpretations: Interpretation[] = [];
    for (const c of candidates) {
      const base = { entryId: entry.id, kind: c.kind, confidence: c.confidence };
      const pending = this.pendingModules(c);
      if (pending.length > 0) {
        interpretations.push({ ...base, status: 'loading', module: pending[0] });
      } else {
        const r = await this.resolve(entry.id, c.kind);
        if (r.status !== 'error') interpretations.push(r);
      }
    }
    return {
      hash: await sha256(bytes),
      preview: content.text !== null ? oneLine(content.text) : null,
      interpretations,
    };
  }

  /** Loads whatever modules the interpretation needs, parses it and returns its final state. */
  async resolve(entryId: EntryId, kind: Kind): Promise<Interpretation> {
    const state = this.state(entryId);
    const c = state.candidates.find(x => x.kind === kind);
    if (!c) throw new Error(`Entry has no '${kind}' interpretation`);
    const base = { entryId, kind, confidence: c.confidence };
    const module = c.module === 'core' ? undefined : c.module;
    try {
      const value = await this.value(entryId, kind);
      const interpreter = await this.interpreter(c);
      return { ...base, module, status: 'ready', label: interpreter.label(value) };
    } catch (err) {
      return { ...base, module, status: 'error', error: errorMessage(err) };
    }
  }

  async summary(entryId: EntryId, kind: Kind): Promise<Summary> {
    const state = this.state(entryId);
    let summary = state.summaries.get(kind);
    if (!summary) {
      summary = (async () => {
        const value = await this.value(entryId, kind);
        const interpreter = await this.interpreter(this.candidate(state, kind));
        const rest = await interpreter.summarise(value);
        const derivations = interpreter.derivations(value);
        return {
          kind,
          label: interpreter.label(value),
          bytes: state.content.size,
          ...rest,
          ...(derivations.length > 0 && { derivations }),
        };
      })();
      summary.catch(() => state.summaries.delete(kind));
      state.summaries.set(kind, summary);
    }
    return summary;
  }

  async slice(entryId: EntryId, kind: Kind, req: SliceRequest): Promise<unknown> {
    const state = this.state(entryId);
    const interpreter = await this.interpreter(this.candidate(state, kind));
    const result = await interpreter.slice(await this.value(entryId, kind), req);
    if (result instanceof Uint8Array) return Comlink.transfer(result, [result.buffer]);
    return result;
  }

  async exportValue(entryId: EntryId, kind: Kind, options?: ExportOptions): Promise<ExportPayload> {
    const state = this.state(entryId);
    const interpreter = await this.interpreter(this.candidate(state, kind));
    return interpreter.export(await this.value(entryId, kind), options);
  }

  /** Runs a derivation; the caller adds the result as a new capture. */
  derive(
    entryId: EntryId,
    kind: Kind,
    derivationId: string,
    runId?: string,
  ): Promise<DerivedContent> {
    return this.track(runId, entryId, async task => {
      const state = this.state(entryId);
      const interpreter = await this.interpreter(this.candidate(state, kind));
      const value = await this.value(entryId, kind);
      return transferCopy(await interpreter.derive(value, derivationId, task));
    });
  }

  /** Subscribes to every run's progress (one listener; null unsubscribes). */
  onProgress(listener: ProgressListener | null): void {
    this.progressListener = listener;
  }

  /**
   * Aborts a run started with `runId`: its signal fires, and it rejects with an AbortError (even
   * if the action finishes anyway). Unknown or finished runs are ignored.
   */
  cancelAction(runId: string): void {
    this.runs.get(runId)?.controller.abort();
  }

  /** Ids of the runs still going (for tests). */
  activeRuns(): string[] {
    return [...this.runs.keys()];
  }

  /**
   * Registers a run (synchronously, so a cancel sent right after the call finds it), gives the
   * work a signal and a throttled progress reporter, and turns any failure after a cancel into an
   * AbortError.
   */
  private async track<T>(
    runId: string | undefined,
    entryId: EntryId,
    work: (task: TaskContext) => Promise<T>,
  ): Promise<T> {
    const id = runId ?? `run-${++this.nextRun}`;
    if (this.runs.has(id)) throw new Error(`Run ${id} is already going`);
    const controller = new AbortController();
    this.runs.set(id, { entryId, controller });
    const reporter = throttle(report => {
      const listener = this.progressListener;
      // Across Comlink this returns a promise; a closed page shouldn't become an unhandled error
      if (listener) void Promise.resolve(listener({ runId: id, ...report })).catch(() => {});
    });
    const { signal } = controller;
    try {
      const result = await work({ signal, progress: (f, m) => reporter.report(f, m) });
      if (signal.aborted) throw abortError();
      reporter.flush();
      return result;
    } catch (err) {
      reporter.dispose();
      throw signal.aborted ? abortError() : err;
    } finally {
      this.runs.delete(id);
    }
  }

  /** Ids of the actions that apply to this interpretation, in catalog order. */
  async actions(entryId: EntryId, kind: Kind): Promise<string[]> {
    const state = this.state(entryId);
    const value = await this.value(entryId, kind);
    return actionImpls
      .filter(a => appliesToKind(a.info, kind) && a.applies(value, state.content))
      .map(a => a.info.id);
  }

  /**
   * Runs an action; the caller adds the result as a new capture. `params` comes from the UI, so
   * the action validates it against its schema before running.
   */
  runAction(
    entryId: EntryId,
    kind: Kind,
    actionId: string,
    params: unknown,
    runId?: string,
  ): Promise<DerivedContent[]> {
    return this.track(runId, entryId, async task => {
      const { impl, value, content, ctx } = await this.prepareAction(entryId, kind, actionId, task);
      const results = await impl.run(value, content, params, ctx);
      // Copy: the bytes may share a buffer with the value, and transferring would detach it
      const copies = results.map(r => ({ ...r, bytes: r.bytes.slice() }));
      return Comlink.transfer(
        copies,
        copies.map(c => c.bytes.buffer),
      );
    });
  }

  /** Runs an effect action (`info.effect`); the caller carries out the returned effect. */
  actionEffect(
    entryId: EntryId,
    kind: Kind,
    actionId: string,
    params: unknown,
    runId?: string,
  ): Promise<ActionEffect> {
    return this.track(runId, entryId, async task => {
      const { impl, value, content, ctx } = await this.prepareAction(entryId, kind, actionId, task);
      if (!impl.effect) throw new Error(`${impl.info.title} makes a capture; use runAction`);
      return impl.effect(value, content, params, ctx);
    });
  }

  private async prepareAction(entryId: EntryId, kind: Kind, actionId: string, task: TaskContext) {
    const { content } = this.state(entryId);
    const impl = actionImpl(actionId);
    if (!impl || !appliesToKind(impl.info, kind)) {
      throw new Error(`No '${actionId}' action for ${kind}`);
    }
    const { module } = impl.info;
    if (module) await this.loadModule(module); // fail clearly if it can't load
    const value = await this.value(entryId, kind);
    const ctx: ActionContext = {
      ...task,
      service: (id, guard) => this.service(id, guard),
    };
    return { impl, value, content, ctx };
  }

  raw(entryId: EntryId, limit = 100 * 1024): RawView {
    const { content } = this.state(entryId);
    const truncated = content.size > limit;
    if (content.text !== null) return { text: content.text.slice(0, limit), truncated };
    return { base64: toBase64(content.bytes.subarray(0, limit)), truncated };
  }

  /** A window of the entry's original bytes, whatever its kind (for the hex dump). */
  rawBytes(entryId: EntryId, from: number, to: number): Uint8Array<ArrayBuffer> {
    const { bytes } = this.state(entryId).content;
    const start = Math.max(0, Math.min(from, bytes.length));
    const slice = bytes.slice(start, Math.max(start, Math.min(to, bytes.length)));
    return Comlink.transfer(slice, [slice.buffer]);
  }

  /** Drops an entry, cancelling any run on it. */
  forget(entryId: EntryId): void {
    this.entries.delete(entryId);
    for (const run of this.runs.values()) if (run.entryId === entryId) run.controller.abort();
  }

  clear(): void {
    this.entries.clear();
    for (const run of this.runs.values()) run.controller.abort();
  }

  private detect(content: EntryContent): Candidate[] {
    const core = coreInterpreters.map((i): Candidate => ({
      kind: i.kind,
      confidence: i.detect(content),
      module: 'core',
    }));
    const lazy = detectors.map(d => ({
      kind: d.kind,
      confidence: d.detect(content),
      module: d.module,
    }));
    return [...core, ...lazy]
      .filter(c => c.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Modules (owning or required) that still have to load before parsing. One with no loader
   * can't load: a required one is skipped (its service is null), an owning one fails on resolve.
   */
  private pendingModules(c: Candidate): ModuleId[] {
    const required = c.module === 'core' ? (this.coreInterpreter(c.kind)?.requires ?? []) : [];
    return [c.module, ...required].filter(
      id => id !== 'core' && this.loaders[id] && this.moduleStates.get(id) !== 'loaded',
    );
  }

  private value(entryId: EntryId, kind: Kind): Promise<unknown> {
    const state = this.state(entryId);
    let value = state.values.get(kind);
    if (!value) {
      const c = this.candidate(state, kind);
      value = this.interpreter(c).then(i => i.parse(state.content, this.ctx));
      value.catch(() => state.values.delete(kind));
      state.values.set(kind, value);
    }
    return value;
  }

  private async interpreter(c: Candidate): Promise<AnyInterpreter> {
    if (c.module === 'core') {
      const core = this.coreInterpreter(c.kind);
      if (!core) throw new Error(`No core interpreter for '${c.kind}'`);
      return core;
    }
    const mod = await this.loadModule(c.module);
    const interpreter = mod.interpreters?.find(i => i.kind === c.kind);
    if (!interpreter) throw new Error(`Module '${c.module}' has no '${c.kind}' interpreter`);
    return interpreter;
  }

  private coreInterpreter(kind: Kind): AnyInterpreter | undefined {
    return coreInterpreters.find(i => i.kind === kind);
  }

  private async service<T>(id: ModuleId, guard: (s: unknown) => s is T): Promise<T | null> {
    try {
      const { service } = await this.loadModule(id);
      return guard(service) ? service : null;
    } catch {
      return null; // e.g. offline and not cached: degrade gracefully
    }
  }

  private loadModule(id: ModuleId): Promise<WorkerModule> {
    let mod = this.modules.get(id);
    if (!mod) {
      const loader = this.loaders[id];
      if (!loader) return Promise.reject(new Error(`Module '${id}' has no worker part`));
      this.moduleStates.set(id, 'loading');
      mod = loader();
      this.modules.set(id, mod);
      mod.then(
        () => this.moduleStates.set(id, 'loaded'),
        () => {
          this.moduleStates.set(id, 'failed');
          this.modules.delete(id); // allow retry, e.g. once back online
        },
      );
    }
    return mod;
  }

  private candidate(state: EntryState, kind: Kind): Candidate {
    const c = state.candidates.find(x => x.kind === kind);
    if (!c) throw new Error(`Entry has no '${kind}' interpretation`);
    return c;
  }

  private state(entryId: EntryId): EntryState {
    const s = this.entries.get(entryId);
    if (!s) throw new Error(`Unknown entry ${entryId}`);
    return s;
  }
}

/** Copies the bytes (they may share a buffer with the value, which transferring would detach). */
function transferCopy(result: DerivedContent): DerivedContent {
  const bytes = result.bytes.slice();
  return Comlink.transfer({ ...result, bytes }, [bytes.buffer]);
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export type EngineApi = Pick<
  Engine,
  | 'moduleLoadStates'
  | 'ingest'
  | 'resolve'
  | 'summary'
  | 'slice'
  | 'exportValue'
  | 'derive'
  | 'actions'
  | 'runAction'
  | 'actionEffect'
  | 'onProgress'
  | 'cancelAction'
  | 'raw'
  | 'rawBytes'
  | 'forget'
  | 'clear'
>;
