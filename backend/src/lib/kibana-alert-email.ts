import { sendObservabilityAlertEmail } from './email.js';
import { enrichAlertContext } from './observability-alert-enrich.js';
import type { AlertEnrichedContext } from './observability-alert-enrich.js';
import { isTelegramAlertConfigured, sendObservabilityAlertTelegram } from './telegram-alert.js';

export type KibanaAlertPayload = {
  ruleName?: string;
  alertState?: string;
  reason?: string;
  viewInAppUrl?: string;
  raw?: unknown;
  context?: AlertEnrichedContext;
};

export type AlertNotifyResult = {
  sent: boolean;
  deduped?: boolean;
  channels?: { email?: boolean; telegram?: boolean };
};

export function isAlertNotifyConfigured(): boolean {
  const emailTo = process.env.OBS_ALERT_EMAIL_TO?.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  return Boolean(emailTo?.length) || isTelegramAlertConfigured();
}

const recentAlerts = new Map<string, number>();
const DEDUP_MS = 5 * 60 * 1000;

function pickString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

export function parseKibanaAlertPayload(body: unknown): KibanaAlertPayload {
  if (!body || typeof body !== 'object') {
    return { raw: body };
  }

  const o = body as Record<string, unknown>;
  const rule = (o.rule && typeof o.rule === 'object' ? o.rule : {}) as Record<string, unknown>;
  const context = (o.context && typeof o.context === 'object' ? o.context : {}) as Record<string, unknown>;

  return {
    ruleName: pickString(o.ruleName, o.rule_name, o.name, rule.name, o.rule_id),
    alertState: pickString(o.alertState, o.state, o.alert_state),
    reason: pickString(o.reason, context.reason, context.message, o.message),
    viewInAppUrl: pickString(o.viewInAppUrl, context.viewInAppUrl, o.view_in_app_url),
    raw: body,
  };
}

function shouldDedup(payload: KibanaAlertPayload, dedupKey?: string): boolean {
  const key = dedupKey ?? `${payload.ruleName ?? 'unknown'}:${payload.alertState ?? 'unknown'}`;
  const now = Date.now();
  const last = recentAlerts.get(key);
  return last != null && now - last < DEDUP_MS;
}

function markSent(payload: KibanaAlertPayload, dedupKey?: string): void {
  const key = dedupKey ?? `${payload.ruleName ?? 'unknown'}:${payload.alertState ?? 'unknown'}`;
  recentAlerts.set(key, Date.now());
}

export async function handleKibanaAlertWebhook(
  body: unknown,
  alertId?: string,
): Promise<AlertNotifyResult> {
  const payload = parseKibanaAlertPayload(body);
  const dedupKey = alertId ?? `${payload.ruleName ?? 'unknown'}:${payload.alertState ?? 'unknown'}`;
  if (shouldDedup(payload, dedupKey)) {
    return { sent: false, deduped: true };
  }

  const context = await enrichAlertContext(payload);
  const notifyPayload: KibanaAlertPayload = context ? { ...payload, context } : payload;

  const emailTo = process.env.OBS_ALERT_EMAIL_TO?.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const sendEmail = Boolean(emailTo?.length);
  const sendTelegram = isTelegramAlertConfigured();

  if (!sendEmail && !sendTelegram) {
    throw new Error(
      'Nenhum canal de alerta configurado (OBS_ALERT_EMAIL_TO ou OBS_ALERT_TELEGRAM_BOT_TOKEN + OBS_ALERT_TELEGRAM_CHAT_ID)',
    );
  }

  const channels: { email?: boolean; telegram?: boolean } = {};
  const errors: string[] = [];

  if (sendEmail) {
    try {
      await sendObservabilityAlertEmail(emailTo!, notifyPayload);
      channels.email = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`e-mail: ${msg}`);
    }
  }

  if (sendTelegram) {
    try {
      await sendObservabilityAlertTelegram(notifyPayload);
      channels.telegram = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Telegram: ${msg}`);
    }
  }

  if (!channels.email && !channels.telegram) {
    throw new Error(errors.join('; '));
  }

  markSent(payload, dedupKey);
  return { sent: true, channels };
}
