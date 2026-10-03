export type PlanAction = 'MANTER' | 'CRIAR_DESTINO' | 'REASSOCIAR' | 'BLOQUEADO';
export type PdvSourceType = 'PDV' | 'TRAILER' | 'EVENTO' | 'COMANDA' | 'ESTOQUE' | 'PAGAMENTO' | 'CONTA_RECEBER' | 'CONFIG_OPERACIONAL' | 'CONFIG_OPERACAO' | 'CLIENTE' | 'CLIENTE_ESTATISTICA' | 'PRODUTO' | 'PRECO' | 'CARDAPIO' | 'CARDAPIO_PRODUTO' | 'GRUPO_OPCIONAL' | 'OPCAO_PRODUTO' | 'OPCIONAL_CATALOGO' | 'OPCIONAL_VINCULO' | 'TAP' | 'TAP_MONTAGEM' | 'SESSAO_EVENTO' | 'MOVIMENTO_EVENTO' | 'SESSAO_CAIXA' | 'MOVIMENTO_CAIXA' | 'ITEM_COMANDA' | 'ITEM_OPCIONAL' | 'PEDIDO' | 'PEDIDO_ITEM_LINK' | 'PEDIDO_HISTORICO' | 'PEDIDO_CLIENTE' | 'PEDIDO_CLIENTE_ITEM' | 'TRANSACAO_LOG' | 'MOVIMENTO_ESTOQUE' | 'AGENDA_EXCECAO' | 'SESSAO_PRODUTO' | 'EVENTO_PRODUTO';
export type BlockerCategory = 'CONFLITO_DADOS' | 'DECISAO_MANUAL' | 'INFORMACAO_INSUFICIENTE' | 'LIMITACAO_PLANEJADOR';

export interface PlanningReference {
  type: PdvSourceType;
  id: string;
  relation: string;
  /** Tenant read from the referenced row, when the relation has an independent tenant field. */
  tenantId?: string | null;
}

export interface PlanningBlocker {
  code: string;
  category: BlockerCategory;
  evidence: string;
}

export interface PlanningRecord {
  type: PdvSourceType;
  id: string;
  tenantId: string;
  /** Source FK values keyed by relation name. Kept distinct from destination links. */
  sourceLinks?: Record<string, string | null>;
  /** Business-required FKs even when the source value is null/absent. */
  requiredLinks?: string[];
  /** Every non-null relation required to preserve this record. */
  parents?: PlanningReference[];
  /** How this row gets its canonical PDV (for commands, sessions, stock, etc.). */
  pdvFrom?: PlanningReference;
  /** Additional source locations that must resolve to the same canonical PDV. */
  pdvConstraints?: PlanningReference[];
  /** IDs are often preserved while links still need remapping. */
  preserveId?: boolean;
  /** The first applicable explicit quality blocker. */
  blocker?: PlanningBlocker;
}

export interface PdvPlanningCompany {
  companyId: string;
  pdvIds: string[];
  trailerIds: string[];
  records: PlanningRecord[];
}

export interface PdvDependency {
  type: PdvSourceType;
  id: string;
  relation: string;
  resolved: boolean;
}

export interface PdvMigrationPlanRow {
  sourceType: PdvSourceType;
  sourceId: string;
  action: PlanAction;
  /** Destination identity of this source entity (independent from its unit/links). */
  destinationEntity: { type: PdvSourceType; id: string } | null;
  /** Canonical PDV, or null only for blocked rows. */
  canonicalPdvId: string | null;
  /** Destination FK values, separate from the entity ID. */
  destinationLinks: Record<string, string | null>;
  requiredDestinationLinks: string[];
  dependencies: PdvDependency[];
  idPreserved: boolean;
  mappingComplete: boolean;
  blocker: PlanningBlocker | null;
  evidence: string;
}

/** Convert a persisted decimal string to an exact integer scale without Number. */
export function decimalToScaledInteger(value: string, scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > 9) throw new Error('Invalid decimal scale');
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`Invalid persisted decimal: ${value}`);
  const fraction = match[3] ?? '';
  if (fraction.length > scale) throw new Error(`Decimal exceeds scale ${scale}: ${value}`);
  const factor = 10n ** BigInt(scale);
  const fractional = BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0');
  const absolute = BigInt(match[2]) * factor + fractional;
  return match[1] ? -absolute : absolute;
}

export function sumScaledDecimals(values: string[], scale: number): bigint {
  return values.reduce((total, value) => total + decimalToScaledInteger(value, scale), 0n);
}

/** Deterministic read-only graph planner. It never writes and never uses names as evidence. */
export function planPdvMigration(input: PdvPlanningCompany): PdvMigrationPlanRow[] {
  const pdvs = [...new Set(input.pdvIds)].sort();
  const trailers = [...new Set(input.trailerIds)].sort();
  const proposedPdvId = pdvs.length === 0 && trailers.length === 1
    ? `proposed-pdv:${input.companyId}:${trailers[0]}`
    : null;
  const canonicalPdvId = pdvs.length === 1 ? pdvs[0] : proposedPdvId;
  const records = [...input.records].sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  const byKey = new Map<string, PlanningRecord>();
  const duplicateKeys = new Set<string>();
  for (const record of records) {
    const key = `${record.type}:${record.id}`;
    if (byKey.has(key)) duplicateKeys.add(key);
    else byKey.set(key, record);
  }

  const rows = new Map<string, PdvMigrationPlanRow>();
  const getParentRow = (ref: PlanningReference) => rows.get(`${ref.type}:${ref.id}`);
  const pending = [...records];
  while (pending.length) {
    const readyIndex = pending.findIndex((record) => [...(record.parents ?? []), ...(record.pdvFrom ? [record.pdvFrom] : []), ...(record.pdvConstraints ?? [])]
      .every((ref) => !byKey.has(`${ref.type}:${ref.id}`) || rows.has(`${ref.type}:${ref.id}`)));
    // A cycle in the source graph is itself a blocker; processing one row lets
    // the explicit dependency checks report it without an arbitrary guess.
    const record = pending.splice(readyIndex < 0 ? 0 : readyIndex, 1)[0];
    const key = `${record.type}:${record.id}`;
    const dependencies: PdvDependency[] = [];
    let blocker = duplicateKeys.has(key)
      ? { code: 'DUPLICATE_SOURCE_ID', category: 'CONFLITO_DADOS' as const, evidence: 'Índice de origem contém mais de uma entidade com o mesmo tipo/ID.' }
      : record.blocker ?? null;

    if (!blocker && record.tenantId !== input.companyId) {
      blocker = { code: 'SOURCE_TENANT_MISMATCH', category: 'CONFLITO_DADOS', evidence: 'Tenant da entidade de origem diverge do tenant planejado.' };
    }
    for (const ref of record.parents ?? []) {
      const parent = byKey.get(`${ref.type}:${ref.id}`);
      const parentRow = getParentRow(ref);
      const tenantMismatch = ref.tenantId != null && ref.tenantId !== input.companyId;
      const parentExists = Boolean(parent && !duplicateKeys.has(`${ref.type}:${ref.id}`));
      const resolved = parentExists && !tenantMismatch && parentRow?.action !== 'BLOQUEADO' && Boolean(parentRow?.destinationEntity);
      dependencies.push({ type: ref.type, id: ref.id, relation: ref.relation, resolved });
      if (!blocker && tenantMismatch) {
        blocker = { code: 'CROSS_TENANT_PARENT', category: 'CONFLITO_DADOS', evidence: `A relação ${ref.relation} aponta para registro de outro tenant.` };
      } else if (!blocker && !parentExists) {
        blocker = { code: 'MISSING_PARENT', category: 'CONFLITO_DADOS', evidence: `A relação ${ref.relation} aponta para ${ref.type}:${ref.id}, ausente da fotografia.` };
      } else if (!blocker && parentRow?.action === 'BLOQUEADO') {
        blocker = { code: 'BLOCKED_PARENT', category: 'LIMITACAO_PLANEJADOR', evidence: `A relação ${ref.relation} depende de ${ref.type}:${ref.id}, que está bloqueado: ${parentRow.blocker?.code ?? 'UNKNOWN'}.` };
      } else if (!blocker && !parentRow) {
        blocker = { code: 'CYCLIC_DEPENDENCY', category: 'CONFLITO_DADOS', evidence: `A relação ${ref.relation} participa de uma dependência cíclica.` };
      }
    }

    let resolvedPdvId: string | null = canonicalPdvId;
    if (record.pdvFrom) {
      const ref = record.pdvFrom;
      const parent = byKey.get(`${ref.type}:${ref.id}`);
      const parentRow = getParentRow(ref);
      const exists = Boolean(parent && !duplicateKeys.has(`${ref.type}:${ref.id}`));
      const tenantMismatch = ref.tenantId != null && ref.tenantId !== input.companyId;
      dependencies.push({ type: ref.type, id: ref.id, relation: ref.relation, resolved: exists && !tenantMismatch && parentRow?.action !== 'BLOQUEADO' && Boolean(parentRow?.canonicalPdvId) });
      if (!blocker && tenantMismatch) blocker = { code: 'CROSS_TENANT_DESTINATION', category: 'CONFLITO_DADOS', evidence: `A origem do PDV canônico (${ref.relation}) pertence a outro tenant.` };
      else if (!blocker && !exists) blocker = { code: 'MISSING_PDV_SOURCE', category: 'CONFLITO_DADOS', evidence: `Origem do PDV canônico ${ref.type}:${ref.id} não existe na fotografia.` };
      else if (!blocker && parentRow?.action === 'BLOQUEADO') blocker = { code: 'BLOCKED_PDV_SOURCE', category: 'LIMITACAO_PLANEJADOR', evidence: `Origem do PDV canônico ${ref.type}:${ref.id} está bloqueada.` };
      else if (!blocker && !parentRow) blocker = { code: 'CYCLIC_PDV_DEPENDENCY', category: 'CONFLITO_DADOS', evidence: `A origem do PDV canônico ${ref.type}:${ref.id} participa de uma dependência cíclica.` };
      else if (!blocker) resolvedPdvId = parentRow?.canonicalPdvId ?? null;
    }
    for (const ref of record.pdvConstraints ?? []) {
      const parent = byKey.get(`${ref.type}:${ref.id}`);
      const parentRow = getParentRow(ref);
      const exists = Boolean(parent && !duplicateKeys.has(`${ref.type}:${ref.id}`));
      const tenantMismatch = ref.tenantId != null && ref.tenantId !== input.companyId;
      dependencies.push({ type: ref.type, id: ref.id, relation: ref.relation, resolved: exists && !tenantMismatch && parentRow?.action !== 'BLOQUEADO' && Boolean(parentRow?.canonicalPdvId) });
      if (!blocker && tenantMismatch) blocker = { code: 'CROSS_TENANT_DESTINATION', category: 'CONFLITO_DADOS', evidence: `A relação de destino ${ref.relation} pertence a outro tenant.` };
      else if (!blocker && !exists) blocker = { code: 'MISSING_DESTINATION_LINK', category: 'CONFLITO_DADOS', evidence: `A relação de destino ${ref.relation} aponta para ${ref.type}:${ref.id}, ausente da fotografia.` };
      else if (!blocker && parentRow?.action === 'BLOQUEADO') blocker = { code: 'BLOCKED_DESTINATION_LINK', category: 'LIMITACAO_PLANEJADOR', evidence: `A relação de destino ${ref.relation} depende de entidade bloqueada.` };
      else if (!blocker && !parentRow) blocker = { code: 'CYCLIC_DESTINATION_LINK', category: 'CONFLITO_DADOS', evidence: `A relação de destino ${ref.relation} participa de dependência cíclica.` };
      else if (!blocker && resolvedPdvId && parentRow?.canonicalPdvId !== resolvedPdvId) blocker = { code: 'CROSS_DESTINATION_LINK', category: 'CONFLITO_DADOS', evidence: `A relação ${ref.relation} resolve para um PDV canônico diferente da origem principal.` };
    }
    for (const [relation, sourceId] of Object.entries(record.sourceLinks ?? {})) {
      if (sourceId !== null && !(record.parents ?? []).some((ref) => ref.relation === relation && ref.id === sourceId)) {
        blocker ??= { code: 'DESTINATION_LINK_NOT_VALIDATED', category: 'LIMITACAO_PLANEJADOR', evidence: `O vínculo ${relation}=${sourceId} não tem dependência tipada validada.` };
      }
    }
    for (const relation of record.requiredLinks ?? []) {
      const sourceId = record.sourceLinks?.[relation];
      if (sourceId == null) blocker ??= { code: 'REQUIRED_SOURCE_LINK_MISSING', category: 'CONFLITO_DADOS', evidence: `Vínculo obrigatório ${relation} está ausente ou nulo na origem.` };
      else if (!(record.parents ?? []).some((ref) => ref.relation === relation && ref.id === sourceId)) blocker ??= { code: 'REQUIRED_DESTINATION_LINK_UNVALIDATED', category: 'LIMITACAO_PLANEJADOR', evidence: `Vínculo obrigatório ${relation}=${sourceId} não tem dependência de destino validada.` };
    }
    if (!blocker && pdvs.length > 1) {
      blocker = { code: 'MULTIPLE_CANONICAL_PDVS', category: 'DECISAO_MANUAL', evidence: 'Mais de um PDV existente; a escolha do PDV canônico requer decisão manual.' };
    }
    if (!blocker && !canonicalPdvId) {
      blocker = { code: trailers.length > 1 ? 'MULTIPLE_TRAILERS_NO_CANONICAL_PDV' : 'CANONICAL_PDV_UNPROVEN',
        category: trailers.length > 1 ? 'DECISAO_MANUAL' : 'INFORMACAO_INSUFICIENTE',
        evidence: trailers.length > 1 ? 'Não há PDV e há mais de um trailer; selecionar o destino requer decisão manual.' : 'Não há PDV único nem trailer único para propor um destino.' };
    }

    const destinationEntity = record.preserveId === false
      ? (record.type === 'PDV' && proposedPdvId ? { type: 'PDV' as const, id: proposedPdvId } : null)
      : { type: record.type, id: record.id };
    const destinationLinks: Record<string, string | null> = {};
    for (const ref of record.parents ?? []) {
      const parentRow = getParentRow(ref);
      destinationLinks[ref.relation] = parentRow?.destinationEntity?.id ?? null;
    }
    for (const [relation, sourceId] of Object.entries(record.sourceLinks ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (sourceId == null) destinationLinks[relation] = null;
      else {
        const matching = (record.parents ?? []).find((ref) => ref.relation === relation && ref.id === sourceId);
        const linkedRow = matching ? getParentRow(matching) : undefined;
        destinationLinks[relation] = linkedRow?.destinationEntity?.id ?? sourceId;
      }
    }

    const hasResolvedRequiredDependencies = dependencies.every((item) => item.resolved);
    const mappingComplete = !blocker && Boolean(destinationEntity) && Boolean(resolvedPdvId) && hasResolvedRequiredDependencies;
    const action: PlanAction = blocker ? 'BLOQUEADO'
      : record.type === 'PDV' && proposedPdvId && record.id === proposedPdvId ? 'CRIAR_DESTINO'
      : record.preserveId === false ? 'REASSOCIAR'
      : Object.values(record.sourceLinks ?? {}).some((value) => value !== null) || record.pdvFrom ? 'REASSOCIAR'
      : 'MANTER';
    const row: PdvMigrationPlanRow = {
      sourceType: record.type,
      sourceId: record.id,
      action,
      destinationEntity: blocker ? null : destinationEntity,
      canonicalPdvId: blocker ? null : resolvedPdvId,
      destinationLinks: blocker ? {} : destinationLinks,
      requiredDestinationLinks: [...new Set([...(record.parents ?? []).map((ref) => ref.relation), ...(record.requiredLinks ?? [])])].sort(),
      dependencies,
      idPreserved: record.preserveId !== false && (!destinationEntity || (destinationEntity.type === record.type && destinationEntity.id === record.id)),
      mappingComplete,
      blocker,
      evidence: blocker?.evidence ?? (mappingComplete
        ? 'Entidade, tenant, destino do PDV e todas as dependências foram validados por tipo e ID.'
        : 'Preservação de identidade proposta; mapeamento ainda incompleto.'),
    };
    rows.set(key, row);
  }

  if (proposedPdvId && !rows.has(`PDV:${proposedPdvId}`)) {
    rows.set(`PDV:${proposedPdvId}`, {
      sourceType: 'PDV', sourceId: proposedPdvId, action: 'CRIAR_DESTINO',
      destinationEntity: { type: 'PDV', id: proposedPdvId }, canonicalPdvId: proposedPdvId,
      destinationLinks: {}, dependencies: [], idPreserved: false, mappingComplete: true, blocker: null,
      requiredDestinationLinks: [],
      evidence: `Destino proposto a partir do único trailer ${trailers[0]}; ainda sem escrita.`,
    });
  }
  return [...rows.values()].sort((a, b) => a.sourceType.localeCompare(b.sourceType) || a.sourceId.localeCompare(b.sourceId));
}

/** Fails closed before a consumer treats a proposal as executable. */
export function assertExecutablePlan(rows: PdvMigrationPlanRow[]): void {
  const blocked = rows.filter((row) => row.action === 'BLOQUEADO' || !row.destinationEntity || !row.canonicalPdvId || !row.mappingComplete || row.dependencies.some((dependency) => !dependency.resolved) || row.requiredDestinationLinks.some((link) => row.destinationLinks[link] == null));
  if (blocked.length) throw new Error(`Migration plan has ${blocked.length} blocked or incomplete destination(s).`);
}
