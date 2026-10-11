const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** RFC 4180 CSV of a grid of strings, rows padded to the widest. */
export function gridCsv(rows: string[][]): string {
  const width = Math.max(0, ...rows.map(r => r.length));
  return rows
    .map(r => `${Array.from({ length: width }, (_, i) => csvCell(r[i] ?? '')).join(',')}\r\n`)
    .join('');
}
