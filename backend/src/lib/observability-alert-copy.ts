import type { KibanaAlertPayload } from './kibana-alert-email.js';

export type AlertSeverity = 'critical' | 'high' | 'medium';

export type AlertCopy = {
  title: string;
  severity: AlertSeverity;
  category: 'app' | 'infra' | 'slo';
  summary: string;
  impact: string;
  actions: string[];
};

const DEFAULT_COPY: AlertCopy = {
  title: 'Alerta de observabilidade',
  severity: 'medium',
  category: 'app',
  summary: 'O monitoramento detectou uma condicao fora do normal.',
  impact: 'Pode afetar o uso do Quiver Tap ate a causa ser verificada.',
  actions: [
    'Abra o ops-panel (npm run ops:open) e confira o status de producao.',
    'No Kibana (Discover), filtre service.name e log.level=error na janela do alerta.',
  ],
};

const RULE_COPY: Record<string, AlertCopy> = {
  'quiver-tap-5xx-rate-prd': {
    title: 'Erros no servidor (producao)',
    severity: 'critical',
    category: 'app',
    summary:
      'A API de producao respondeu com erro 5xx (falha interna) mais vezes do que o limite em 15 minutos.',
    impact:
      'Operacoes podem falhar para a equipe e clientes: comandas, pagamentos, ranking e operacao.',
    actions: [
      'Abra o ops-panel (npm run ops:open) e confira se a API de producao esta no ar.',
      'No Kibana, filtre service.name=quiver-tap-api e log.level=error e veja o erro mais recente.',
      'Se comecou apos um deploy, avalie rollback no ops-panel.',
    ],
  },
  'quiver-tap-ui-error-prd': {
    title: 'Erro de tela no app (producao)',
    severity: 'high',
    category: 'app',
    summary:
      'O frontend registrou erro de interface (ui.error) — algo quebrou na experiencia do usuario.',
    impact:
      'Usuarios podem ver tela em branco, acao que nao responde ou mensagem de erro no navegador.',
    actions: [
      'Pergunte qual pagina e acao estavam em uso quando o erro ocorreu.',
      'No Kibana, filtre por ui.error e veja a rota e a mensagem.',
      'Se for apos deploy, confira o console do navegador e o manifest do frontend.',
    ],
  },
  'quiver-tap-transacao-failure-prd': {
    title: 'Falha em operacao de negocio',
    severity: 'critical',
    category: 'app',
    summary:
      'Uma acao importante (fechar comanda, pagamento, estoque, etc.) falhou de forma registrada como transacao.',
    impact:
      'Dados podem ficar inconsistentes ou a operacao nao concluir para o cliente.',
    actions: [
      'Identifique qual operacao falhou no motivo tecnico abaixo.',
      'Verifique no app se a comanda/pedido ficou em estado estranho.',
      'Consulte os logs de auditoria no Kibana pela acao (event.action).',
    ],
  },
  'quiver-tap-401-surge-prd': {
    title: 'Pico de acesso nao autorizado',
    severity: 'medium',
    category: 'app',
    summary:
      'Muitas respostas HTTP 401 em pouco tempo — sessoes expiradas ou tentativas de acesso invalido.',
    impact:
      'Usuarios podem precisar fazer login de novo; nao indica necessariamente ataque.',
    actions: [
      'Confirme se houve deploy ou reinicio da API (invalida sessoes antigas).',
      'Se persistir, verifique relatorios de IP e rotas no Kibana.',
    ],
  },
  'quiver-tap-api-ready-down-prd': {
    title: 'API de producao fora do ar',
    severity: 'critical',
    category: 'infra',
    summary:
      'O health check /api/ready na porta 3001 nao respondeu OK por pelo menos 3 minutos.',
    impact:
      'O Quiver Tap em producao fica indisponivel — ninguem consegue usar o sistema.',
    actions: [
      'Abra o ops-panel (npm run ops:open) e confira o estado de producao.',
      'No VPS (via Tailscale): docker ps e docker logs --tail 200 cervejaria-api.',
      'Se nao voltar sozinha, docker restart cervejaria-api; se comecou apos deploy, rollback pelo ops-panel.',
    ],
  },
  'quiver-tap-public-ready-down-prd': {
    title: 'Site publico inacessivel',
    severity: 'critical',
    category: 'infra',
    summary:
      'O endereco publico (tap.quivercloud.com.br) nao respondeu como esperado no monitoramento.',
    impact:
      'Clientes e equipe nao conseguem abrir o app pela internet.',
    actions: [
      'Se o alerta de API (porta 3001) tambem disparou, o problema e a aplicacao; senao, e nginx ou Cloudflare.',
      'No VPS (via Tailscale): systemctl status nginx e curl http://127.0.0.1:3001/api/ready.',
      'Confira o status da Cloudflare e se a faixa de IP da borda continua liberada no firewall da Hostinger.',
    ],
  },
  'quiver-tap-public-ready-down-dev': {
    title: 'Ambiente de desenvolvimento inacessivel',
    severity: 'medium',
    category: 'infra',
    summary: 'O monitoramento nao conseguiu validar o ambiente de desenvolvimento.',
    impact: 'Afeta testes locais e tapdev — nao impacta clientes em producao.',
    actions: ['Rode npm run dev:status e reinicie com npm run dev:start se necessario.'],
  },
  'quiver-tap-postgres-tcp-down-prd': {
    title: 'Banco de dados de producao inacessivel',
    severity: 'critical',
    category: 'infra',
    summary: 'O PostgreSQL de producao nao aceitou conexao TCP no monitoramento.',
    impact: 'A API nao consegue ler nem gravar dados — o sistema para de funcionar.',
    actions: [
      'Verifique se o container cervejaria-db esta rodando (docker ps).',
      'No VPS: docker logs --tail 200 cervejaria-db; no Kibana, erros de conexao Prisma da API.',
      'Nao faca deploy ate o banco voltar.',
    ],
  },
  'quiver-tap-postgres-tcp-down-dev': {
    title: 'Banco de desenvolvimento inacessivel',
    severity: 'high',
    category: 'infra',
    summary: 'O PostgreSQL de desenvolvimento nao respondeu no monitoramento.',
    impact: 'Desenvolvimento e testes locais ficam bloqueados.',
    actions: ['Suba o Docker do banco dev e rode npm run dev:status.'],
  },
  'quiver-tap-es-cluster-not-green': {
    title: 'Elasticsearch com problema',
    severity: 'high',
    category: 'infra',
    summary:
      'O cluster Elasticsearch nao esta verde — indices podem estar amarelos ou vermelhos.',
    impact:
      'Logs, metricas e alertas podem atrasar ou falhar; o app pode continuar rodando.',
    actions: [
      'Rode npm run obs:kibana e confira saude do cluster.',
      'Em single-node, npm run obs:fix-es-replicas pode resolver replicas.',
    ],
  },
  'quiver-tap-telemetry-gap-prd': {
    title: 'Lacuna de telemetria (producao)',
    severity: 'medium',
    category: 'infra',
    summary:
      'Parou de chegar telemetria da API de producao no Elasticsearch por um periodo.',
    impact:
      'Alertas e dashboards podem ficar cegos; o app pode estar no ar sem monitoramento.',
    actions: [
      'No VPS: docker ps (cervejaria-api e quiver-edot-collector-prd devem estar Up).',
      'docker logs --tail 200 quiver-edot-collector-prd para falhas de exportacao ao Elasticsearch.',
    ],
  },
  'quiver-tap-telemetry-gap-dev': {
    title: 'Lacuna de telemetria (desenvolvimento)',
    severity: 'medium',
    category: 'infra',
    summary: 'Telemetria do ambiente dev parou de chegar ao Elasticsearch.',
    impact: 'Afeta apenas observabilidade de dev, nao clientes.',
    actions: ['Reinicie dev e o collector com npm run dev:start e npm run obs:up.'],
  },
  'quiver-tap-eventloop-high-prd': {
    title: 'API lenta (event loop saturado)',
    severity: 'high',
    category: 'infra',
    summary:
      'O Node.js ficou com o event loop ocupado demais — a API pode travar ou responder devagar.',
    impact: 'Telas demoram, timeouts e erros 5xx podem aparecer em cascata.',
    actions: [
      'Veja metricas de CPU e event loop no dashboard de infra no Kibana.',
      'Se nao houver deploy recente, considere docker restart cervejaria-api no VPS.',
    ],
  },
  'quiver-tap-eventloop-high-dev': {
    title: 'API dev lenta (event loop)',
    severity: 'medium',
    category: 'infra',
    summary: 'Event loop alto no ambiente de desenvolvimento.',
    impact: 'Desenvolvimento fica lento; nao afeta producao.',
    actions: ['Reinicie o dev e investigue queries ou loops no codigo em teste.'],
  },
  'quiver-tap-disk-high-prd': {
    title: 'Disco do servidor quase cheio',
    severity: 'high',
    category: 'infra',
    summary: 'O uso de disco do VPS de producao passou do limite configurado.',
    impact: 'Banco, backups e logs podem parar de gravar; a API pode falhar.',
    actions: [
      'No VPS: df -h e docker system df para ver o que cresceu.',
      'Confira backups locais antigos e a retencao dos indices no Elasticsearch.',
    ],
  },
  'quiver-tap-container-restart-prd': {
    title: 'Container reiniciou ou ficou doente',
    severity: 'high',
    category: 'infra',
    summary: 'Um container do VPS reiniciou, foi morto por falta de memoria, ficou unhealthy ou parou.',
    impact: 'O servico afetado pode ter ficado fora do ar por alguns segundos ou continuar fora.',
    actions: [
      'No VPS: docker ps -a e docker logs --tail 200 do container citado no motivo.',
      'Se foi OOM, confira memoria do host (free -h) e limites do container.',
    ],
  },
  'quiver-tap-nginx-5xx-surge-prd': {
    title: 'Pico de erros 5xx no nginx',
    severity: 'high',
    category: 'infra',
    summary: 'O nginx do VPS devolveu muitas respostas 5xx em pouco tempo.',
    impact: 'Usuarios podem ver erro 502/504 ao abrir o app.',
    actions: [
      'Veja se a API respondeu (alerta de API na porta 3001) e docker logs cervejaria-api.',
      'No Kibana, filtre logs-nginx_access por http.response.status_code >= 500.',
    ],
  },
  'quiver-tap-ssh-bruteforce-prd': {
    title: 'Tentativas de invasao por SSH',
    severity: 'high',
    category: 'infra',
    summary: 'Muitas tentativas de login SSH falharam no VPS.',
    impact: 'Indica varredura ou ataque; o SSH publico deveria estar fechado no firewall.',
    actions: [
      'Confirme no painel da Hostinger que a porta 22 segue fechada para a internet.',
      'No Kibana, veja source.address nos logs ssh_auth.',
    ],
  },
  'quiver-tap-ssh-login-prd': {
    title: 'Login SSH no servidor de producao',
    severity: 'medium',
    category: 'infra',
    summary: 'Alguem entrou no VPS por SSH.',
    impact: 'Esperado se foi voce (via Tailscale); inesperado indica acesso indevido.',
    actions: ['Se nao foi voce, troque as chaves SSH e revise o Tailscale imediatamente.'],
  },
  'quiver-tap-backup-failed-prd': {
    title: 'Backup do banco falhou',
    severity: 'critical',
    category: 'infra',
    summary: 'O backup diario do PostgreSQL de producao terminou com erro.',
    impact: 'Sem backup recente, uma perda de dados nao teria como ser recuperada ate o ultimo dump bom.',
    actions: [
      'No VPS: tail -n 50 /opt/quiver-tap/backups/logs/backup-postgres.log.',
      'Rode o backup manualmente (deploy/tap-quiver/backup-postgres.sh) depois de corrigir a causa.',
    ],
  },
  'quiver-tap-backup-missing-prd': {
    title: 'Backup do banco nao rodou',
    severity: 'critical',
    category: 'infra',
    summary: 'Nenhum backup do PostgreSQL de producao terminou com sucesso nas ultimas 26 horas.',
    impact: 'O cron pode ter parado; a protecao contra perda de dados esta vencendo.',
    actions: [
      'No VPS: confira /etc/cron.d e o log do backup em /opt/quiver-tap/backups/logs.',
      'Rode o backup manualmente e confirme a copia off-site.',
    ],
  },
  'quiver-tap-api-latency-p95-prd': {
    title: 'API lenta (producao)',
    severity: 'high',
    category: 'app',
    summary:
      'O p95 das requisicoes da API passou de 1 segundo nos ultimos 15 minutos (normal: abaixo de 60 ms).',
    impact: 'Caixa, comandas e cozinha respondem devagar; a equipe sente travamento no atendimento.',
    actions: [
      'Abra o ops-panel (npm run ops:open) e confira CPU, memoria e disco do VPS.',
      'No Kibana, abra traces-*.otel-prd ordenado por duration e veja quais url.path estao lentos.',
      'Se comecou apos um deploy, avalie rollback no ops-panel.',
    ],
  },
  'quiver-tap-analyst-heartbeat-missing-prd': {
    title: 'Analista local sem sinal',
    severity: 'medium',
    category: 'infra',
    summary: 'O Support Analyst do PC nao manda batimento ha mais de 15 minutos.',
    impact:
      'A camada local de vigilancia esta fora (PC desligado, sem internet ou analista parado); Kibana e o monitor externo seguem ativos.',
    actions: [
      'Se o PC esta ligado: confira a tarefa QuiverTap-SupportAnalyst-Watch-PRD no Agendador de Tarefas.',
      'Veja o log do dia em deploy/runtime/support-analyst-prd/logs.',
    ],
  },
  'quiver-tap-slo-availability-burn-prd': {
    title: 'Meta de disponibilidade em risco (SLO)',
    severity: 'high',
    category: 'slo',
    summary:
      'A taxa de erro esta consumindo o orcamento de disponibilidade mais rapido que o normal.',
    impact:
      'Indicador de saude geral — pode preceder indisponibilidade se nao for tratado.',
    actions: [
      'Abra o dashboard SLO no Kibana e veja qual servico puxou o burn rate.',
      'Priorize alertas especificos (5xx, API down) que dispararam na mesma janela.',
    ],
  },
  'quiver-tap-slo-transacao-failure-rate-prd': {
    title: 'Meta de transacoes em risco (SLO)',
    severity: 'high',
    category: 'slo',
    summary: 'Falhas de transacao de negocio estao acima do aceitavel na janela do SLO.',
    impact: 'Operacoes criticas (pagamento, fechamento) podem estar falhando com frequencia.',
    actions: [
      'Confira o alerta quiver-tap-transacao-failure-prd para detalhes acionaveis.',
      'Revise comandas recentes com erro no app.',
    ],
  },
  'quiver-tap-slo-cozinha-slow-prd': {
    title: 'Cozinha lenta (SLO)',
    severity: 'medium',
    category: 'slo',
    summary: 'Pedidos estao demorando mais que o esperado para sair da fila da cozinha.',
    impact: 'Clientes esperam mais; operacao do operacao fica prejudicada.',
    actions: [
      'Confira a tela de cozinha e fila de pedidos no operacao.',
      'Verifique se ha pico de pedidos ou problema de rede no local.',
    ],
  },
};

function normalizeRuleName(ruleName?: string): string | undefined {
  if (!ruleName?.trim()) return undefined;
  return ruleName.trim().toLowerCase();
}

const OPERATIONAL_RULE_KEYS = new Set([
  'quiver-tap-transacao-failure-prd',
  'quiver-tap-transacao-failure-dev',
  'quiver-tap-ui-error-prd',
  'quiver-tap-ui-error-dev',
  'quiver-tap-5xx-rate-prd',
  'quiver-tap-5xx-rate-dev',
]);

/** Alertas de negocio (empresa, usuario, operacao) vs infra/SLO comuns a todas as empresas. */
export function isOperationalAlertRule(ruleName?: string): boolean {
  const key = normalizeRuleName(ruleName);
  if (!key) return false;
  if (OPERATIONAL_RULE_KEYS.has(key)) return true;
  return (
    key.includes('transacao-failure') ||
    key.includes('ui-error') ||
    key.includes('5xx-rate')
  );
}

export function isInfraAlertRule(ruleName?: string): boolean {
  const copy = resolveAlertCopy(ruleName);
  return copy.category === 'infra' || copy.category === 'slo';
}

export function resolveAlertCopy(ruleName?: string): AlertCopy {
  const key = normalizeRuleName(ruleName);
  if (!key) return DEFAULT_COPY;
  return RULE_COPY[key] ?? {
    ...DEFAULT_COPY,
    title: humanizeRuleId(key),
  };
}

function humanizeRuleId(ruleId: string): string {
  const withoutPrefix = ruleId.replace(/^quiver-tap-/, '').replace(/-/g, ' ');
  return withoutPrefix.charAt(0).toUpperCase() + withoutPrefix.slice(1);
}

export function resolveEnvironmentLabel(ruleName?: string): string {
  const key = normalizeRuleName(ruleName) ?? '';
  if (key.includes('-prd') || key.includes('prod')) return 'Producao';
  if (key.includes('-dev')) return 'Desenvolvimento';
  return 'Ambiente nao identificado';
}

export function formatAlertStateLabel(alertState?: string): {
  label: string;
  isRecovered: boolean;
  headlinePrefix: string;
} {
  const raw = (alertState ?? 'active').trim().toLowerCase();
  if (raw === 'recovered' || raw === 'ok' || raw === 'resolved') {
    return {
      label: 'Recuperado — voltou ao normal',
      isRecovered: true,
      headlinePrefix: 'OK',
    };
  }
  if (raw === 'active' || raw === 'alert' || raw === 'firing') {
    return {
      label: 'Ativo — problema em andamento',
      isRecovered: false,
      headlinePrefix: 'ALERTA',
    };
  }
  return {
    label: raw,
    isRecovered: false,
    headlinePrefix: 'ALERTA',
  };
}

function severityEmoji(severity: AlertSeverity, isRecovered: boolean): string {
  if (isRecovered) return '✅';
  if (severity === 'critical') return '🚨';
  if (severity === 'high') return '⚠️';
  return 'ℹ️';
}

function pickTimestamp(payload: KibanaAlertPayload): string | undefined {
  const raw = payload.raw;
  if (!raw || typeof raw !== 'object') return undefined;
  const ts = (raw as Record<string, unknown>)['@timestamp'];
  return typeof ts === 'string' && ts.trim() ? ts.trim() : undefined;
}

function formatTimestampBr(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function buildObservabilityAlertSections(payload: KibanaAlertPayload): {
  headline: string;
  stateLabel: string;
  environment: string;
  summary: string;
  impact: string;
  actions: string[];
  technicalReason?: string;
  ruleId?: string;
  timestampBr?: string;
  viewInAppUrl?: string;
  isRecovered: boolean;
} {
  const copy = resolveAlertCopy(payload.ruleName);
  const state = formatAlertStateLabel(payload.alertState);
  const emoji = severityEmoji(copy.severity, state.isRecovered);
  const env = resolveEnvironmentLabel(payload.ruleName);

  const headline = state.isRecovered
    ? `${emoji} ${state.headlinePrefix} — ${copy.title}`
    : `${emoji} ${state.headlinePrefix} — ${copy.title}`;

  const technicalReason = payload.reason?.trim() || undefined;
  const recoveredSummary = state.isRecovered
    ? 'O monitoramento indica que a condicao normalizou. Vale conferir se tudo voltou ao esperado.'
    : copy.summary;

  const recoveredActions = state.isRecovered
    ? ['Nenhuma acao urgente. Opcional: confira o dashboard no Kibana para confirmar estabilidade.']
    : copy.actions;

  return {
    headline,
    stateLabel: state.label,
    environment: env,
    summary: recoveredSummary,
    impact: state.isRecovered
      ? 'O impacto deve ter cessado. Monitore por alguns minutos.'
      : copy.impact,
    actions: recoveredActions,
    technicalReason,
    ruleId: payload.ruleName,
    timestampBr: formatTimestampBr(pickTimestamp(payload)),
    viewInAppUrl: payload.viewInAppUrl?.trim() || undefined,
    isRecovered: state.isRecovered,
  };
}
