/** The wabt module's service, typed and checked without importing wabt. */
import { isRecord } from '../../core/guards';

export interface WatOptions {
  /** Nested (folded) S-expressions instead of a flat instruction list. */
  foldExprs: boolean;
  /** `(export "name")` inside each function instead of separate export fields. */
  inlineExport: boolean;
}

export interface WabtLimits {
  /** Aborting it stops the disassembly at once (its worker is terminated). */
  signal?: AbortSignal;
}

export interface WabtService {
  /**
   * The module as WebAssembly text (WAT), with names from its name section, read with every
   * feature wabt supports turned on. Runs in a worker of its own, since wabt is synchronous:
   * aborting `limits.signal` terminates it and rejects with an AbortError. Rejects with wabt's
   * message when the module doesn't parse.
   */
  toWat(bytes: Uint8Array<ArrayBuffer>, options: WatOptions, limits?: WabtLimits): Promise<string>;
}

export const isWabtService = (s: unknown): s is WabtService =>
  isRecord(s) && typeof s.toWat === 'function';
