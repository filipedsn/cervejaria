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

function dataConsumoIso(conta: ContaPendenteOperacao): string {
  return conta.comanda.diaOperacional
    ?? conta.comanda.fechadaEm
    ?? conta.createdAt;
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
