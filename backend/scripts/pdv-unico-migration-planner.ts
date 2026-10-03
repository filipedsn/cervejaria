export type PlanAction = 'MANTER' | 'CRIAR_DESTINO' | 'REASSOCIAR' | 'BLOQUEADO';
export type PdvSourceType = 'PDV' | 'TRAILER' | 'EVENTO' | 'COMANDA' | 'ESTOQUE' | 'PAGAMENTO' | 'CONTA_RECEBER' | 'CONFIG_OPERACIONAL' | 'CONFIG_OPERACAO' | 'CLIENTE' | 'PRODUTO' | 'PRECO' | 'CARDAPIO' | 'CARDAPIO_PRODUTO' | 'GRUPO_OPCIONAL' | 'OPCAO_PRODUTO' | 'OPCIONAL_CATALOGO' | 'TAP' | 'TAP_MONTAGEM' | 'SESSAO_EVENTO' | 'MOVIMENTO_EVENTO' | 'SESSAO_CAIXA' | 'MOVIMENTO_CAIXA' | 'ITEM_COMANDA' | 'ITEM_OPCIONAL' | 'PEDIDO' | 'PEDIDO_ITEM_LINK' | 'MOVIMENTO_ESTOQUE';

export interface PdvPlanningCompany {
  companyId: string;
  pdvIds: string[];
  trailerIds: string[];
  events: Array<{ id: string; trailerId: string; seriesId: string | null; recurrence: string }>;
  commands: Array<{
    id: string;
    origin: string;
    eventId: string | null;
    pdvId: string | null;
    eventTenantId?: string | null;
    pdvTenantId?: string | null;
  }>;
  balances: Array<{ id: string; pdvId: string; tenantValid?: boolean }>;
  payments: Array<{ id: string; commandId: string; linkedCommandOrigin: string | null; receivableId?: string | null; paidAt?: string; amount?: string }>;
  receivables: Array<{ id: string; commandId: string; origin?: string | null; eventId?: string | null; pdvId?: string | null }>;
  identitySources?: Array<{ sourceType: PdvSourceType; sourceId: string; linkValid: boolean; evidence: string }>;
}

export interface PdvMigrationPlanRow {
  sourceType: PdvSourceType;
  sourceId: string;
  action: PlanAction;
  destinationId: string | null;
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

/** Pure, stable proposal planner. It never writes records or guesses from names. */
export function planPdvMigration(input: PdvPlanningCompany): PdvMigrationPlanRow[] {
  const pdvs = [...input.pdvIds].sort();
  const trailers = [...input.trailerIds].sort();
  const destinationId = pdvs.length === 1 ? pdvs[0] : null;
  const canProposeNewPdv = pdvs.length === 0 && trailers.length === 1;
  const proposedId = canProposeNewPdv ? `proposed-pdv:${input.companyId}:${trailers[0]}` : null;
  const conflicted = pdvs.length > 1 || (pdvs.length === 0 && trailers.length > 1);
  const rows: PdvMigrationPlanRow[] = [];

  for (const id of pdvs) rows.push({ sourceType: 'PDV', sourceId: id, action: pdvs.length === 1 ? 'MANTER' : 'BLOQUEADO', destinationId: pdvs.length === 1 ? id : null, evidence: pdvs.length === 1 ? 'Único PDV existente preservado por ID.' : 'Empresa possui múltiplos PDVs; resolução manual exigida.' });
  if (proposedId) rows.push({ sourceType: 'PDV', sourceId: proposedId, action: 'CRIAR_DESTINO', destinationId: proposedId, evidence: 'Empresa sem PDV e com exatamente um trailer; destino apenas proposto, sem escrita.' });

  for (const id of trailers) {
    const action = conflicted ? 'BLOQUEADO' : destinationId ? 'REASSOCIAR' : canProposeNewPdv ? 'REASSOCIAR' : 'BLOQUEADO';
    rows.push({ sourceType: 'TRAILER', sourceId: id, action, destinationId: action === 'REASSOCIAR' ? destinationId ?? proposedId : null, evidence: action === 'REASSOCIAR' ? 'Vínculo proposto pela relação única da empresa; validar no migrador antes da escrita.' : 'Destino ambíguo ou inexistente.' });
  }

  for (const event of input.events) {
    const sourceExists = trailers.includes(event.trailerId);
    const action = conflicted || !sourceExists ? 'BLOQUEADO' : 'REASSOCIAR';
    rows.push({ sourceType: 'EVENTO', sourceId: event.id, action, destinationId: action === 'REASSOCIAR' ? destinationId ?? proposedId : null, evidence: !sourceExists ? 'Trailer de origem ausente nesta empresa.' : event.seriesId ? `Ocorrência preserva agenda ${event.seriesId}; relação ao PDV segue o trailer existente.` : event.recurrence === 'SEMANAL' ? 'Agenda preservada; destino proposto pelo trailer existente.' : 'Evento avulso preservado; destino proposto pelo trailer existente.' });
  }

  for (const command of input.commands) {
    let action: PlanAction = 'BLOQUEADO';
    let evidence = 'Origem/vínculos sem evidência suficiente para associação automática.';
    if (command.eventTenantId && command.eventTenantId !== input.companyId || command.pdvTenantId && command.pdvTenantId !== input.companyId) {
      evidence = 'Vínculo cruza empresa/tenant.';
    } else if (command.origin === 'EVENTO' && command.eventId && !command.pdvId) {
      action = conflicted ? 'BLOQUEADO' : 'REASSOCIAR';
      evidence = 'Origem EVENTO e ID de evento preservados; destino deriva do trailer do evento.';
    } else if (command.origin === 'CAIXA' && command.pdvId && command.eventId === null) {
      action = conflicted ? 'BLOQUEADO' : 'MANTER';
      evidence = 'Origem CAIXA e PDV existentes preservados por ID.';
    } else if (command.origin === 'QUIOSQUE' && command.pdvId && command.eventId === null) {
      action = conflicted ? 'BLOQUEADO' : 'MANTER';
      evidence = 'Origem QUIOSQUE e PDV existentes preservados por ID.';
    } else if (command.eventId && command.pdvId) {
      evidence = 'Comanda tem Evento e PDV; relação dupla não prova conflito e exige investigar uso (por exemplo, estoque).';
    }
    rows.push({ sourceType: 'COMANDA', sourceId: command.id, action, destinationId: action === 'REASSOCIAR' ? destinationId ?? proposedId : action === 'MANTER' ? command.pdvId : null, evidence });
  }

  for (const balance of input.balances) {
    const action = conflicted || balance.tenantValid === false ? 'BLOQUEADO' : pdvs.includes(balance.pdvId) ? 'MANTER' : 'BLOQUEADO';
    rows.push({ sourceType: 'ESTOQUE', sourceId: balance.id, action, destinationId: action === 'MANTER' ? balance.pdvId : null, evidence: action === 'MANTER' ? 'Saldo preservado no PDV de origem.' : balance.tenantValid === false ? 'Tenant do produto ou PDV do saldo diverge da empresa.' : 'PDV de saldo não é destino comprovado.' });
  }

  const commandById = new Map(input.commands.map((item) => [item.id, item]));
  for (const payment of input.payments) {
    const command = commandById.get(payment.commandId);
    const agrees = command && payment.linkedCommandOrigin === command.origin;
    rows.push({ sourceType: 'PAGAMENTO', sourceId: payment.id, action: agrees ? 'MANTER' : 'BLOQUEADO', destinationId: agrees ? payment.commandId : null, evidence: agrees ? 'Pagamento mantém a origem da comanda vinculada.' : 'Comanda ausente ou origem divergente; conciliação manual.' });
  }
  for (const receivable of input.receivables) {
    const command = commandById.get(receivable.commandId);
    const origin = receivable.origin ?? command?.origin;
    const valid = origin === 'CAIXA' || origin === 'QUIOSQUE';
    rows.push({ sourceType: 'CONTA_RECEBER', sourceId: receivable.id, action: valid ? 'MANTER' : 'BLOQUEADO', destinationId: valid ? receivable.commandId : null, evidence: valid ? 'Dívida e comanda de origem permanecem ligadas; recebimentos posteriores não mudam sua origem.' : `Dívida sem origem operacional comprovada (origem=${origin ?? 'ausente'}; evento=${receivable.eventId ?? 'ausente'}; pdv=${receivable.pdvId ?? 'ausente'}).` });
  }
  for (const source of input.identitySources ?? []) {
    rows.push({ sourceType: source.sourceType, sourceId: source.sourceId, action: source.linkValid ? 'MANTER' : 'BLOQUEADO', destinationId: source.linkValid ? source.sourceId : null, evidence: source.evidence });
  }

  return rows.sort((a, b) => a.sourceType.localeCompare(b.sourceType) || a.sourceId.localeCompare(b.sourceId));
}
