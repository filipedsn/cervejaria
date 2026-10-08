const tenantAllowlist = new Map([
  ['cmr9yis3c0000hvu00q9fe7y1', 'CIA Marítima'],
  ['cmsry9xrn0000hvlgopjxy0oo', 'Churrasquinho do Thiago'],
]);

export const DEV_PDV_TENANT_ALLOWLIST = Object.freeze([...tenantAllowlist].map(([id, name]) => Object.freeze({ id, name })));
export const DEV_PDV_CUTOVER_SEQUENCE = Object.freeze([
  'preflight-global-constraints-and-tenant-inventory',
  'minimal-prerequisite-migrations',
  'business-catalog-transformations',
  'kitchen-context-preparation',
  'dependent-migrations-with-original-preflight',
  'remaining-tenant-transformations-and-replays',
  'diagnostics-and-integrated-reconciliation',
  'per-tenant-activation',
]);

export function validateDevCutoverEnvironment(env) {
  if (env.NODE_ENV !== 'development') throw new Error('PDV cutover is allowed only with NODE_ENV=development.');
  if (env.PDV_ISOLATED_QA === '1' || env.PDV_CANONICAL_CONFIG_QA) throw new Error('DEV activation cannot impersonate the QA guard.');
  if (Object.keys(env).some((name) => /^PROD(?:_|$)/i.test(name))) throw new Error('PROD-related environment variables are forbidden.');
  let url;
  try { url = new URL(env.DATABASE_URL ?? ''); } catch { throw new Error('DATABASE_URL is invalid for DEV cutover.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.port !== '5434'
    || url.pathname !== '/cervejaria_dev'
    || url.hash
    || [...url.searchParams.keys()].some((key) => !['schema', 'connection_limit', 'pool_timeout', 'sslmode'].includes(key))) {
    throw new Error('DEV cutover requires the exact local PostgreSQL target on :5434/cervejaria_dev.');
  }
  return Object.freeze({ environment: 'DEV', database: 'cervejaria_dev', host: url.hostname, port: url.port });
}

export function resolveAllowedTenant(tenantId) {
  const name = tenantAllowlist.get(tenantId);
  if (!name) throw new Error(`Tenant is outside the explicit PDV cutover allowlist: ${tenantId || '(missing)'}`);
  return Object.freeze({ id: tenantId, name });
}

export function buildDevCutoverPlan({ tenantIds, mode = 'dry-run', migrationsPending = true } = {}) {
  if (!['plan', 'dry-run', 'apply'].includes(mode)) throw new Error(`Unsupported cutover mode: ${mode}`);
  const ids = tenantIds?.length ? [...new Set(tenantIds)] : DEV_PDV_TENANT_ALLOWLIST.map(({ id }) => id);
  const tenants = ids.map(resolveAllowedTenant);
  return Object.freeze({
    environment: 'DEV', mode: mode === 'apply' ? 'apply' : 'dry-run',
    tenants, migrationsPending: Boolean(migrationsPending),
    globalDdl: Boolean(migrationsPending),
    sequence: DEV_PDV_CUTOVER_SEQUENCE,
    activationScope: 'selected-tenant-only',
    preservesOtherTenants: true,
    requiredGlobalPreflight: 'all tenants, including tenants outside the allowlist',
    checkpoints: ['tenant + phase + run ID', 'resume only from confirmed receipts', 'reconcile before activation'],
  });
}

export function assertGlobalPreflightClear(findings) {
  if (!Array.isArray(findings) || findings.length === 0) throw new Error('Global preflight requires actual tenant coverage.');
  const blockers = (findings ?? []).filter((finding) => finding.status !== 'CLEAR');
  if (blockers.length) {
    const detail = blockers.map((finding) => `${finding.tenantId ?? 'unknown'}:${finding.code ?? 'BLOCKED'}`).join(',');
    throw new Error(`Global DDL preflight blocked before any migration: ${detail}`);
  }
  return true;
}

export function validateQaCutoverEnvironment(env, ownership) {
  const url = new URL(env.DATABASE_URL ?? '');
  if (!['development', 'test'].includes(env.NODE_ENV ?? '') || env.PDV_ISOLATED_QA !== '1' || env.QA_DATABASE_URL !== env.DATABASE_URL
    || !['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
    || Number(url.port) < 55439 || Number(url.port) > 55449 || url.pathname !== '/cervejaria_qa_pdv_unico'
    || Object.keys(env).some(key => /^PROD(?:_|$)/i.test(key))
    || !ownership || ownership.runId !== env.PDV_QA_RUN_ID || ownership.containerName !== env.PDV_QA_CONTAINER
    || ownership.verified !== true) throw new Error('QA cutover requires a verified executor-owned target.');
  return Object.freeze({ environment: 'QA', database: 'cervejaria_qa_pdv_unico', host: url.hostname, port: url.port });
}

/** Destination validation is deliberately separate from the shared ordered executor. */
export async function executeCutoverCore({ target, tenantIds, runId, preflight, operations, receipt }) {
  if (!target || !['DEV', 'QA'].includes(target.environment)) throw new Error('Validated target required.');
  if (!tenantIds?.length || !runId || typeof receipt !== 'function') throw new Error('Explicit tenants, run and durable receipts required.');
  tenantIds.forEach(resolveAllowedTenant);
  if (preflight?.queried !== true || preflight.status !== 'CLEAR' || !preflight.tenantCount || preflight.coveredTenantCount !== preflight.tenantCount) throw new Error('Queried all-tenant preflight must be CLEAR before application.');
  for (const name of DEV_PDV_CUTOVER_SEQUENCE.slice(1)) if (typeof operations?.[name] !== 'function') throw new Error(`Missing executable phase: ${name}`);
  const rows = [];
  for (const name of DEV_PDV_CUTOVER_SEQUENCE.slice(1)) {
    const start = performance.now();
    const result = await operations[name]();
    if (result?.status !== 'PASS' && result?.status !== 'COMPLETED') throw new Error(`Cutover phase blocked: ${name}`);
    const row = { runId, tenantIds, phase: name, status: 'PASS', durationMs: Math.round(performance.now() - start), result };
    await receipt(row);
    rows.push(row);
  }
  return { status: 'COMPLETED', target, runId, tenantIds, phases: rows };
}

export function scopeCategorySql(sql, tenantIds) {
  if (!tenantIds?.length) throw new Error('Explicit category allowlist required.');
  tenantIds.forEach(resolveAllowedTenant);
  const predicate = `"cervejariaId" IN (${tenantIds.map(id => `'${id}'`).join(',')})`;
  return sql.replace(/\b(FROM|JOIN) "(Produto|CategoriaProdutoPdv|PdvCategoriaTransformacaoProduto|PdvCategoriaTransformacaoCategoria)"(\s+)(?:(e|ec|ep|c|p)(?=\s|\n))?/g,
    (_match, keyword, table, whitespace, alias) => `${keyword} (SELECT * FROM "${table}" WHERE ${predicate}) ${alias ?? `"${table}"`}${whitespace}`);
}

export function assertUnlistedTenantUnchanged(before, after, allowlistedIds) {
  const allowed = new Set(allowlistedIds);
  const initial = new Map((before ?? []).map((row) => [row.tenantId, row]));
  const final = new Map((after ?? []).map((row) => [row.tenantId, row]));
  const changes = [];
  for (const [tenantId, prior] of initial) {
    if (allowed.has(tenantId)) continue;
    const current = final.get(tenantId);
    if (!current || JSON.stringify(current) !== JSON.stringify(prior)) changes.push(tenantId);
  }
  if (changes.length) throw new Error(`Unlisted tenants changed their prior operating contract: ${changes.join(',')}`);
  return true;
}

export function assertTenantActivationReady({ tenantId, pointIds, configuration, permissionReadiness, categoryReadiness } = {}) {
  resolveAllowedTenant(tenantId);
  if (!Array.isArray(pointIds) || pointIds.length !== 1) throw new Error('Tenant activation requires exactly one confirmed canonical PDV.');
  const flags = ['tapsEnabled', 'inventoryEnabled', 'kitchenEnabled', 'kitchenItemsChargeAtLaunch', 'allowCloseComandaWithPendingKitchenOrders'];
  if (!configuration || flags.some((name) => typeof configuration[name] !== 'boolean')) throw new Error('Tenant activation requires an explicit, complete canonical PDV configuration.');
  if (permissionReadiness?.status !== 'PASS' || categoryReadiness?.status !== 'PASS') throw new Error('Tenant activation requires reconciled permissions and canonical product categories.');
  if (categoryReadiness.unlinkedProducts !== 0 || permissionReadiness.ownerExclusiveGrantCount !== 0) throw new Error('Tenant activation found unresolved categories or owner-exclusive grants.');
  return Object.freeze({ tenantId, pointId: pointIds[0], status: 'READY', flags: Object.fromEntries(flags.map((name) => [name, configuration[name]])) });
}
