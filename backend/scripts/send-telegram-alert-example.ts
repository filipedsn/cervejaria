import { sendObservabilityAlertTelegram } from '../src/lib/telegram-alert.js';

const examples = {
  operacional: {
    ruleName: 'quiver-tap-transacao-failure-prd',
    alertState: 'active',
    reason: 'Falha ao fechar comanda',
    viewInAppUrl: 'http://127.0.0.1:5601/app/observability/alerts',
    context: {
      empresa: 'CIA Maritima',
      usuario: 'Filipe (filipe@example.com)',
      operacao: 'Fechar comanda',
      errorDescription: 'Falha ao registrar pagamento — timeout no banco',
      technicalDetails: [
        'Acao tecnica: transacao.comanda_fechada',
        'HTTP: POST /api/comandas/fechar status 500',
        'Trace ID: abc123def456',
        'comandaId: cmd_01',
        'Stack trace:\nError: timeout\n    at fecharComanda (...)',
      ],
    },
    raw: { '@timestamp': new Date().toISOString() },
  },
  infra: {
    ruleName: 'quiver-tap-api-ready-down-prd',
    alertState: 'active',
    reason: 'Health check /api/ready falhou 3 vezes consecutivas.',
    viewInAppUrl: 'http://127.0.0.1:5601/app/observability/alerts',
    raw: { '@timestamp': new Date().toISOString() },
  },
  recovered: {
    ruleName: 'quiver-tap-api-ready-down-prd',
    alertState: 'recovered',
    reason: 'Health check /api/ready voltou a responder 200.',
    viewInAppUrl: 'http://127.0.0.1:5601/app/observability/alerts',
    raw: { '@timestamp': new Date().toISOString() },
  },
} as const;

const which = (process.argv[2] ?? 'operacional') as keyof typeof examples;
const payload = examples[which] ?? examples.operacional;

await sendObservabilityAlertTelegram(payload);
console.log(`Exemplo "${which}" enviado ao Telegram.`);
