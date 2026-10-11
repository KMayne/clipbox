export type CaptureId = `c-${string}`;
export type EntryId = `en-${string}`;

/** Open set: interpreters register their own kinds. */
export type Kind = 'text' | 'json' | 'records' | 'html' | 'image' | 'binary' | (string & {});

export type CaptureSourceId = 'paste' | 'read' | 'drop' | 'file' | 'derived';

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
  /** For derived captures: the interpretation it came from and the derivation's label. */
  parent?: { entryId: EntryId; kind: Kind; label: string };
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
  /**
   * For values holding several tables (spreadsheet sheets, SQLite tables). `extent` and
   * `columns` above describe table 0; `rows` slices pick a table with their `table` index.
   */
  tables?: TableInfo[];
  /** Ways to open this value as a new capture, e.g. "Decode" or "As CSV". */
  derivations?: Derivation[];
}

/** One table of a multi-table value. */
export interface TableInfo {
  name: string;
  /** Row count; an estimate (or 0 if unknown) when `exact` is false. */
  extent: number;
  /** False when `extent` hasn't been counted; call `ValueHandle.count(table)`. Default true. */
  exact?: boolean;
  columns: ColumnInfo[];
}

/** A way to turn a value into new content, which becomes a derived capture. */
export interface Derivation {
  id: string;
  label: string;
}

/** Content produced by a derivation; it goes through detection like any other entry. */
export interface DerivedContent {
  mime: string;
  name?: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * ready: parsed · loading: waiting on a module (call engine.resolve) · off: module disabled ·
 * error: parse or module load failed
 */
export type InterpretationStatus = 'ready' | 'loading' | 'error';

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

/** Window of a value requested from the engine. Results are validated in engine/valueHandle.ts. */
export type SliceRequest =
  | { type: 'lines'; from: number; to: number }
  /** `table` indexes `Summary.tables`; omitted means the value's only (or first) table. */
  | { type: 'rows'; from: number; to: number; table?: number }
  | { type: 'children'; path: JsonPath; from: number; to: number }
  | { type: 'bytes'; from: number; to: number }
  /** Whole text (text, HTML source). */
  | { type: 'text' }
  /** Image bytes and MIME type. */
  | { type: 'image' }
  /** Whole JSON value (used for top-level scalars). */
  | { type: 'json' }
  /** Rendered HTML (Markdown). */
  | { type: 'html' }
  /** Playable audio/video bytes and MIME type. */
  | { type: 'media' }
  /** One page (0-based) rendered to PNG at `scale` × its natural size (PDF). */
  | { type: 'page'; index: number; scale: number }
  /** Exact row count of one table of a multi-table value (may be slow; call on demand). */
  | { type: 'count'; table: number };

export interface ImageData {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
}

/** Audio or video bytes; `mime` is audio/* when there's no video track. */
export interface MediaData {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
}

/** UI ↔ engine seam: previews only ever read values through this. */
export interface ValueHandle {
  summary: Summary;
  lines(from: number, to: number): Promise<string[]>;
  rows(from: number, to: number, table?: number): Promise<Record<string, unknown>[]>;
  children(path: JsonPath, from: number, to: number): Promise<JsonChild[]>;
  bytes(from: number, to: number): Promise<Uint8Array<ArrayBuffer>>;
  text(): Promise<string>;
  image(): Promise<ImageData>;
  json(): Promise<unknown>;
  html(): Promise<string>;
  media(): Promise<MediaData>;
  /** PNG of page `index` (0-based) at `scale`. */
  page(index: number, scale: number): Promise<ImageData>;
  /** Exact row count of table `table` (see `TableInfo.exact`). */
  count(table: number): Promise<number>;
}

export interface RawView {
  text?: string;
  base64?: string;
  truncated: boolean;
}
