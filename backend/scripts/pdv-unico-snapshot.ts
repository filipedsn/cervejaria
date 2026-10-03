import { decimalToScaledInteger } from './pdv-unico-migration-planner.js';

type DecimalLike = string | { toString(): string };
const cents = (value: DecimalLike) => decimalToScaledInteger(String(value), 2).toString();
const iso = (value: Date | null) => value?.toISOString() ?? null;

export interface CommandSnapshotInput {
  id: string; origem: string; status: string; tipo: string; numero: number | null;
  eventoId: string | null; clienteId: string | null; pontoVendaId: string | null;
  abertaPorId: string | null; fechadoPorId: string | null; fechadaEm: Date | null;
  diaOperacional: Date | null; eventoData: Date | null; createdAt: Date; updatedAt: Date;
  total: DecimalLike; desconto: DecimalLike;
  itens: Array<{
    id: string; produtoId: string | null; tapId: string | null; volumeMl: number;
    quantidade: number; precoUnit: DecimalLike; exigePreparo: boolean; paraViagem: boolean;
    cancelamentoPendenteEm: Date | null; canceladoEm: Date | null;
    pedidoCozinhaId: string | null; createdAt: Date;
    opcionais: Array<{ id: string; opcionalId: string | null; opcionalCatalogoId: string | null; precoAdicional: DecimalLike; quantidade: number }>;
  }>;
}

/** Redacted diagnostic view retaining all IDs and exact non-PII sale snapshots. */
export function serializeCommandSnapshot(command: CommandSnapshotInput) {
  const operationDay = command.diaOperacional ?? command.eventoData;
  return {
    id: command.id, origin: command.origem, status: command.status, type: command.tipo,
    number: command.numero, eventId: command.eventoId, clientId: command.clienteId,
    pointOfSaleId: command.pontoVendaId, openedById: command.abertaPorId,
    closedById: command.fechadoPorId, closedAt: iso(command.fechadaEm),
    operationDay: operationDay?.toISOString().slice(0, 10) ?? command.createdAt.toISOString().slice(0, 10),
    operationDayEvidence: command.diaOperacional ? 'STORED_OPERATIONAL_DATE'
      : command.eventoData ? 'INHERITED_EVENT_DATE' : 'UTC_FALLBACK_UNVERIFIED',
    operationDayTimezone: command.diaOperacional || command.eventoData ? 'DATE_ONLY_SOURCE' : 'UTC_FALLBACK_ONLY',
    createdAt: command.createdAt.toISOString(), updatedAt: command.updatedAt.toISOString(),
    totalCents: cents(command.total), discountCents: cents(command.desconto),
    items: command.itens.map((item) => ({
      id: item.id, productId: item.produtoId, tapId: item.tapId, volumeMl: item.volumeMl,
      quantity: item.quantidade, unitPriceCents: cents(item.precoUnit),
      kitchenRequired: item.exigePreparo, takeAway: item.paraViagem,
      cancelPendingAt: iso(item.cancelamentoPendenteEm), cancelledAt: iso(item.canceladoEm),
      kitchenOrderId: item.pedidoCozinhaId, createdAt: item.createdAt.toISOString(),
      optionals: item.opcionais.map((optional) => ({
        id: optional.id, productOptionId: optional.opcionalId,
        catalogOptionalId: optional.opcionalCatalogoId,
        centsEach: cents(optional.precoAdicional), quantity: optional.quantidade,
      })),
    })),
  };
}
