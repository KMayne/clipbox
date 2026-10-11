/** A cell as text: empty for null/undefined, JSON for nested values. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** RFC 4180 quoting: wraps cells holding the delimiter, a quote or a line break. */
export function quoteCell(s: string, delimiter = ','): string {
  return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * RFC 4180 CSV (or another delimiter, e.g. tab) with a header row; nested values are written as
 * JSON. `columns` defaults to every key seen, in first-seen order.
 */
export function toCsv(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[] = [...new Set(rows.flatMap(r => Object.keys(r)))],
  delimiter = ',',
): string {
  const cell = (v: unknown) => quoteCell(cellText(v), delimiter);
  const lines = [columns.map(cell).join(delimiter)];
  for (const row of rows) lines.push(columns.map(c => cell(row[c])).join(delimiter));
  return lines.join('\r\n') + '\r\n';
}
