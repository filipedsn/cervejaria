import type { UserRole } from '@prisma/client';
import type { JwtPayload } from '../../types/auth.js';
import { usuarioPode } from './permissoes.js';

export class DescontoInvalidoError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function papelPodeDarDescontoOperacao(
  papel: UserRole | JwtPayload['papel'],
  podeDarDescontoOperacao: boolean,
): boolean {
  return papel === 'DONO' || papel === 'ADMIN' || podeDarDescontoOperacao;
}

export async function assertPodeDarDescontoOperacao(user: JwtPayload) {
  if (!(await usuarioPode(user, 'discount.apply', { allowLegacyDiscount: true }))) {
    throw new DescontoInvalidoError('Sem permissão para aplicar desconto na comanda', 403);
  }
}
