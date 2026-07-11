import { prisma } from './prisma.js';

export type UsuarioResumo = { id: string; nome: string };

export type ReportFechadoPorContext = {
  proprietario: UsuarioResumo | null;
  hasFuncionarios: boolean;
};

export async function getReportFechadoPorContext(cervejariaId: string): Promise<ReportFechadoPorContext> {
  const [proprietario, funcionariosCount] = await Promise.all([
    prisma.usuario.findFirst({
      where: { cervejariaId, papel: 'DONO' },
      select: { id: true, nome: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.usuario.count({
      where: { cervejariaId, papel: 'ATENDENTE' },
    }),
  ]);

  return {
    proprietario,
    hasFuncionarios: funcionariosCount > 0,
  };
}

export function resolveFechadoPorForReport(
  comanda: {
    fechadoPorId: string | null;
    fechadoPor: UsuarioResumo | null;
  },
  ctx: ReportFechadoPorContext,
): { usuarioId: string | null; nome: string; groupKey: string } {
  if (comanda.fechadoPor) {
    return {
      usuarioId: comanda.fechadoPor.id,
      nome: comanda.fechadoPor.nome,
      groupKey: comanda.fechadoPor.id,
    };
  }

  if (!ctx.hasFuncionarios && ctx.proprietario) {
    return {
      usuarioId: ctx.proprietario.id,
      nome: ctx.proprietario.nome,
      groupKey: ctx.proprietario.id,
    };
  }

  return {
    usuarioId: null,
    nome: 'Não identificado',
    groupKey: '__unknown__',
  };
}
