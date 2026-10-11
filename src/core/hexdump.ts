import { formatBytes } from './format';

/** Larger inputs are dumped up to this many bytes, with a note (16 MiB → ~70 MB of text). */
export const HEX_DUMP_LIMIT = 16 * 1024 * 1024;

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/**
 * A `hexdump -C` style dump: 8-digit hex offset, the bytes in hex (an extra space every 8),
 * and printable ASCII between bars, e.g.
 * `00000000  48 65 6c 6c 6f 0a                                 |Hello.|`.
 */
export function hexDump(bytes: Uint8Array, perRow = 16, limit = HEX_DUMP_LIMIT): string {
  const shown = bytes.subarray(0, limit);
  const width = perRow * 3 + Math.floor((perRow - 1) / 8);
  const out: string[] = [];
  for (let at = 0; at < shown.length; at += perRow) {
    const row = shown.subarray(at, at + perRow);
    let hex = '';
    let ascii = '';
    row.forEach((b, i) => {
      if (i > 0) hex += i % 8 === 0 ? '  ' : ' ';
      hex += HEX[b];
      ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
    });
    out.push(`${at.toString(16).padStart(8, '0')}  ${hex.padEnd(width - 1)}  |${ascii}|`);
  }
  out.push(shown.length.toString(16).padStart(8, '0'));
  if (bytes.length > shown.length) {
    out.push(`… showing the first ${formatBytes(shown.length)} of ${formatBytes(bytes.length)}`);
  }
  return `${out.join('\n')}\n`;
}
