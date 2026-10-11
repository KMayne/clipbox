import type { EntryContent } from '../content';
import { register, type AnyInterpreter } from '../interpreter';
import type { Kind } from '../types';
import { binaryInterpreter } from './binary';
import { htmlInterpreter } from './html';
import { imageInterpreter } from './image';
import { jsonInterpreter } from './json';
import { recordsInterpreter } from './records';
import { textInterpreter } from './text';
import { xmlInterpreter } from './xml';
import { yamlInterpreter } from './yaml';

export const interpreters: AnyInterpreter[] = [
  register(jsonInterpreter),
  register(recordsInterpreter),
  register(yamlInterpreter),
  register(xmlInterpreter),
  register(htmlInterpreter),
  register(imageInterpreter),
  register(textInterpreter),
  register(binaryInterpreter),
];

export function getInterpreter(kind: Kind): AnyInterpreter {
  const i = interpreters.find(i => i.kind === kind);
  if (!i) throw new Error(`Unknown kind '${kind}'`);
  return i;
}

/** Applicable kinds for the content, most confident first. */
export function detectKinds(c: EntryContent): { kind: Kind; confidence: number }[] {
  return interpreters
    .map(i => ({ kind: i.kind, confidence: i.detect(c) }))
    .filter(d => d.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
}
