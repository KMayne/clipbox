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

export interface JqLimits {
  /** Aborting it stops the run at once (its worker is terminated). */
  signal?: AbortSignal;
  /** Seconds before the run is stopped with "jq timed out after N s". */
  timeout?: number;
}

/** The default for `JqLimits.timeout`, in seconds. */
export const JQ_TIMEOUT = 30;

export interface JqService {
  /**
   * Runs `filter` over `input`, JSON text holding one or more values (whitespace-separated, as
   * jq reads stdin), in a worker of its own: a filter that never ends can be cancelled or time
   * out without blocking anything else. Resolves to jq's stdout; rejects with jq's message on a
   * compile or runtime error, an AbortError when `limits.signal` aborts, or a timeout error.
   */
  run(input: string, filter: string, options: JqOptions, limits?: JqLimits): Promise<string>;
}

export const isJqService = (s: unknown): s is JqService =>
  isRecord(s) && typeof s.run === 'function';
