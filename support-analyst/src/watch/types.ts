export type Severity = 'SEV1' | 'SEV2' | 'SEV3';

export type DetectorId =
  | 'local-network-down'
  | 'public-site-down'
  | 'elastic-unreachable'
  | 'elastic-auth-failed'
  | 'api-telemetry-stale'
  | 'collector-telemetry-stale'
  | 'error-log-surge';

export type DetectorRule = {
  id: DetectorId;
  title: string;
  severity: Severity;
  /** Consecutive bad cycles before FIRING. */
  fireAfter: number;
  /** Consecutive good cycles before RESOLVED. */
  resolveAfter: number;
  notify: boolean;
  nextStep: string;
};

export const DETECTOR_RULES: Record<DetectorId, DetectorRule> = {
  'local-network-down': { id: 'local-network-down', title: 'Rede do PC fora', severity: 'SEV3', fireAfter: 2, resolveAfter: 1, notify: false, nextStep: 'Nenhum: o agente pula os ciclos até a rede voltar.' },
  'public-site-down': { id: 'public-site-down', title: 'Site fora do ar (visto de fora)', severity: 'SEV1', fireAfter: 3, resolveAfter: 2, notify: true, nextStep: 'Abrir o painel Ops e conferir o cervejaria-api no VPS.' },
  'elastic-unreachable': { id: 'elastic-unreachable', title: 'Elastic PRD inacessível pelo PC', severity: 'SEV2', fireAfter: 3, resolveAfter: 2, notify: true, nextStep: 'Conferir a Tailscale no PC e o contêiner do Elasticsearch no VPS.' },
  'elastic-auth-failed': { id: 'elastic-auth-failed', title: 'Chave do analyst recusada pelo Elastic (expirada?)', severity: 'SEV2', fireAfter: 1, resolveAfter: 1, notify: true, nextStep: 'Renovar a API key quiver-support-analyst-prd (docs/support-analyst/prd-readonly-role.json).' },
  'api-telemetry-stale': { id: 'api-telemetry-stale', title: 'Telemetria da API parou de chegar', severity: 'SEV2', fireAfter: 2, resolveAfter: 2, notify: true, nextStep: 'Conferir as variáveis OTEL do cervejaria-api e o collector PRD.' },
  'collector-telemetry-stale': { id: 'collector-telemetry-stale', title: 'Collector PRD parou de enviar', severity: 'SEV2', fireAfter: 2, resolveAfter: 2, notify: true, nextStep: 'Conferir o contêiner quiver-edot-collector-prd no VPS.' },
  'error-log-surge': { id: 'error-log-surge', title: 'Surto de logs de erro na API', severity: 'SEV3', fireAfter: 1, resolveAfter: 3, notify: true, nextStep: 'Abrir o Discover em logs-technical*.otel-prd e filtrar severity_text: ERROR, ou rodar o comando jornada com um correlationId.' },
};

export type DetectorStateEntry = {
  status: 'OK' | 'FIRING';
  consecutiveBad: number;
  consecutiveGood: number;
  firingSince?: string;
  lastNotifiedAt?: string;
  lastDetail?: string;
};

/** Startup wait for the Elastic endpoint (network/Tailscale not up yet after boot). */
export type WaitingState = {
  status: 'aguardando rede' | 'pronto' | 'desistiu (janela pós-boot encerrada)';
  since: string;
  attempts: number;
  lastAttemptAt: string;
  lastDetail: string;
};

export type WatchState = {
  detectors: Partial<Record<DetectorId, DetectorStateEntry>>;
  lastReleaseSha?: string;
  lastDigestDate?: string;
  startedAt?: string;
  waiting?: WaitingState;
  cyclesSinceDigest: number;
  cyclesSkippedSinceDigest: number;
  firingsSinceDigest: Record<Severity, number>;
};

/** Technical context only: counts, route templates and technical ids. Never personal data. */
export type ErrorContext = { routes: Array<{ route: string; count: number }>; correlationIds: string[] };

export type Observation = { id: DetectorId; bad: boolean; detail: string; context?: ErrorContext };
