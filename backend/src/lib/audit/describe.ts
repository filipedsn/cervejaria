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

export function describeSelection(field: string, option: string, page: string): string {
  return `Selecionou "${option}" em "${field}" na página ${page}`;
}

export function describeSearch(term: string, screen: string): string {
  return `Buscou "${term}" em ${screen}`;
}

export function describeWebVital(name: string, value: number, rating: string | undefined, screen: string): string {
  const formatted = name === 'CLS' ? value.toFixed(3) : `${Math.round(value)} ms`;
  return `${name} ${formatted}${rating ? ` (${rating})` : ''} em ${screen}`;
}

export function describeUiError(screen: string, message: string, intentSummary?: string): string {
  const intent = intentSummary ? ` ao tentar "${intentSummary}"` : '';
  return `Erro na interface em ${screen}${intent}: ${message}`;
}

export function describeUiActionResult(summary: string, screen: string, outcome: 'success' | 'failure'): string {
  return outcome === 'success' ? `Concluiu "${summary}" em ${screen}` : `Falhou ao "${summary}" em ${screen}`;
}

/** Appends the functional scope (e.g. "Comanda #42 · Mesa 3") so the message stands alone. */
export function withFunctionalScope(message: string, scope?: string): string {
  return scope ? `${message} [${scope}]` : message;
}

export function describeNavigation(screen: string): string {
  return `Navegou para ${screen}`;
}
