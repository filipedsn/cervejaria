import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { getZonedParts } from './event-datetime.js';

type Db = Prisma.TransactionClient | typeof prisma;

export type CaixaAbertoAdmin = {
  id: string;
  tipo: 'CAIXA' | 'EVENTO';
  local: string;
  abertoEm: string;
};

/** Caixas abertos do modelo Por Caixa e de eventos, do mais antigo para o mais novo. */
export async function getCaixasAbertosPorCervejaria(
  cervejariaId?: string,
  db: Db = prisma,
): Promise<Map<string, CaixaAbertoAdmin[]>> {
  const [operacao, evento] = await Promise.all([
    db.sessaoCaixaOperacao.findMany({
      where: { status: 'ABERTO', ...(cervejariaId ? { cervejariaId } : {}) },
      select: { id: true, cervejariaId: true, abertoEm: true, pontoVenda: { select: { nome: true } } },
    }),
    db.sessaoCaixaEvento.findMany({
      where: { status: 'ABERTO', ...(cervejariaId ? { evento: { cervejariaId } } : {}) },
      select: { id: true, abertoEm: true, evento: { select: { cervejariaId: true, nome: true } } },
    }),
  ]);

  const porEmpresa = new Map<string, CaixaAbertoAdmin[]>();
  const adicionar = (empresaId: string, caixa: CaixaAbertoAdmin) => {
    porEmpresa.set(empresaId, [...(porEmpresa.get(empresaId) ?? []), caixa]);
  };
  for (const sessao of operacao) {
    adicionar(sessao.cervejariaId, {
      id: sessao.id,
      tipo: 'CAIXA',
      local: sessao.pontoVenda.nome,
      abertoEm: sessao.abertoEm.toISOString(),
    });
  }
  for (const sessao of evento) {
    adicionar(sessao.evento.cervejariaId, {
      id: sessao.id,
      tipo: 'EVENTO',
      local: sessao.evento.nome,
      abertoEm: sessao.abertoEm.toISOString(),
    });
  }
  for (const caixas of porEmpresa.values()) caixas.sort((a, b) => a.abertoEm.localeCompare(b.abertoEm));
  return porEmpresa;
}

function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function diaUtc(ano: number, mes: number, dia: number): number {
  return Date.UTC(ano, mes - 1, dia);
}

function isoData(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Próxima data de vencimento a partir de hoje (ou do início do contrato, se futuro).
 * Em meses mais curtos que o dia combinado, vence no último dia do mês.
 */
export function proximoVencimento(
  diaVencimento: number | null,
  dataInicioContrato: Date | null,
  now: Date = new Date(),
): { data: string; diasRestantes: number } | null {
  if (!diaVencimento || diaVencimento < 1 || diaVencimento > 31) return null;

  const hoje = getZonedParts(now);
  const hojeUtc = diaUtc(hoje.year, hoje.month, hoje.day);
  let base = { ano: hoje.year, mes: hoje.month, dia: hoje.day };
  if (dataInicioContrato) {
    const inicioUtc = diaUtc(dataInicioContrato.getUTCFullYear(), dataInicioContrato.getUTCMonth() + 1, dataInicioContrato.getUTCDate());
    if (inicioUtc > hojeUtc) {
      base = { ano: dataInicioContrato.getUTCFullYear(), mes: dataInicioContrato.getUTCMonth() + 1, dia: dataInicioContrato.getUTCDate() };
    }
  }

  let { ano, mes } = base;
  let dia = Math.min(diaVencimento, ultimoDiaDoMes(ano, mes));
  if (dia < base.dia) {
    mes += 1;
    if (mes === 13) {
      mes = 1;
      ano += 1;
    }
    dia = Math.min(diaVencimento, ultimoDiaDoMes(ano, mes));
  }

  return {
    data: isoData(ano, mes, dia),
    diasRestantes: Math.round((diaUtc(ano, mes, dia) - hojeUtc) / 86_400_000),
  };
}
