export function verifyMigratorRunIdentity(actual, expected, tenantIds) {
  if (!actual || actual.id !== expected.runId || actual.status !== 'COMPLETED') return { status: 'BLOCKED', code: 'MIGRATOR_RUN_STATUS_OR_ID_DIVERGENCE' };
  const tenantRefs = [actual.cervejariaId, actual.checkpoint?.companyId].filter((value) => value != null);
  const scopeRefs = [actual.scope, actual.checkpoint?.scope].filter((value) => value != null);
  const pointRefs = [actual.pontoVendaId, actual.checkpoint?.pointId].filter((value) => value != null);
  if (new Set(tenantRefs).size > 1 || new Set(scopeRefs).size > 1 || new Set(pointRefs).size > 1) {
    return { status: 'BLOCKED', code: 'MIGRATOR_EVIDENCE_CONTRADICTORY', detail: { tenantRefs, scopeRefs, pointRefs } };
  }
  const tenantId = tenantRefs[0] ?? null;
  const scope = scopeRefs[0] ?? null;
  if (!tenantId || !tenantIds.includes(tenantId)) return { status: 'BLOCKED', code: 'MIGRATOR_RUN_OR_TENANT_DIVERGENCE', detail: { tenantId } };
  if (tenantId !== expected.tenantId || scope !== expected.scope) return { status: 'BLOCKED', code: 'MIGRATOR_SCOPE_OR_TENANT_DIVERGENCE', detail: { tenantId, scope, expected } };
  return { status: 'PASS', runId: actual.id, tenantId, scope, pointId: pointRefs[0] ?? null };
}
