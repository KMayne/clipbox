/** The jq module's service, typed and checked without importing jq-wasm. */
import { isRecord } from '../../core/guards';

export interface JqOptions {
  /** `-r`: strings printed without quotes. */
  raw: boolean;
  /** `-c`: one line per output. */
  compact: boolean;
  /** `-s`: every input value read into one array. */
  slurp: boolean;
  /** `--arg name value` (`json: false`) or `--argjson name value`. */
  args: { name: string; value: string; json: boolean }[];
}

export interface JqService {
  /**
   * Runs `filter` over `input`, JSON text holding one or more values (whitespace-separated, as
   * jq reads stdin). Resolves to jq's stdout; rejects with jq's message on a compile or runtime
   * error.
   */
  run(input: string, filter: string, options: JqOptions): Promise<string>;
}

export const isJqService = (s: unknown): s is JqService =>
  isRecord(s) && typeof s.run === 'function';
