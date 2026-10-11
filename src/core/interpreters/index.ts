import type { EntryContent } from '../content';
import { register, type AnyInterpreter } from '../interpreter';
import type { Kind } from '../types';
import { archiveCoreInterpreter } from './archive';
import { base64Interpreter } from './base64';
import { binaryInterpreter } from './binary';
import { colourInterpreter } from './colour';
import { htmlInterpreter } from './html';
import { imageInterpreter } from './image';
import { jsonInterpreter } from './json';
import { markdownInterpreter } from './markdown';
import { ndjsonInterpreter } from './ndjson';
import { jwtInterpreter } from './jwt';
import { recordsInterpreter } from './records';
import { textInterpreter } from './text';
import { xmlInterpreter } from './xml';
import { yamlInterpreter } from './yaml';
import { timestampInterpreter } from './timestamp';
import { urlInterpreter } from './url';
import { uuidInterpreter } from './uuid';

export const interpreters: AnyInterpreter[] = [
  register(jwtInterpreter),
  register(base64Interpreter),
  register(jsonInterpreter),
  register(ndjsonInterpreter),
  register(markdownInterpreter),
  register(recordsInterpreter),
  register(yamlInterpreter),
  register(xmlInterpreter),
  register(htmlInterpreter),
  register(imageInterpreter),
  register(archiveCoreInterpreter),
  register(timestampInterpreter),
  register(uuidInterpreter),
  register(urlInterpreter),
  register(colourInterpreter),
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
