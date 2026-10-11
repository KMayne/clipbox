import { createMemo } from '../content';
import {
  executableFormat,
  executableLabel,
  executableLayout,
  executableStats,
  largestIconPng,
  parseExecutable,
} from '../executable/describe';
import type { ExecutableValue } from '../executable/types';
import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';

/** Above binary (0.2), which stays on offer. */
const CONFIDENCE = 0.9;

const format = createMemo(c => executableFormat(c.bytes));

/** Windows PE, ELF and Mach-O (including universal) program files, parsed in core. */
export const executableInterpreter: Interpreter<ExecutableValue> = {
  kind: 'executable',
  isValue: (v): v is ExecutableValue => hasKind(v, 'executable'),
  detect: c => (format(c) ? CONFIDENCE : 0),
  parse: c => parseExecutable(c.bytes),
  label: executableLabel,
  summarise(v) {
    const layout = executableLayout(v);
    return { stats: executableStats(v, layout), extent: v.bytes.byteLength };
  },
  slice(v, req) {
    switch (req.type) {
      case 'json':
        return executableLayout(v);
      case 'image':
        return { bytes: largestIconPng(v), mime: 'image/png' };
      case 'bytes':
        return v.bytes.slice(req.from, req.to);
      default:
        return unsupportedSlice('executable', req);
    }
  },
  export(v) {
    const layout = executableLayout(v);
    return { text: [layout.title, ...layout.header.map(r => `${r.label}: ${r.value}`)].join('\n') };
  },
};
