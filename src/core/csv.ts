function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with a header row of every key seen; nested values are written as JSON. */
export function toCsv(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map(c => csvCell(row[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}
