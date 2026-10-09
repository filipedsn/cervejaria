const normalize = (value) => value instanceof Date
  ? { $instant: value.toISOString() }
  : Array.isArray(value)
    ? value.map(normalize)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]))
      : value;

const same = (left, right) => JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));

function collectValueDifferences(left, right, rowId, field, output) {
  if (same(left, right)) return;
  if (left && right && typeof left === 'object' && typeof right === 'object'
    && !Array.isArray(left) && !Array.isArray(right) && !(left instanceof Date) && !(right instanceof Date)) {
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      collectValueDifferences(left[key], right[key], rowId, `${field}.${key}`, output);
    }
    return;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      collectValueDifferences(left[index], right[index], rowId, `${field}[${index}]`, output);
    }
    return;
  }
  output.push({ id: rowId, path: field, kind: 'value-mismatch' });
}

/** Compares complete TransacaoLog rows without returning or logging field values. */
export function compareTransacaoLogRows(sourceRows, destinationRows) {
  const source = new Map(sourceRows.map((row) => [row.id, row]));
  const destination = new Map(destinationRows.map((row) => [row.id, row]));
  const differences = [];
  if (source.size !== sourceRows.length) differences.push({ id: null, path: 'id', kind: 'duplicate-source-key' });
  if (destination.size !== destinationRows.length) differences.push({ id: null, path: 'id', kind: 'duplicate-destination-key' });
  for (const id of [...new Set([...source.keys(), ...destination.keys()])].sort()) {
    const before = source.get(id);
    const after = destination.get(id);
    if (!before) { differences.push({ id, path: '$', kind: 'unexpected-in-destination' }); continue; }
    if (!after) { differences.push({ id, path: '$', kind: 'missing-in-destination' }); continue; }
    for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      collectValueDifferences(before[field], after[field], id, field, differences);
    }
  }
  return { sourceRows: sourceRows.length, destinationRows: destinationRows.length, differences };
}

export function canonicalTransacaoLogRows(rows) {
  return rows.map((row) => normalize(row)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
