import type { UserRole } from '@prisma/client';
import { prisma } from '../prisma.js';
import type { JwtPayload } from '../../types/auth.js';

export class DescontoInvalidoError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function papelPodeDarDescontoQuiosque(
  papel: UserRole | JwtPayload['papel'],
  podeDarDescontoQuiosque: boolean,
): boolean {
  return papel === 'DONO' || papel === 'ADMIN' || podeDarDescontoQuiosque;
}

export async function assertPodeDarDescontoQuiosque(user: JwtPayload) {
  if (user.papel === 'DONO' || user.papel === 'ADMIN') return;

  const usuario = await prisma.usuario.findUnique({
    where: { id: user.sub },
    select: { podeDarDescontoQuiosque: true },
  });

  if (!usuario?.podeDarDescontoQuiosque) {
    throw new DescontoInvalidoError('Sem permissão para aplicar desconto na comanda', 403);
  }
}
