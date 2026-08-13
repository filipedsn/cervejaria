const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_MESSAGE_CHARS = 4000;

export type ObservabilityAlertMessage = {
  ruleName?: string;
  alertState?: string;
  reason?: string;
  viewInAppUrl?: string;
};

export function isTelegramAlertConfigured(): boolean {
  return Boolean(
    process.env.OBS_ALERT_TELEGRAM_BOT_TOKEN?.trim() &&
      process.env.OBS_ALERT_TELEGRAM_CHAT_ID?.trim(),
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatObservabilityAlertTelegramText(alert: ObservabilityAlertMessage): string {
  const ruleName = alert.ruleName ?? 'Alerta Quiver Tap';
  const state = alert.alertState ?? 'disparado';
  const reason = alert.reason ?? 'Sem detalhes adicionais.';
  const link = alert.viewInAppUrl;

  const lines = [
    `<b>Quiver Tap — ${escapeHtml(ruleName)}</b>`,
    `Estado: ${escapeHtml(state)}`,
    `Motivo: ${escapeHtml(reason)}`,
  ];
  if (link) lines.push(`<a href="${escapeHtml(link)}">Abrir no Kibana</a>`);

  let text = lines.join('\n');
  if (text.length > MAX_MESSAGE_CHARS) {
    text = `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…`;
  }
  return text;
}

export async function sendObservabilityAlertTelegram(
  alert: ObservabilityAlertMessage,
): Promise<void> {
  const token = process.env.OBS_ALERT_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.OBS_ALERT_TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) {
    throw new Error('OBS_ALERT_TELEGRAM_BOT_TOKEN ou OBS_ALERT_TELEGRAM_CHAT_ID não configurado');
  }

  const text = formatObservabilityAlertTelegramText(alert);
  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  const body = (await res.json()) as { ok?: boolean; description?: string };
  if (!res.ok || !body.ok) {
    throw new Error(`Telegram API: ${body.description ?? `HTTP ${res.status}`}`);
  }
}
