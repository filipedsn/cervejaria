import { prisma } from '../prisma.js';

export type CaixaAuditNomes = { empresaNome?: string; pontoVendaNome?: string };

type NomesDb = {
  cervejaria: { findUnique(args: { where: { id: string }; select: { nome: true } }): Promise<{ nome: string } | null> };
  pontoVenda: { findFirst(args: { where: { id: string; cervejariaId: string }; select: { nome: true } }): Promise<{ nome: string } | null> };
};

/**
 * Display names for the cash open/close audit events (read by the Support Analyst [CAIXA] notice).
 * Keys avoid the redacted `nome`; a lookup failure never blocks the cash operation.
 */
export async function caixaAuditNomes(cervejariaId: string, pontoVendaId: string | null | undefined, client: unknown = prisma): Promise<CaixaAuditNomes> {
  const db = client as NomesDb;
  try {
    const [empresa, pontoVenda] = await Promise.all([
      db.cervejaria.findUnique({ where: { id: cervejariaId }, select: { nome: true } }),
      pontoVendaId ? db.pontoVenda.findFirst({ where: { id: pontoVendaId, cervejariaId }, select: { nome: true } }) : null,
    ]);
    return {
      ...(empresa?.nome ? { empresaNome: empresa.nome } : {}),
      ...(pontoVenda?.nome ? { pontoVendaNome: pontoVenda.nome } : {}),
    };
  } catch {
    return {};
  }
}
