/** Documento de `quiver-tap-alert-events`, gravado pelo connector `.index` do Kibana. */
export type AlertDoc = {
  ruleName?: string;
  alertState?: string;
  reason?: string;
  viewInAppUrl?: string;
  '@timestamp'?: string;
  processed?: boolean;
  supportAgentTriaged?: boolean;
};

export type Alert = {
  id: string;
  ruleName: string;
  alertState: string;
  reason: string;
  viewInAppUrl: string;
  timestamp: string;
};

/** Campos que o agente extrai de um log OTel, lidos do `_source` (nao do mapping). */
export type LogEvent = {
  timestamp: string;
  severity: string;
  message: string;
  eventAction?: string;
  eventOutcome?: string;
  eventCategory?: string;
  httpRoute?: string;
  httpMethod?: string;
  httpStatus?: number;
  cervejariaSlug?: string;
  actorType?: string;
  traceId?: string;
  spanId?: string;
  serviceName?: string;
  dataset?: string;
  stack?: string;
};

export type Evidence = {
  /** Logs de falha na janela do alerta, falhas de servidor primeiro. */
  failures: LogEvent[];
  /** Falhas atribuiveis ao servidor (5xx, error/fatal, outcome failure sem 4xx). */
  serverFailureCount: number;
  /** Erros 4xx: contexto, nao bug. Um 401 em /api/auth/me e comportamento esperado. */
  clientErrorCount: number;
  /** Contagem por rota, para mostrar onde concentra. */
  byRoute: { route: string; count: number }[];
  /** Contagem por tenant. */
  byTenant: { slug: string; count: number }[];
  /** Contagem por acao de evento. */
  byAction: { action: string; count: number }[];
  totalInWindow: number;
  windowFrom: string;
  windowTo: string;
  /** Primeira ocorrencia encontrada olhando para tras (ate 7 dias). */
  firstSeen?: string;
  /** Quantas vezes a mesma falha apareceu nos ultimos 7 dias. */
  occurrences7d?: number;
  /** Amostra de stack trace, se algum log trouxe. */
  stack?: string;
  /** trace_id util para abrir o trace no Kibana. */
  traceId?: string;
  /** Por que o enriquecimento nao achou nada, quando for o caso. */
  gap?: string;
};

export type TriageDecision =
  | { kind: 'codigo'; rule: string }
  | { kind: 'infra'; rule: string; reason: string }
  | { kind: 'desconhecido'; rule: string; reason: string };

export type Dossier = {
  alert: Alert;
  evidence: Evidence;
  decision: TriageDecision;
  fingerprint: string;
  suspects: SuspectFile[];
  kibanaLinks: { alert?: string; logs: string; trace?: string };
};

export type SuspectFile = {
  path: string;
  why: string;
};
