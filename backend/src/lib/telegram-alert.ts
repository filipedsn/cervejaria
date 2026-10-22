import type { KibanaAlertPayload } from './kibana-alert-email.js';
import { formatObservabilityAlertTelegramText } from './observability-alert-format.js';

export type ObservabilityAlertMessage = KibanaAlertPayload;

export function isTelegramAlertConfigured(): boolean {
  return Boolean(
    process.env.OBS_ALERT_TELEGRAM_BOT_TOKEN?.trim() &&
      process.env.OBS_ALERT_TELEGRAM_CHAT_ID?.trim(),
  );
}

export { formatObservabilityAlertTelegramText };

export async function sendObservabilityAlertTelegram(
  alert: ObservabilityAlertMessage,
): Promise<void> {
  const token = process.env.OBS_ALERT_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.OBS_ALERT_TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) {
    throw new Error('OBS_ALERT_TELEGRAM_BOT_TOKEN ou OBS_ALERT_TELEGRAM_CHAT_ID não configurado');
  }

  const text = formatObservabilityAlertTelegramText(alert);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
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
