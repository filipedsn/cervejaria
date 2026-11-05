import type { ContaPendenteOperacao } from './operacao';

export type GrupoContasCliente = {
  clienteId: string;
  cliente: ContaPendenteOperacao['cliente'];
  contas: ContaPendenteOperacao[];
  saldo: number;
  valorOriginal: number;
  recebido: number;
  createdAtMaisAntigo: string;
};

const BRAZIL_TZ = 'America/Sao_Paulo';

function dataConsumoIso(conta: ContaPendenteOperacao): string {
  return conta.comanda.diaOperacional
    ?? conta.comanda.fechadaEm
    ?? conta.createdAt;
}

function chaveCalendario(valor: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(valor.trim());
  return match?.[1] ?? null;
}

/** Formata data de calendário (YYYY-MM-DD / ISO @db.Date) sem deslocar fuso. */
export function formatDataCalendarioPt(valor: string): string {
  const chave = chaveCalendario(valor);
  if (!chave) {
    return new Date(valor).toLocaleDateString('pt-BR', { timeZone: BRAZIL_TZ });
  }
  return new Date(`${chave}T00:00:00.000Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

/** Label pt-BR do consumo: diaOperacional como calendário; senão instante em São Paulo. */
export function formatDataConsumoContaPt(conta: ContaPendenteOperacao): string {
  const diaOperacional = conta.comanda.diaOperacional?.trim();
  if (diaOperacional) return formatDataCalendarioPt(diaOperacional);
  const instante = conta.comanda.fechadaEm ?? conta.createdAt;
  return new Date(instante).toLocaleDateString('pt-BR', { timeZone: BRAZIL_TZ });
}

/** Chave YYYY-MM-DD do consumo para filtros (Hoje). */
export function chaveDataConsumoConta(conta: ContaPendenteOperacao): string {
  const diaOperacional = conta.comanda.diaOperacional?.trim();
  if (diaOperacional) {
    return chaveCalendario(diaOperacional) ?? diaOperacional.slice(0, 10);
  }
  const instante = conta.comanda.fechadaEm ?? conta.createdAt;
  return new Intl.DateTimeFormat('en-CA', { timeZone: BRAZIL_TZ }).format(new Date(instante));
}

/** Agrupa contas pendentes por cliente, ordenando turnos do mais antigo ao mais recente. */
export function agruparContasPorCliente(contas: ContaPendenteOperacao[]): GrupoContasCliente[] {
  const porCliente = new Map<string, ContaPendenteOperacao[]>();
  for (const conta of contas) {
    const lista = porCliente.get(conta.cliente.id) ?? [];
    lista.push(conta);
    porCliente.set(conta.cliente.id, lista);
  }

  const grupos: GrupoContasCliente[] = [];
  for (const [, lista] of porCliente) {
    const ordenadas = [...lista].sort(
      (a, b) => new Date(dataConsumoIso(a)).getTime() - new Date(dataConsumoIso(b)).getTime(),
    );
    const saldo = ordenadas.reduce((soma, conta) => soma + conta.saldo, 0);
    const valorOriginal = ordenadas.reduce((soma, conta) => soma + conta.valorOriginal, 0);
    const recebido = ordenadas.reduce((soma, conta) => soma + conta.recebido, 0);
    grupos.push({
      clienteId: ordenadas[0].cliente.id,
      cliente: ordenadas[0].cliente,
      contas: ordenadas,
      saldo,
      valorOriginal,
      recebido,
      createdAtMaisAntigo: ordenadas[0].createdAt,
    });
  }

  return grupos;
}

export function dataConsumoConta(conta: ContaPendenteOperacao): string {
  return dataConsumoIso(conta);
}
