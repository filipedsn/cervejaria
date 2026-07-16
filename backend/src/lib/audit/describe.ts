import type { TransacaoTipo } from '@prisma/client';
import { formatTransacaoDescricao } from '../transacao-log.js';

export function describeHttpAction(method: string, route: string, statusCode: number): string {
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
  const verb =
    method.toUpperCase() === 'GET'
      ? 'Consultou'
      : method.toUpperCase() === 'POST'
        ? 'Criou/executou'
        : method.toUpperCase() === 'PUT' || method.toUpperCase() === 'PATCH'
          ? 'Alterou'
          : method.toUpperCase() === 'DELETE'
            ? 'Excluiu'
            : method.toUpperCase();
  const outcome = statusCode >= 400 ? ' (falhou)' : '';
  if (mutating || statusCode >= 400) {
    return `${verb} ${route} → ${statusCode}${outcome}`;
  }
  return `Consultou ${route} → ${statusCode}`;
}

export function describeSqlAction(model: string, operation: string, durationMs: number): string {
  return `SQL ${operation} em ${model} (${durationMs} ms)`;
}

export function describeUiAction(label: string, page: string): string {
  return `Clicou em "${label}" na página ${page}`;
}

export function describeTransacao(tipo: TransacaoTipo, metadata: unknown): string {
  return formatTransacaoDescricao(tipo, metadata);
}

export function describePageView(page: string): string {
  return `Abriu a página ${page}`;
}
