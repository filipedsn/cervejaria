import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isClientError, isFailure, isServerFailure, parseLogEvent } from './enrich.js';
import {
  RULE_ALLOWLIST,
  RULE_INFRA,
  buildDossier,
  classify,
  fingerprint,
  firstOwnFrame,
  isActionable,
  routeToFiles,
  suspectFiles,
} from './triage.js';
import type { Alert, Evidence, LogEvent } from './types.js';

/** Todas as regras Kibana versionadas em deploy/observability/kibana-alert-*.json. */
const REGRAS_EXISTENTES = [
  'quiver-tap-5xx-rate-prd',
  'quiver-tap-401-surge-prd',
  'quiver-tap-api-down',
  'quiver-tap-api-down-prd',
  'quiver-tap-api-ready-down-prd',
  'quiver-tap-es-cluster-not-green',
  'quiver-tap-eventloop-high',
  'quiver-tap-eventloop-high-dev',
  'quiver-tap-eventloop-high-prd',
  'quiver-tap-postgres-tcp-down-dev',
  'quiver-tap-postgres-tcp-down-prd',
  'quiver-tap-public-ready-down-dev',
  'quiver-tap-public-ready-down-prd',
  'quiver-tap-slo-availability-burn-prd',
  'quiver-tap-slo-cozinha-slow-prd',
  'quiver-tap-slo-transacao-failure-rate-prd',
  'quiver-tap-telemetry-gap-dev',
  'quiver-tap-telemetry-gap-prd',
  'quiver-tap-transacao-failure-prd',
  'quiver-tap-ui-error-prd',
];

function alerta(ruleName: string): Alert {
  return {
    id: 'abc123',
    ruleName,
    alertState: 'active',
    reason: 'taxa de erro acima do limite',
    viewInAppUrl: 'http://127.0.0.1:5601/app/observability/alerts/1',
    timestamp: '2026-08-11T22:00:00.000Z',
  };
}

/** Todo caminho existe, para os testes de triagem nao dependerem do disco. */
const tudoExiste = () => true;

function evidencia(overrides: Partial<Evidence> = {}): Evidence {
  return {
    failures: [],
    serverFailureCount: 0,
    clientErrorCount: 0,
    byRoute: [],
    byTenant: [],
    byAction: [],
    totalInWindow: 0,
    windowFrom: '2026-08-11T21:50:00.000Z',
    windowTo: '2026-08-11T22:02:00.000Z',
    ...overrides,
  };
}

function falha(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: '2026-08-11T21:59:00.000Z',
    severity: 'error',
    message: 'Falhou ao fechar comanda',
    eventAction: 'comanda.fechar',
    eventOutcome: 'failure',
    httpRoute: '/api/comandas/:id/fechar',
    httpStatus: 500,
    ...overrides,
  };
}

test('toda regra Kibana existente esta classificada', () => {
  for (const rule of REGRAS_EXISTENTES) {
    const decision = classify(alerta(rule));
    assert.notEqual(
      decision.kind,
      'desconhecido',
      `${rule} nao esta em RULE_ALLOWLIST nem RULE_INFRA`,
    );
  }
});

test('allowlist e infra nao se sobrepoem', () => {
  for (const rule of RULE_ALLOWLIST) {
    assert.equal(RULE_INFRA.includes(rule), false, `${rule} esta nas duas listas`);
  }
});

test('regra desconhecida nao e tratada como codigo', () => {
  const decision = classify(alerta('quiver-tap-regra-nova-prd'));
  assert.equal(decision.kind, 'desconhecido');
});

test('alerta de infra nunca e acionavel', () => {
  const dossier = buildDossier(alerta('quiver-tap-postgres-tcp-down-prd'), evidencia(), tudoExiste);
  assert.equal(isActionable(dossier).ok, false);
});

test('firstOwnFrame ignora node_modules e runtime interno', () => {
  const stack = [
    'Error: comanda sem itens',
    '    at node:internal/process/task_queues (node:internal/x:1:1)',
    '    at Object.handler (C:\\app\\node_modules\\fastify\\lib\\route.js:10:5)',
    '    at fecharComanda (C:\\app\\backend\\src\\lib\\fechar-comanda.ts:142:11)',
    '    at rota (C:\\app\\backend\\src\\routes\\comandas.ts:88:3)',
  ].join('\n');
  assert.equal(firstOwnFrame(stack), 'C:\\app\\backend\\src\\lib\\fechar-comanda.ts:142');
});

test('firstOwnFrame retorna undefined sem stack', () => {
  assert.equal(firstOwnFrame(undefined), undefined);
  assert.equal(firstOwnFrame('sem frames aqui'), undefined);
});

test('fingerprint e estavel e independente do caminho absoluto', () => {
  const stackWindows =
    'Error: x\n    at f (C:\\Users\\Papai\\proj\\backend\\src\\lib\\fechar-comanda.ts:142:11)';
  const stackLinux = 'Error: x\n    at f (/home/runner/proj/backend/src/lib/fechar-comanda.ts:142:11)';

  const a = fingerprint(
    alerta('quiver-tap-5xx-rate-prd'),
    evidencia({ stack: stackWindows, failures: [falha()], serverFailureCount: 1 }),
  );
  const b = fingerprint(
    alerta('quiver-tap-5xx-rate-prd'),
    evidencia({ stack: stackLinux, failures: [falha()], serverFailureCount: 1 }),
  );
  assert.equal(a, b);
  assert.match(a, /^quiver-tap-5xx-rate-prd:[0-9a-f]{12}$/);
});

test('fingerprint separa bugs diferentes na mesma regra', () => {
  const rule = alerta('quiver-tap-5xx-rate-prd');
  const a = fingerprint(rule, evidencia({ byAction: [{ action: 'comanda.fechar', count: 3 }] }));
  const b = fingerprint(rule, evidencia({ byAction: [{ action: 'caixa.abrir', count: 3 }] }));
  assert.notEqual(a, b);
});

test('routeToFiles cobre rota simples e aninhada', () => {
  assert.deepEqual(routeToFiles('/api/comandas'), [
    'backend/src/routes/comandas.ts',
    'backend/src/lib/comandas.ts',
  ]);
  assert.deepEqual(routeToFiles('/api/quiosque/caixa'), [
    'backend/src/routes/quiosque/caixa.ts',
    'backend/src/lib/quiosque/caixa.ts',
    'backend/src/routes/quiosque.ts',
    'backend/src/lib/quiosque.ts',
  ]);
});

test('routeToFiles descarta parametros de rota', () => {
  const files = routeToFiles('/api/comandas/:id/fechar');
  assert.equal(files.includes('backend/src/routes/comandas/fechar.ts'), true);
  assert.equal(
    files.some((f) => f.includes(':id')),
    false,
  );
});

test('suspectFiles prioriza o frame do stack', () => {
  const stack = 'Error: x\n    at f (C:\\app\\backend\\src\\lib\\fechar-comanda.ts:142:11)';
  const suspects = suspectFiles(
    evidencia({ stack, byRoute: [{ route: '/api/comandas', count: 4 }] }),
    tudoExiste,
  );
  assert.equal(suspects[0]?.path, 'backend/src/lib/fechar-comanda.ts');
  assert.match(suspects[0]?.why ?? '', /stack/);
});

test('suspectFiles descarta candidatos que nao existem no repositorio', () => {
  const existeApenasRota = (p: string) => p === 'backend/src/routes/auth.ts';
  const suspects = suspectFiles(
    evidencia({ byRoute: [{ route: '/api/auth/login', count: 3 }] }),
    existeApenasRota,
  );
  assert.deepEqual(
    suspects.map((s) => s.path),
    ['backend/src/routes/auth.ts'],
  );
});

test('suspectFiles mantem o frame do stack mesmo sem checar disco', () => {
  const stack = 'Error: x\n    at f (C:\\app\\backend\\src\\lib\\caixa.ts:10:1)';
  const suspects = suspectFiles(evidencia({ stack }), () => false);
  assert.deepEqual(
    suspects.map((s) => s.path),
    ['backend/src/lib/caixa.ts'],
  );
});

test('dossie sem stack e sem rota nao e acionavel', () => {
  const dossier = buildDossier(
    alerta('quiver-tap-5xx-rate-prd'),
    evidencia({
      failures: [falha({ httpRoute: undefined, httpStatus: undefined, severity: 'error' })],
      serverFailureCount: 1,
    }),
    tudoExiste,
  );
  const verdict = isActionable(dossier);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason ?? '', /adivinhar/);
});

test('dossie com rota e falha de servidor e acionavel', () => {
  const dossier = buildDossier(
    alerta('quiver-tap-5xx-rate-prd'),
    evidencia({
      failures: [falha()],
      serverFailureCount: 1,
      byRoute: [{ route: '/api/comandas', count: 4 }],
    }),
    tudoExiste,
  );
  assert.equal(isActionable(dossier).ok, true);
});

test('dossie so com 4xx nao e acionavel', () => {
  const dossier = buildDossier(
    alerta('quiver-tap-5xx-rate-prd'),
    evidencia({
      failures: [falha({ httpStatus: 401, httpRoute: '/api/auth/me' })],
      serverFailureCount: 0,
      clientErrorCount: 1,
      gap: '1 erro(s) 4xx na janela e nenhuma falha de servidor.',
    }),
    tudoExiste,
  );
  const verdict = isActionable(dossier);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason ?? '', /4xx/);
});

test('parseLogEvent le atributos achatados e timestamp em epoch millis', () => {
  const event = parseLogEvent({
    '@timestamp': '1786491307718.0',
    trace_id: 'bd442ae8dafaf7d80e7e0ad3e2bd526c',
    severity_text: 'info',
    resource: { attributes: { 'service.name': 'quiver-tap-api' } },
    data_stream: { dataset: 'audit_cia_maritima.otel', namespace: 'prd' },
    attributes: {
      'event.action': 'http.get',
      'event.outcome': 'success',
      'http.route': '/api/eventos',
      'http.response.status_code': 200,
      'cervejaria.slug': 'cia-maritima',
      message: 'Consultou /api/eventos',
    },
  });

  assert.equal(event.timestamp, new Date(1786491307718).toISOString());
  assert.equal(event.eventAction, 'http.get');
  assert.equal(event.httpRoute, '/api/eventos');
  assert.equal(event.httpStatus, 200);
  assert.equal(event.cervejariaSlug, 'cia-maritima');
  assert.equal(event.serviceName, 'quiver-tap-api');
  assert.equal(event.severity, 'info');
  assert.equal(isFailure(event), false);
});

test('parseLogEvent le atributos aninhados', () => {
  const event = parseLogEvent({
    '@timestamp': '2026-08-11T22:00:00.000Z',
    severity_text: 'ERROR',
    attributes: {
      event: { action: 'comanda.fechar', outcome: 'failure' },
      http: { route: '/api/comandas', response: { status_code: 500 } },
    },
  });

  assert.equal(event.eventAction, 'comanda.fechar');
  assert.equal(event.eventOutcome, 'failure');
  assert.equal(event.httpRoute, '/api/comandas');
  assert.equal(event.httpStatus, 500);
  assert.equal(isFailure(event), true);
});

test('isFailure reconhece as tres marcas de erro isoladamente', () => {
  assert.equal(isFailure(falha({ eventOutcome: 'failure', severity: 'info', httpStatus: 200 })), true);
  assert.equal(isFailure(falha({ eventOutcome: 'success', severity: 'error', httpStatus: 200 })), true);
  assert.equal(isFailure(falha({ eventOutcome: 'success', severity: 'info', httpStatus: 503 })), true);
  assert.equal(isFailure(falha({ eventOutcome: 'success', severity: 'info', httpStatus: 200 })), false);
});

test('401 em rota de sessao e falha de auditoria mas nao falha de servidor', () => {
  const naoAutorizado = falha({
    httpStatus: 401,
    httpRoute: '/api/auth/me',
    eventOutcome: 'failure',
    severity: 'info',
  });
  assert.equal(isFailure(naoAutorizado), true);
  assert.equal(isClientError(naoAutorizado), true);
  assert.equal(isServerFailure(naoAutorizado), false);
});

test('500 e falha de servidor mesmo com severity info', () => {
  const erro500 = falha({ httpStatus: 500, severity: 'info', eventOutcome: 'failure' });
  assert.equal(isServerFailure(erro500), true);
  assert.equal(isClientError(erro500), false);
});

test('falha sem status HTTP conta como servidor (erro de banco, por exemplo)', () => {
  const erroDb = falha({
    httpStatus: undefined,
    httpRoute: undefined,
    eventAction: 'db.findunique',
    eventOutcome: 'failure',
    severity: 'info',
  });
  assert.equal(isServerFailure(erroDb), true);
});
