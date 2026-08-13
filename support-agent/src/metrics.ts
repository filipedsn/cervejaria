import { config } from './config.js';
import { log } from './logger.js';

/**
 * Fase 5 — metricas do proprio agente.
 *
 * Exporta via OTLP/HTTP JSON direto para o collector (`:4318`), sem carregar o SDK
 * do OpenTelemetry: sao poucos contadores e o agente e um processo curto, entao a
 * dependencia nao se paga. Se o endpoint nao estiver configurado, vira no-op.
 */

export type MetricName =
  | 'support_agent.alertas_triados'
  | 'support_agent.issues_abertas'
  | 'support_agent.issues_duplicadas'
  | 'support_agent.alertas_infra'
  | 'support_agent.alertas_sem_evidencia'
  | 'support_agent.fix_tentativas'
  | 'support_agent.fix_suprimido'
  | 'support_agent.fix_falhou_verificacao'
  | 'support_agent.cli_execucoes'
  | 'support_agent.prs_abertos'
  | 'support_agent.prs_aprovados'
  | 'support_agent.prs_rejeitados'
  | 'support_agent.prs_bloqueados_por_policy'
  | 'support_agent.circuit_breaker_acionado';

type Point = { name: MetricName; value: number; attributes: Record<string, string> };

const buffer: Point[] = [];

export function record(name: MetricName, value = 1, attributes: Record<string, string> = {}): void {
  buffer.push({ name, value, attributes });
}

function otlpAttributes(attributes: Record<string, string>) {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: { stringValue: value },
  }));
}

function endpointUrl(): string | null {
  const base = config.otlp.endpoint;
  if (!base) return null;
  const trimmed = base.replace(/\/$/, '');
  return trimmed.endsWith('/v1/metrics') ? trimmed : `${trimmed}/v1/metrics`;
}

/** Envia e limpa o buffer. Chamado ao fim de cada ciclo de poll. */
export async function flush(): Promise<void> {
  if (!buffer.length) return;
  const url = endpointUrl();
  if (!url) {
    buffer.length = 0;
    return;
  }

  const nowNanos = String(Date.now() * 1_000_000);
  const points = buffer.splice(0, buffer.length);

  const payload = {
    resourceMetrics: [
      {
        resource: {
          attributes: otlpAttributes({
            'service.name': config.otlp.serviceName,
            'deployment.environment.name': config.otlp.environment,
            // Definir explicitamente: o transform/namespace do collector so preenche
            // quando o atributo esta nil e espera o valor "production", nao "prd" —
            // sem isto as metricas do agente cairiam no namespace dev.
            'data_stream.namespace': config.otlp.environment,
          }),
        },
        scopeMetrics: [
          {
            scope: { name: 'quiver-tap-support-agent', version: '1.0.0' },
            metrics: aggregate(points).map(({ name, value, attributes }) => ({
              name,
              unit: '1',
              sum: {
                aggregationTemporality: 1,
                isMonotonic: true,
                dataPoints: [
                  {
                    asDouble: value,
                    timeUnixNano: nowNanos,
                    startTimeUnixNano: nowNanos,
                    attributes: otlpAttributes(attributes),
                  },
                ],
              },
            })),
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) log.warn('OTLP recusou as metricas do agente', { status: res.status });
  } catch (err) {
    log.warn('Falha ao exportar metricas do agente', { err: String(err) });
  }
}

/** Soma pontos com o mesmo nome e os mesmos atributos, para nao enviar 1 request por evento. */
function aggregate(points: Point[]): Point[] {
  const merged = new Map<string, Point>();
  for (const point of points) {
    const key = `${point.name}|${JSON.stringify(point.attributes)}`;
    const existing = merged.get(key);
    if (existing) existing.value += point.value;
    else merged.set(key, { ...point });
  }
  return [...merged.values()];
}
