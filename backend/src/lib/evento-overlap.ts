import { prisma } from './prisma.js';

const MINUTES_PER_DAY = 24 * 60;

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function getTimeRangeMinutes(
  horaInicio: string,
  horaFim: string | null | undefined,
): { start: number; end: number } {
  const start = timeToMinutes(horaInicio);
  if (!horaFim) {
    return { start, end: MINUTES_PER_DAY };
  }
  let end = timeToMinutes(horaFim);
  if (end <= start) {
    end += MINUTES_PER_DAY;
  }
  return { start, end };
}

export function schedulesOverlap(
  a: { horaInicio: string; horaFim: string | null | undefined },
  b: { horaInicio: string; horaFim: string | null | undefined },
): boolean {
  const rangeA = getTimeRangeMinutes(a.horaInicio, a.horaFim);
  const rangeB = getTimeRangeMinutes(b.horaInicio, b.horaFim);
  return rangeA.start < rangeB.end && rangeB.start < rangeA.end;
}

type ScheduleInput = {
  cervejariaId: string;
  trailerId: string;
  horaInicio: string;
  horaFim?: string | null;
  excludeEventoId?: string;
};

export function sessaoReservaTrailerWhere() {
  return {
    OR: [
      { status: 'ABERTO' as const },
      { status: 'FECHADO' as const, encerradoEm: null },
    ],
  };
}

export async function findSessaoTrailerConflict(
  input: ScheduleInput & { data: Date },
): Promise<{ id: string; nome: string } | null> {
  const candidates = await prisma.evento.findMany({
    where: {
      cervejariaId: input.cervejariaId,
      trailerId: input.trailerId,
      data: input.data,
      recorrencia: 'NENHUMA',
      ...sessaoReservaTrailerWhere(),
      ...(input.excludeEventoId ? { id: { not: input.excludeEventoId } } : {}),
    },
    select: { id: true, nome: true, horaInicio: true, horaFim: true },
  });

  const probe = { horaInicio: input.horaInicio, horaFim: input.horaFim };
  return candidates.find((c) => schedulesOverlap(probe, c)) ?? null;
}

export async function findSerieTrailerConflict(
  input: ScheduleInput & { diaSemana: number },
): Promise<{ id: string; nome: string } | null> {
  const candidates = await prisma.evento.findMany({
    where: {
      cervejariaId: input.cervejariaId,
      trailerId: input.trailerId,
      recorrencia: 'SEMANAL',
      serieId: null,
      diaSemana: input.diaSemana,
      ...(input.excludeEventoId ? { id: { not: input.excludeEventoId } } : {}),
    },
    select: { id: true, nome: true, horaInicio: true, horaFim: true },
  });

  const probe = { horaInicio: input.horaInicio, horaFim: input.horaFim };
  return candidates.find((c) => schedulesOverlap(probe, c)) ?? null;
}

export function trailerScheduleConflictMessage(conflict: { nome: string }): string {
  return `Este trailer já possui o evento "${conflict.nome}" no mesmo horário.`;
}
