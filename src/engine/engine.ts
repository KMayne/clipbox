import { makeContent, type EntryContent } from '../core/content';
import { oneLine, toBase64 } from '../core/format';
import { sha256 } from '../core/hash';
import type { ExportPayload } from '../core/interpreter';
import { detectKinds, getInterpreter } from '../core/interpreters';
import type {
  EntryId,
  IngestResult,
  Interpretation,
  Kind,
  RawEntry,
  RawView,
  Summary,
} from '../core/types';

interface EntryState {
  content: EntryContent;
  values: Map<Kind, unknown>;
  summaries: Map<Kind, Summary>;
}

export interface Materialised {
  summary: Summary;
  value: unknown;
}

/** Owns parsing and stats. Runs in a worker; plain class so it is unit-testable in Node. */
export class Engine {
  private entries = new Map<EntryId, EntryState>();

  async ingest(entry: RawEntry): Promise<IngestResult> {
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    const content = makeContent(entry.mime, bytes, entry.name);
    const state: EntryState = { content, values: new Map(), summaries: new Map() };
    this.entries.set(entry.id, state);

    const interpretations: Interpretation[] = [];
    for (const { kind, confidence } of detectKinds(content)) {
      const interpreter = getInterpreter(kind);
      try {
        const value = interpreter.parse(content);
        state.values.set(kind, value);
        interpretations.push({
          entryId: entry.id,
          kind,
          confidence,
          label: interpreter.label(value),
        });
      } catch {
        // detect() was optimistic; drop this interpretation
      }
    }
    return {
      hash: await sha256(bytes),
      preview: content.text !== null ? oneLine(content.text) : null,
      interpretations,
    };
  }

  materialise(entryId: EntryId, kind: Kind): Materialised {
    const state = this.state(entryId);
    if (!state.values.has(kind)) throw new Error(`Entry has no '${kind}' interpretation`);
    const value = state.values.get(kind);
    let summary = state.summaries.get(kind);
    if (!summary) {
      const interpreter = getInterpreter(kind);
      summary = { kind, label: interpreter.label(value), ...interpreter.summarise(value) };
      state.summaries.set(kind, summary);
    }
    return { summary, value };
  }

  exportValue(entryId: EntryId, kind: Kind): ExportPayload {
    return getInterpreter(kind).export(this.materialise(entryId, kind).value);
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

  private state(entryId: EntryId): EntryState {
    const s = this.entries.get(entryId);
    if (!s) throw new Error(`Unknown entry ${entryId}`);
    return s;
  }
}

export type EngineApi = Pick<
  Engine,
  'ingest' | 'materialise' | 'exportValue' | 'raw' | 'forget' | 'clear'
>;
