import { z } from 'zod';
import { defineAction } from '../types';

const kinds = ['wasm'];

/** Modules over this size need "Allow large modules": WAT is often ten times the binary. */
export const WAT_SIZE_LIMIT = 8 * 1024 * 1024;

export const wasmDisassemble = defineAction({
  id: 'wasm.disassemble',
  title: 'Disassemble to WAT',
  group: 'Convert',
  kinds,
  module: 'wabt',
  params: z.object({
    foldExprs: z.boolean().default(false).meta({
      title: 'Fold expressions',
      description: 'Nested S-expressions, e.g. (i32.add (local.get 0) (local.get 1))',
    }),
    inlineExport: z.boolean().default(false).meta({
      title: 'Inline exports',
      description: '(export "name") inside each function instead of separate export fields',
    }),
    allowLarge: z
      .boolean()
      .default(false)
      .meta({
        title: 'Allow large modules',
        description: `Modules over ${WAT_SIZE_LIMIT / 1024 / 1024} MB can take a while and give text about ten times their size`,
      }),
  }),
  label: p => `Disassemble to WAT${p.foldExprs ? ' (folded)' : ''}`,
});

export const wasmInterface = defineAction({
  id: 'wasm.interface',
  title: 'Imports/exports as JSON',
  group: 'Extract',
  kinds,
  params: z.object({}),
});

export const wasmActions = [wasmDisassemble, wasmInterface];
