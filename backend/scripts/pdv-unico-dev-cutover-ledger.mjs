/** Validate Prisma's migration ledger against the exact ordered Git migration set. */
export function validateDevMigrationLedger({ migrations, ledgerRows, boundary }) {
  if (!Array.isArray(migrations) || !migrations.length || !Array.isArray(ledgerRows)) throw new Error('A complete migration set and queried ledger rows are required.');
  const names = migrations.map((row) => row.name);
  if (new Set(names).size !== names.length || names.some((name, index) => index && names[index - 1] >= name)) throw new Error('Git migration names must be unique and strictly ordered.');
  if (!names.includes(boundary)) throw new Error(`Reviewed migration boundary is missing from Git: ${boundary}`);
  const expected = new Map(migrations.map(({ name, checksum }) => [name, checksum]));
  const grouped = new Map();
  for (const row of ledgerRows) {
    const name = row.migration_name;
    if (!expected.has(name)) throw new Error(`Unknown migration in database ledger: ${name}`);
    if (row.checksum !== expected.get(name)) throw new Error(`Migration checksum diverges from reviewed Git SQL: ${name}`);
    const finished = row.finished === true || Boolean(row.finished_at);
    const rolledBack = row.rolled_back === true || Boolean(row.rolled_back_at);
    if (!finished && !rolledBack) throw new Error(`Failed or incomplete migration exists in database ledger: ${name}`);
    const rows = grouped.get(name) ?? [];
    rows.push({ finished, rolledBack });
    grouped.set(name, rows);
  }
  const applied = new Set();
  for (const [name, rows] of grouped) {
    if (rows.filter((row) => row.finished && !row.rolledBack).length > 1) throw new Error(`Migration has multiple successful ledger records: ${name}`);
    if (rows.some((row) => row.finished && !row.rolledBack)) applied.add(name);
  }
  let gapSeen = false;
  for (const name of names) {
    if (!applied.has(name)) gapSeen = true;
    else if (gapSeen) throw new Error(`Migration ledger application order has a gap before ${name}.`);
  }
  const boundaryIndex = names.indexOf(boundary);
  const appliedNames = names.filter((name) => applied.has(name));
  const pendingNames = names.filter((name) => !applied.has(name));
  const pendingBeforeBoundary = pendingNames.some((name) => names.indexOf(name) <= boundaryIndex);
  const pendingAfterBoundary = pendingNames.some((name) => names.indexOf(name) > boundaryIndex);
  const boundaryApplied = applied.has(boundary);
  if (boundaryApplied && pendingBeforeBoundary) throw new Error('Migration ledger is ordered incompatibly around the reviewed boundary.');
  if (pendingAfterBoundary && !boundaryApplied && appliedNames.some((name) => names.indexOf(name) > boundaryIndex)) throw new Error('Post-boundary migrations exist before the reviewed boundary.');
  return Object.freeze({
    status: 'VALID',
    appliedCount: appliedNames.length,
    pendingCount: pendingNames.length,
    appliedNames,
    pendingNames,
    boundary,
    boundaryApplied,
    stage: pendingNames.length === 0 ? 'schema-complete' : boundaryApplied ? 'after-minimum-migrations' : 'before-minimum-migrations',
  });
}
