import { toCsv } from '../../csv';
import { executableLayout, exportRows, iconFile, largestIconPng } from '../../executable/describe';
import { toHexAddress } from '../../executable/reader';
import { findStrings } from '../../executable/strings';
import type { ExecutableValue, SignatureInfo } from '../../executable/types';
import { formatCount, toBase64 } from '../../format';
import { executableInterpreter } from '../../interpreters/executable';
import {
  executableCertificates,
  executableExportsCsv,
  executableExtractIcon,
  executableImportsCsv,
  executableManifest,
  executableOverlay,
  executableSectionsCsv,
  executableStrings,
  executableVersionInfo,
} from '../catalog/executable';
import { implement } from '../types';
import { textResult, withExtension } from './util';

const value = executableInterpreter.isValue;

/** Most strings one extraction returns. */
export const MAX_STRINGS = 100_000;

const pe = (v: ExecutableValue) => (v.info?.format === 'pe' ? v.info : null);

function signatureOf(v: ExecutableValue): SignatureInfo | null {
  const i = v.info;
  if (!i) return null;
  if (i.format === 'pe' || i.format === 'macho') return i.signature;
  if (i.format === 'fat') return i.slices.find(s => s.info?.signature)?.info?.signature ?? null;
  return null;
}

/** "setup.exe" → "setup-icon.png". */
const named = (name: string | undefined, suffix: string, ext: string) =>
  withExtension(
    name ? name.replace(/\.[^./\\]*$/, '') + suffix : undefined,
    ext,
    `program${suffix}`,
  );

export const executableImpls = [
  implement(executableExtractIcon, {
    value,
    applies: ({ value }) => (pe(value)?.iconGroups.length ?? 0) > 0,
    run: ({ value, content }) => [
      { mime: 'image/x-icon', name: named(content.name, '-icon', 'ico'), bytes: iconFile(value) },
      {
        mime: 'image/png',
        name: named(content.name, '-icon', 'png'),
        bytes: largestIconPng(value),
      },
    ],
  }),
  implement(executableVersionInfo, {
    value,
    applies: ({ value }) => pe(value)?.version != null,
    run: ({ value, content }) =>
      textResult(
        JSON.stringify(pe(value)?.version ?? null, null, 2),
        'application/json',
        named(content.name, '-version', 'json'),
      ),
  }),
  implement(executableImportsCsv, {
    value,
    applies: ({ value }) => executableLayout(value).imports.length > 0,
    run: ({ value, content }) =>
      textResult(
        toCsv(
          executableLayout(value).imports.flatMap(g => {
            const row = (fn: string, ordinal: number | null) => ({
              dll: g.library,
              function: fn,
              ordinal: ordinal ?? '',
              delay_loaded: g.delay,
            });
            return g.functions.length
              ? g.functions.map(f => row(f.name ?? '', f.ordinal))
              : [row('', null)];
          }),
        ),
        'text/csv',
        named(content.name, '-imports', 'csv'),
      ),
  }),
  implement(executableExportsCsv, {
    value,
    applies: ({ value }) => executableLayout(value).exports.length > 0,
    run: ({ value, content }) =>
      textResult(
        toCsv(exportRows(executableLayout(value).exports)),
        'text/csv',
        named(content.name, '-exports', 'csv'),
      ),
  }),
  implement(executableSectionsCsv, {
    value,
    applies: ({ value }) => executableLayout(value).sections.length > 0,
    run: ({ value, content }) =>
      textResult(
        toCsv(
          executableLayout(value).sections.map(s => ({
            name: s.name,
            ...(s.group !== null && { segment: s.group }),
            address: toHexAddress(s.address),
            virtual_size: s.virtualSize,
            raw_offset: s.rawOffset,
            raw_size: s.rawSize,
            flags: s.flags,
            entropy: s.entropy === null ? '' : s.entropy.toFixed(3),
            packed: s.packed,
          })),
        ),
        'text/csv',
        named(content.name, '-sections', 'csv'),
      ),
  }),
  implement(executableManifest, {
    value,
    applies: ({ value }) => (pe(value)?.manifest ?? null) !== null,
    run: ({ value, content }) =>
      textResult(
        pe(value)?.manifest ?? '',
        'application/xml',
        named(content.name, '-manifest', 'xml'),
      ),
  }),
  implement(executableCertificates, {
    value,
    applies: ({ value }) => (signatureOf(value)?.certRanges.length ?? 0) > 0,
    run({ value, content }) {
      const ranges = signatureOf(value)?.certRanges ?? [];
      const pem = ranges.map(r => {
        const b64 = toBase64(value.bytes.subarray(r.offset, r.offset + r.size));
        const lines = b64.match(/.{1,64}/g) ?? [];
        return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
      });
      return textResult(
        pem.join(''),
        'application/x-pem-file',
        named(content.name, '-certificates', 'pem'),
      );
    },
  }),
  implement(executableStrings, {
    value,
    run({ value, content }, { minLength, encoding, offsets }) {
      const { strings, truncated } = findStrings(value.bytes, {
        minLength,
        encoding,
        max: MAX_STRINGS,
      });
      const lines = strings.map(s =>
        offsets ? `${s.offset.toString(16).padStart(8, '0')} ${s.text}` : s.text,
      );
      if (truncated) {
        lines.push(
          `[Stopped after ${formatCount(MAX_STRINGS)} strings. Raise the minimum length to see fewer.]`,
        );
      }
      return textResult(
        lines.join('\n') + '\n',
        'text/plain',
        named(content.name, '-strings', 'txt'),
      );
    },
  }),
  implement(executableOverlay, {
    value,
    applies: ({ value }) => (pe(value)?.overlay ?? null) !== null,
    run({ value, content }) {
      const o = pe(value)?.overlay;
      if (!o) throw new Error('This file has no overlay');
      return {
        mime: 'application/octet-stream',
        name: named(content.name, '-overlay', 'bin'),
        bytes: value.bytes.slice(o.offset, o.offset + o.size),
      };
    },
  }),
];
