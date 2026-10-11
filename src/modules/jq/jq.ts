import type { Jq } from 'jq-wasm';
import type { JqOptions, JqService } from './service';

/** The flags for `options`, in jq's command-line form. */
export function jqFlags({ raw, compact, slurp, args }: JqOptions): string[] {
  const flags: string[] = [];
  if (raw) flags.push('-r');
  if (compact) flags.push('-c');
  if (slurp) flags.push('-s');
  for (const a of args) flags.push(a.json ? '--argjson' : '--arg', a.name, a.value);
  return flags;
}

/**
 * jq's stderr on one line for the notice: without the stdin location (meaningless here), the
 * caret line (it can't line up in a notice) and the "N compile errors" footer.
 */
export const jqMessage = (stderr: string) =>
  stderr
    .replace(/ \(at \/dev\/stdin:\d+\)/g, '')
    .replace(/\/dev\/stdin/g, 'input')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !/^\^+$/.test(line) && !/^jq: \d+ compile errors?$/.test(line))
    .join(' ');

/** A jq service over a lazily-loaded jq-wasm instance (loaded once, reused for every run). */
export function createJqService(load: () => Promise<Jq>): JqService {
  let jq: Promise<Jq> | null = null;
  const get = () =>
    (jq ??= load().catch((err: unknown) => {
      jq = null; // allow a retry, e.g. once back online
      throw err;
    }));
  return {
    async run(input, filter, options) {
      // Synchronous inside the wasm: a filter that never ends (e.g. `repeat(.)`) can't be stopped
      const { stdout, stderr, exitCode } = (await get()).raw(input, filter, jqFlags(options));
      if (exitCode !== 0)
        throw new Error(stderr ? jqMessage(stderr) : `jq exited with ${exitCode}`);
      return stdout;
    },
  };
}
