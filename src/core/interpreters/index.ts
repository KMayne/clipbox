import type { EntryContent } from '../content';
import type { Interpreter } from '../interpreter';
import type { Kind } from '../types';
import { binaryInterpreter } from './binary';
import { htmlInterpreter } from './html';
import { imageInterpreter } from './image';
import { jsonInterpreter } from './json';
import { recordsInterpreter } from './records';
import { textInterpreter } from './text';

export const interpreters: Interpreter<never>[] = [
  jsonInterpreter,
  recordsInterpreter,
  htmlInterpreter,
  imageInterpreter,
  textInterpreter,
  binaryInterpreter,
] as Interpreter<never>[];

export function getInterpreter(kind: Kind): Interpreter<unknown> {
  const i = interpreters.find(i => i.kind === kind);
  if (!i) throw new Error(`Unknown kind '${kind}'`);
  return i as Interpreter<unknown>;
}

/** Applicable kinds for the content, most confident first. */
export function detectKinds(c: EntryContent): { kind: Kind; confidence: number }[] {
  return interpreters
    .map(i => ({ kind: i.kind, confidence: i.detect(c) }))
    .filter(d => d.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
}
