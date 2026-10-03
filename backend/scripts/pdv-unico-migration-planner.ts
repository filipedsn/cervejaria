export type PlanAction = 'MANTER' | 'CRIAR_DESTINO' | 'REASSOCIAR' | 'BLOQUEADO';
export type PdvSourceType = 'PDV' | 'TRAILER' | 'EVENTO' | 'COMANDA' | 'ESTOQUE' | 'PAGAMENTO' | 'CONTA_RECEBER' | 'CONFIG_OPERACIONAL' | 'CONFIG_OPERACAO' | 'CLIENTE' | 'CLIENTE_ESTATISTICA' | 'PRODUTO' | 'PRECO' | 'CARDAPIO' | 'CARDAPIO_PRODUTO' | 'GRUPO_OPCIONAL' | 'OPCAO_PRODUTO' | 'OPCIONAL_CATALOGO' | 'OPCIONAL_VINCULO' | 'TAP' | 'TAP_MONTAGEM' | 'SESSAO_EVENTO' | 'MOVIMENTO_EVENTO' | 'SESSAO_CAIXA' | 'MOVIMENTO_CAIXA' | 'ITEM_COMANDA' | 'ITEM_OPCIONAL' | 'PEDIDO' | 'PEDIDO_ITEM_LINK' | 'PEDIDO_HISTORICO' | 'PEDIDO_CLIENTE' | 'PEDIDO_CLIENTE_ITEM' | 'TRANSACAO_LOG' | 'MOVIMENTO_ESTOQUE' | 'AGENDA_EXCECAO' | 'SESSAO_PRODUTO' | 'EVENTO_PRODUTO';
export type BlockerCategory = 'CONFLITO_DADOS' | 'DECISAO_MANUAL' | 'INFORMACAO_INSUFICIENTE' | 'LIMITACAO_PLANEJADOR';
export type TargetEntityType = 'PONTO_VENDA' | 'AGENDA_OPERACIONAL' | 'OCORRENCIA_OPERACIONAL' | 'SESSAO_CAIXA' | 'COMANDA';

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
  /** Event source semantics are distinct: weekly definition, dated occurrence, or unsupported shape. */
  eventRole?: 'AGENDA' | 'OCORRENCIA' | null;
  historicalOrigin?: string | null;
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
  dependencies: PdvDependency[];
  idPreservation: 'PRESERVE_SOURCE_ID' | 'REGENERATE_SOURCE_ID';
  sourceValidation: {
    status: 'VALID' | 'BLOCKED';
    canonicalPdvId: string | null;
    blocker: PlanningBlocker | null;
    evidence: string;
  };
  targetMapping: {
    status: 'COMPLETE' | 'INCOMPLETE';
    destinationEntity: { type: TargetEntityType; id: string } | null;
    destinationLinks: Record<string, string | null>;
    requiredDestinationLinks: string[];
    transformation: string | null;
    blockerCode: string | null;
    evidence: string;
  };
  /** Planning never authorizes data writes; a business migrator/release gate does not exist yet. */
  executionEligibility: 'NOT_AUTHORIZED';
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
      const resolved = parentExists && !tenantMismatch && parentRow?.sourceValidation.status === 'VALID';
      dependencies.push({ type: ref.type, id: ref.id, relation: ref.relation, resolved });
      if (!blocker && tenantMismatch) {
        blocker = { code: 'CROSS_TENANT_PARENT', category: 'CONFLITO_DADOS', evidence: `A relação ${ref.relation} aponta para registro de outro tenant.` };
      } else if (!blocker && !parentExists) {
        blocker = { code: 'MISSING_PARENT', category: 'CONFLITO_DADOS', evidence: `A relação ${ref.relation} aponta para ${ref.type}:${ref.id}, ausente da fotografia.` };
      } else if (!blocker && parentRow?.sourceValidation.status === 'BLOCKED') {
        blocker = { code: 'BLOCKED_PARENT', category: 'LIMITACAO_PLANEJADOR', evidence: `A relação ${ref.relation} depende de ${ref.type}:${ref.id}, que está bloqueado: ${parentRow.sourceValidation.blocker?.code ?? 'UNKNOWN'}.` };
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
      dependencies.push({ type: ref.type, id: ref.id, relation: ref.relation, resolved: exists && !tenantMismatch && parentRow?.sourceValidation.status === 'VALID' && Boolean(parentRow.sourceValidation.canonicalPdvId) });
      if (!blocker && tenantMismatch) blocker = { code: 'CROSS_TENANT_DESTINATION', category: 'CONFLITO_DADOS', evidence: `A origem do PDV canônico (${ref.relation}) pertence a outro tenant.` };
      else if (!blocker && !exists) blocker = { code: 'MISSING_PDV_SOURCE', category: 'CONFLITO_DADOS', evidence: `Origem do PDV canônico ${ref.type}:${ref.id} não existe na fotografia.` };
      else if (!blocker && parentRow?.sourceValidation.status === 'BLOCKED') blocker = { code: 'BLOCKED_PDV_SOURCE', category: 'LIMITACAO_PLANEJADOR', evidence: `Origem do PDV canônico ${ref.type}:${ref.id} está bloqueada.` };
      else if (!blocker && !parentRow) blocker = { code: 'CYCLIC_PDV_DEPENDENCY', category: 'CONFLITO_DADOS', evidence: `A origem do PDV canônico ${ref.type}:${ref.id} participa de uma dependência cíclica.` };
      else if (!blocker) resolvedPdvId = parentRow?.sourceValidation.canonicalPdvId ?? null;
    }
    for (const ref of record.pdvConstraints ?? []) {
      const parent = byKey.get(`${ref.type}:${ref.id}`);
      const parentRow = getParentRow(ref);
      const exists = Boolean(parent && !duplicateKeys.has(`${ref.type}:${ref.id}`));
      const tenantMismatch = ref.tenantId != null && ref.tenantId !== input.companyId;
      dependencies.push({ type: ref.type, id: ref.id, relation: ref.relation, resolved: exists && !tenantMismatch && parentRow?.sourceValidation.status === 'VALID' && Boolean(parentRow.sourceValidation.canonicalPdvId) });
      if (!blocker && tenantMismatch) blocker = { code: 'CROSS_TENANT_DESTINATION', category: 'CONFLITO_DADOS', evidence: `A relação de destino ${ref.relation} pertence a outro tenant.` };
      else if (!blocker && !exists) blocker = { code: 'MISSING_DESTINATION_LINK', category: 'CONFLITO_DADOS', evidence: `A relação de destino ${ref.relation} aponta para ${ref.type}:${ref.id}, ausente da fotografia.` };
      else if (!blocker && parentRow?.sourceValidation.status === 'BLOCKED') blocker = { code: 'BLOCKED_DESTINATION_LINK', category: 'LIMITACAO_PLANEJADOR', evidence: `A relação de destino ${ref.relation} depende de entidade bloqueada.` };
      else if (!blocker && !parentRow) blocker = { code: 'CYCLIC_DESTINATION_LINK', category: 'CONFLITO_DADOS', evidence: `A relação de destino ${ref.relation} participa de dependência cíclica.` };
      else if (!blocker && resolvedPdvId && parentRow?.sourceValidation.canonicalPdvId !== resolvedPdvId) blocker = { code: 'CROSS_DESTINATION_LINK', category: 'CONFLITO_DADOS', evidence: `A relação ${ref.relation} resolve para um PDV canônico diferente da origem principal.` };
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

    const action: PlanAction = blocker ? 'BLOQUEADO'
      : record.type === 'PDV' && proposedPdvId && record.id === proposedPdvId ? 'CRIAR_DESTINO'
      : record.preserveId === false ? 'REASSOCIAR'
      : Object.values(record.sourceLinks ?? {}).some((value) => value !== null) || record.pdvFrom ? 'REASSOCIAR'
      : 'MANTER';
    const sourceStatus = blocker ? 'BLOCKED' as const : 'VALID' as const;
    const targetLinks: Record<string, string | null> = {};
    let targetType: TargetEntityType | null = null;
    let targetId: string | null = null;
    let transformation: string | null = null;
    let targetBlockerCode: string | null = blocker?.code ?? null;
    const requireTarget = (key: string, value: string | null | undefined) => {
      targetLinks[key] = value ?? null;
      if (value == null) targetBlockerCode ??= 'TARGET_LINK_UNMAPPED';
    };
    if (!blocker) {
      switch (record.type) {
        case 'PDV':
          targetType = 'PONTO_VENDA'; targetId = resolvedPdvId; transformation = 'PRESERVE_CANONICAL_PDV_ID';
          break;
        case 'TRAILER':
          if (trailers.length > 1) targetBlockerCode = 'TRAILER_TO_PDV_REQUIRES_MANUAL_COALESCING';
          else { targetType = 'PONTO_VENDA'; targetId = resolvedPdvId; transformation = 'TRAILER_TO_CANONICAL_PDV'; }
          break;
        case 'EVENTO': {
          const role = record.eventRole;
          if (!role) { targetBlockerCode = 'EVENT_ROLE_UNSPECIFIED'; break; }
          targetType = role === 'AGENDA' ? 'AGENDA_OPERACIONAL' : 'OCORRENCIA_OPERACIONAL';
          targetId = record.id;
          transformation = role === 'AGENDA' ? 'EVENT_SERIES_TO_OPERATIONAL_AGENDA' : 'EVENT_DATE_TO_OPERATIONAL_OCCURRENCE';
          const trailerRef = (record.parents ?? []).find((ref) => ref.type === 'TRAILER');
          const trailerTarget = trailerRef ? getParentRow(trailerRef)?.targetMapping : undefined;
          if (trailerTarget?.destinationEntity?.type !== 'PONTO_VENDA' || trailerTarget.status !== 'COMPLETE') targetBlockerCode ??= 'EVENT_TRAILER_TARGET_UNMAPPED';
          requireTarget('pontoVendaId', trailerTarget?.destinationEntity?.id ?? null);
          const seriesRef = (record.parents ?? []).find((ref) => ref.relation === 'serieId');
          if (seriesRef) {
            const seriesTarget = getParentRow(seriesRef)?.targetMapping;
            if (seriesTarget?.destinationEntity?.type !== 'AGENDA_OPERACIONAL' || seriesTarget.status !== 'COMPLETE') targetBlockerCode ??= 'SERIES_AGENDA_TARGET_UNMAPPED';
            targetLinks.agendaId = seriesTarget?.destinationEntity?.id ?? null;
          } else if (role === 'AGENDA') targetLinks.agendaId = null;
          break;
        }
        case 'SESSAO_EVENTO': {
          const eventRef = (record.parents ?? []).find((ref) => ref.type === 'EVENTO');
          const eventTarget = eventRef ? getParentRow(eventRef)?.targetMapping : undefined;
          if (eventTarget?.destinationEntity?.type !== 'OCORRENCIA_OPERACIONAL' || eventTarget.status !== 'COMPLETE') {
            targetBlockerCode = 'EVENT_OCCURRENCE_TARGET_UNMAPPED';
            break;
          }
          targetType = 'SESSAO_CAIXA'; targetId = record.id; transformation = 'EVENT_CASH_TO_SHARED_CASH_SESSION';
          requireTarget('pontoVendaId', resolvedPdvId);
          requireTarget('ocorrenciaId', eventTarget.destinationEntity.id);
          targetLinks.origemHistorica = record.historicalOrigin ?? 'EVENTO';
          targetLinks.contextoOperacional = 'CAIXA';
          break;
        }
        case 'COMANDA': {
          targetType = 'COMANDA'; targetId = record.id; transformation = 'PRESERVE_COMANDA_AND_HISTORICAL_ORIGIN';
          requireTarget('pontoVendaId', resolvedPdvId);
          targetLinks.origemHistorica = record.historicalOrigin ?? null;
          const eventRef = (record.parents ?? []).find((ref) => ref.type === 'EVENTO');
          if (record.historicalOrigin === 'EVENTO') {
            const eventTarget = eventRef ? getParentRow(eventRef)?.targetMapping : undefined;
            if (eventTarget?.destinationEntity?.type !== 'OCORRENCIA_OPERACIONAL' || eventTarget.status !== 'COMPLETE') targetBlockerCode ??= 'COMMAND_OCCURRENCE_TARGET_UNMAPPED';
            targetLinks.ocorrenciaId = eventTarget?.destinationEntity?.id ?? null;
            requireTarget('ocorrenciaId', targetLinks.ocorrenciaId);
          } else targetLinks.ocorrenciaId = null;
          break;
        }
        default:
          targetBlockerCode = 'TARGET_TRANSFORMATION_NOT_DEFINED';
      }
    }
    const requiredTargetLinks = targetType === 'AGENDA_OPERACIONAL' || targetType === 'OCORRENCIA_OPERACIONAL'
      ? ['pontoVendaId', ...((record.parents ?? []).some((ref) => ref.relation === 'serieId') ? ['agendaId'] : [])]
      : targetType === 'SESSAO_CAIXA' ? ['pontoVendaId', 'ocorrenciaId']
      : targetType === 'COMANDA' ? ['pontoVendaId', ...(record.historicalOrigin === 'EVENTO' ? ['ocorrenciaId'] : [])]
      : targetType === 'PONTO_VENDA' ? [] : [];
    if (requiredTargetLinks.some((link) => targetLinks[link] == null)) targetBlockerCode ??= 'TARGET_REQUIRED_LINK_MISSING';
    const targetStatus = targetType && targetId && !targetBlockerCode ? 'COMPLETE' as const : 'INCOMPLETE' as const;
    const sourceEvidence = blocker?.evidence ?? 'Existência, tenant, vínculos de origem e destino canônico validados por tipo e ID.';
    const row: PdvMigrationPlanRow = {
      sourceType: record.type,
      sourceId: record.id,
      action,
      dependencies,
      idPreservation: record.preserveId === false ? 'REGENERATE_SOURCE_ID' : 'PRESERVE_SOURCE_ID',
      sourceValidation: { status: sourceStatus, canonicalPdvId: blocker ? null : resolvedPdvId, blocker, evidence: sourceEvidence },
      targetMapping: {
        status: targetStatus,
        destinationEntity: targetStatus === 'COMPLETE' ? { type: targetType!, id: targetId! } : null,
        destinationLinks: targetStatus === 'COMPLETE' ? targetLinks : {},
        requiredDestinationLinks: requiredTargetLinks,
        transformation,
        blockerCode: targetStatus === 'COMPLETE' ? null : targetBlockerCode ?? 'TARGET_MAPPING_INCOMPLETE',
        evidence: targetStatus === 'COMPLETE'
          ? `Mapeamento proposto: ${transformation}; sem escrita e sem autorização de execução.`
          : blocker?.evidence ?? 'Transformação para o modelo alvo ainda não está completamente definida.',
      },
      executionEligibility: 'NOT_AUTHORIZED',
    };
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.sourceType.localeCompare(b.sourceType) || a.sourceId.localeCompare(b.sourceId));
}

/** Validates source data only. A valid source graph is not authorization to write to the target model. */
export function assertSourceGraphValid(rows: PdvMigrationPlanRow[]): void {
  const blocked = rows.filter((row) => row.sourceValidation.status !== 'VALID' || row.dependencies.some((dependency) => !dependency.resolved));
  if (blocked.length) throw new Error(`Source graph has ${blocked.length} blocked row(s).`);
}
