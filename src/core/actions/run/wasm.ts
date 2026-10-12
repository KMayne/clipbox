import { isWabtService } from '../../../modules/wabt/service';
import { formatBytes } from '../../format';
import { wasmInterpreter } from '../../interpreters/wasm';
import { interfaceJson } from '../../wasm/describe';
import { WAT_SIZE_LIMIT, wasmDisassemble, wasmInterface } from '../catalog/wasm';
import { implement } from '../types';
import { textResult, withExtension } from './util';

const value = wasmInterpreter.isValue;

/** Text over this many characters is refused rather than added as a capture. */
export const MAX_WAT = 256 * 1024 * 1024;

export const wasmImpls = [
  implement(wasmDisassemble, {
    value,
    applies: ({ value }) => value.info.format === 'module',
    async run({ value, content }, { foldExprs, inlineExport, allowLarge }, ctx) {
      const size = value.bytes.byteLength;
      if (size > WAT_SIZE_LIMIT && !allowLarge) {
        throw new Error(
          `This module is ${formatBytes(size)}; its text could be ten times that. ` +
            'Turn on "Allow large modules" to disassemble it anyway.',
        );
      }
      const wabt = await ctx.service('wabt', isWabtService);
      if (!wabt) throw new Error("The WebAssembly tools module isn't available");
      ctx.progress(undefined, 'Disassembling…');
      const text = await wabt.toWat(
        value.bytes,
        { foldExprs, inlineExport },
        { signal: ctx.signal },
      );
      if (text.length > MAX_WAT) {
        throw new Error(`The text is over ${MAX_WAT / 1024 / 1024} MB, too large to open`);
      }
      return textResult(text, 'text/plain', withExtension(content.name, 'wat', 'module'));
    },
  }),
  implement(wasmInterface, {
    value,
    applies: ({ value }) => value.info.format === 'module',
    run: ({ value, content }) =>
      textResult(
        JSON.stringify(interfaceJson(value), null, 2),
        'application/json',
        withExtension(
          content.name ? `${content.name.replace(/\.[^./\\]*$/, '')}-interface` : undefined,
          'json',
          'module-interface',
        ),
      ),
  }),
];
