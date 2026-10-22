import { metrics } from '@opentelemetry/api';
import { getTelemetryContext } from './telemetry-context.js';

const meter = metrics.getMeter('quiver-tap-business');

const comandasFechadas = meter.createCounter('quiver.comandas.fechadas', {
  description: 'Comandas fechadas com pagamento',
});

const valorVendidoCentavos = meter.createCounter('quiver.vendas.valor_centavos', {
  description: 'Valor total vendido em centavos',
});

const tempoPreparoCozinhaMs = meter.createHistogram('quiver.cozinha.tempo_preparo_ms', {
  description: 'Tempo de preparo do pedido na cozinha',
  unit: 'ms',
});

const divergenciaCaixaCentavos = meter.createCounter('quiver.caixa.divergencia_centavos', {
  description: 'Divergencia absoluta no fechamento de caixa em centavos',
});

const transacaoTotal = meter.createCounter('quiver.transacao.total', {
  description: 'Transacoes de negocio registradas',
});

const transacaoFailure = meter.createCounter('quiver.transacao.failure', {
  description: 'Falhas ao registrar transacoes de negocio',
});

function businessAttrs(tipo: string): Record<string, string> {
  const ctx = getTelemetryContext();
  const attrs: Record<string, string> = { 'quiver.evento.tipo': tipo };
  attrs['cervejaria.slug'] = ctx?.slug ?? 'unknown';
  if (ctx?.cervejariaId) attrs['cervejaria.id'] = ctx.cervejariaId;
  return attrs;
}

export function recordComandaFechada(valorCentavos: number, origem: 'cervejaria' | 'operacao'): void {
  const attrs = businessAttrs(`comanda_fechada_${origem}`);
  comandasFechadas.add(1, attrs);
  if (valorCentavos > 0) valorVendidoCentavos.add(valorCentavos, attrs);
}

export function recordVendaAvulsa(valorCentavos: number): void {
  const attrs = businessAttrs('venda_avulsa');
  comandasFechadas.add(1, attrs);
  if (valorCentavos > 0) valorVendidoCentavos.add(valorCentavos, attrs);
}

export function recordTempoPreparoCozinha(durationMs: number): void {
  tempoPreparoCozinhaMs.record(durationMs, businessAttrs('cozinha_preparo'));
}

export function recordDivergenciaCaixa(absCentavos: number): void {
  if (absCentavos <= 0) return;
  divergenciaCaixaCentavos.add(absCentavos, businessAttrs('caixa_divergencia'));
}

export function recordTransacaoMetric(
  tipo: string,
  outcome: 'success' | 'failure',
  slug?: string,
): void {
  const attrs: Record<string, string> = {
    'quiver.evento.tipo': 'transacao',
    'quiver.transacao.tipo': tipo,
  };
  attrs['cervejaria.slug'] = slug ?? 'unknown';
  const ctx = getTelemetryContext();
  if (ctx?.cervejariaId) attrs['cervejaria.id'] = ctx.cervejariaId;
  transacaoTotal.add(1, attrs);
  if (outcome === 'failure') transacaoFailure.add(1, attrs);
}
