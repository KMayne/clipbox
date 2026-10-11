const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** RFC 4180 CSV of a grid of strings, rows padded to the widest. */
export function gridCsv(rows: string[][]): string {
  // Not Math.max(...rows): big tables overflow the call stack
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows
    .map(r => `${Array.from({ length: width }, (_, i) => csvCell(r[i] ?? '')).join(',')}\r\n`)
    .join('');
}
