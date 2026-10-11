export type CaptureId = `c-${string}`;
export type EntryId = `en-${string}`;

/** Open set: interpreters register their own kinds. */
export type Kind = 'text' | 'json' | 'records' | 'html' | 'image' | 'binary' | (string & {});

export type CaptureSourceId = 'paste' | 'read' | 'drop' | 'file';

/** One clipboard format / dropped file, before any interpretation. */
export interface RawEntry {
  id: EntryId;
  mime: string;
  size: number;
  name?: string;
  blob: Blob;
}

export interface Capture {
  id: CaptureId;
  at: number;
  source: CaptureSourceId;
  entries: RawEntry[];
}

export interface StatRow {
  label: string;
  value: string;
  children?: StatRow[];
}

/** Inferred structural type; drives picker filtering, param autocomplete and TS injection. */
export type Schema =
  | { t: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
  | { t: 'array'; of: Schema; length?: number }
  | { t: 'object'; fields: Record<string, { schema: Schema; presence: number }> }
  | { t: 'union'; of: Schema[] };

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface Summary {
  kind: Kind;
  /** Size of the underlying content in bytes. */
  bytes: number;
  /** Monaco language id when the content is code/markup, e.g. 'typescript'. */
  language?: string;
  /** Short chip text, e.g. "JSON array · 42". */
  label: string;
  stats: StatRow[];
  schema?: Schema;
  /** Number of sliceable units: lines, rows, top-level children or bytes. */
  extent: number;
  columns?: ColumnInfo[];
}

/**
 * ready: parsed · loading: waiting on a module (call engine.resolve) · off: module disabled ·
 * error: parse or module load failed
 */
export type InterpretationStatus = 'ready' | 'loading' | 'off' | 'error';

export interface Interpretation {
  entryId: EntryId;
  kind: Kind;
  confidence: number;
  status: InterpretationStatus;
  /** Present once ready. */
  label?: string;
  /** Module that owns or is required by this interpretation, if not core. */
  module?: string;
  error?: string;
}

export interface IngestResult {
  hash: string;
  /** One-line preview of the raw content, or null for binary data. */
  preview: string | null;
  interpretations: Interpretation[];
}

export type JsonPath = (string | number)[];

export interface JsonChild {
  key: string | number;
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  preview: string;
  childCount?: number;
}

export type SliceRequest =
  | { type: 'lines'; from: number; to: number }
  | { type: 'rows'; from: number; to: number }
  | { type: 'children'; path: JsonPath; from: number; to: number }
  | { type: 'bytes'; from: number; to: number }
  | { type: 'full' };

export interface SliceResultMap {
  lines: string[];
  rows: Record<string, unknown>[];
  children: JsonChild[];
  bytes: Uint8Array;
  full: unknown;
}

export type SliceResult<R extends SliceRequest> = SliceResultMap[R['type']];

/** UI ↔ engine seam: previews only ever read values through this. */
export interface ValueHandle {
  summary: Summary;
  getSlice<R extends SliceRequest>(req: R): Promise<SliceResult<R>>;
}

export interface RawView {
  text?: string;
  base64?: string;
  truncated: boolean;
}
