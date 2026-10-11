import * as Comlink from 'comlink';
import { makeContent, type EntryContent } from '../core/content';
import { oneLine, toBase64 } from '../core/format';
import { sha256 } from '../core/hash';
import type { AnyInterpreter, ExportPayload, InterpretContext } from '../core/interpreter';
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
import { detectors, policyOf } from '../modules/registry';
import type { ModuleId, Policies, WorkerModule } from '../modules/types';
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

export type ModuleLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

export interface EngineOptions {
  loaders?: Partial<Record<string, () => Promise<WorkerModule>>>;
}

/** Owns parsing, stats and values. Runs in a worker; plain class so it is unit-testable in Node. */
export class Engine {
  private entries = new Map<EntryId, EntryState>();
  private policies: Policies = {};
  private modules = new Map<ModuleId, Promise<WorkerModule>>();
  private moduleStates = new Map<ModuleId, ModuleLoadState>();
  private loaders: Partial<Record<string, () => Promise<WorkerModule>>>;
  private ctx: InterpretContext = { service: (id, guard) => this.service(id, guard) };

  constructor(options: EngineOptions = {}) {
    this.loaders = options.loaders ?? workerLoaders;
  }

  setPolicies(policies: Policies): void {
    this.policies = policies;
    for (const id of Object.keys(this.loaders)) {
      if (policyOf(policies, id) === 'preload') void this.loadModule(id).catch(() => {});
    }
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
      const blocked = this.blockingModule(c);
      if (blocked) {
        interpretations.push({ ...base, status: 'off', module: blocked });
      } else if (this.pendingModules(c).length > 0) {
        interpretations.push({ ...base, status: 'loading', module: this.pendingModules(c)[0] });
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

  async exportValue(entryId: EntryId, kind: Kind): Promise<ExportPayload> {
    const state = this.state(entryId);
    const interpreter = await this.interpreter(this.candidate(state, kind));
    return interpreter.export(await this.value(entryId, kind));
  }

  /** Runs a derivation; the caller adds the result as a new capture. */
  async derive(entryId: EntryId, kind: Kind, derivationId: string): Promise<DerivedContent> {
    const state = this.state(entryId);
    const interpreter = await this.interpreter(this.candidate(state, kind));
    const result = await interpreter.derive(await this.value(entryId, kind), derivationId);
    // Copy: the bytes may share a buffer with the value, and transferring would detach it
    const bytes = result.bytes.slice();
    return Comlink.transfer({ ...result, bytes }, [bytes.buffer]);
  }

  raw(entryId: EntryId, limit = 100 * 1024): RawView {
    const { content } = this.state(entryId);
    const truncated = content.size > limit;
    if (content.text !== null) return { text: content.text.slice(0, limit), truncated };
    return { base64: toBase64(content.bytes.subarray(0, limit)), truncated };
  }

  forget(entryId: EntryId): void {
    this.entries.delete(entryId);
  }

  clear(): void {
    this.entries.clear();
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

  /** The owning module, if it is switched off. */
  private blockingModule(c: Candidate): ModuleId | null {
    return c.module !== 'core' && policyOf(this.policies, c.module) === 'off' ? c.module : null;
  }

  /** Modules (owning or required, not off) that still have to load before parsing. */
  private pendingModules(c: Candidate): ModuleId[] {
    const required = c.module === 'core' ? (this.coreInterpreter(c.kind)?.requires ?? []) : [];
    return [c.module, ...required].filter(
      id =>
        id !== 'core' &&
        policyOf(this.policies, id) !== 'off' &&
        this.moduleStates.get(id) !== 'loaded',
    );
  }

  private value(entryId: EntryId, kind: Kind): Promise<unknown> {
    const state = this.state(entryId);
    let value = state.values.get(kind);
    if (!value) {
      const c = this.candidate(state, kind);
      const blocked = this.blockingModule(c);
      if (blocked) return Promise.reject(new Error(`Module '${blocked}' is off`));
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
    if (policyOf(this.policies, id) === 'off') return null;
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

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export type EngineApi = Pick<
  Engine,
  | 'setPolicies'
  | 'moduleLoadStates'
  | 'ingest'
  | 'resolve'
  | 'summary'
  | 'slice'
  | 'exportValue'
  | 'derive'
  | 'raw'
  | 'forget'
  | 'clear'
>;
