const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Escapa uma célula CSV (RFC 4180) e neutraliza fórmulas interpretadas por Excel/Sheets. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const raw = String(value);
  const safe = FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}
