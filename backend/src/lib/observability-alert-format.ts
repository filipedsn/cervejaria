import type { KibanaAlertPayload } from './kibana-alert-email.js';
import type { AlertEnrichedContext } from './observability-alert-enrich.js';
import { buildInfraTechnicalDetails } from './observability-alert-enrich.js';
import {
  buildObservabilityAlertSections,
  isOperationalAlertRule,
  resolveAlertCopy,
  formatAlertStateLabel,
  resolveEnvironmentLabel,
} from './observability-alert-copy.js';

const TELEGRAM_MAX_CHARS = 4000;
const MISSING = 'Nao identificado';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function pickContext(payload: KibanaAlertPayload): AlertEnrichedContext {
  return payload.context ?? {};
}

function fieldOrMissing(value?: string): string {
  return value?.trim() ? value.trim() : MISSING;
}

function formatTechnicalBlock(lines: string[]): string {
  if (lines.length === 0) return MISSING;
  return lines.join('\n');
}

function appendTechnicalSection(lines: string[], title: string, details: string[]): void {
  if (details.length === 0) return;
  lines.push('', `<b>${title}:</b>`, escapeHtml(formatTechnicalBlock(details)));
}

function formatOperationalTelegram(payload: KibanaAlertPayload): string {
  const ctx = pickContext(payload);
  const state = formatAlertStateLabel(payload.alertState);
  const copy = resolveAlertCopy(payload.ruleName);
  const env = resolveEnvironmentLabel(payload.ruleName);
  const sections = buildObservabilityAlertSections(payload);

  const emoji = state.isRecovered ? '✅' : copy.severity === 'critical' ? '🚨' : '⚠️';
  const headline = state.isRecovered
    ? `${emoji} RECUPERADO — ${escapeHtml(ctx.operacao ?? copy.title)}`
    : `${emoji} ERRO NA OPERACAO`;

  const lines: string[] = [headline, ''];

  if (!state.isRecovered) {
    lines.push(
      `<b>Empresa:</b> ${escapeHtml(fieldOrMissing(ctx.empresa))}`,
      `<b>Usuario:</b> ${escapeHtml(fieldOrMissing(ctx.usuario))}`,
      `<b>Operacao:</b> ${escapeHtml(fieldOrMissing(ctx.operacao))}`,
      `<b>Descricao do erro:</b> ${escapeHtml(
        fieldOrMissing(ctx.errorDescription ?? payload.reason),
      )}`,
    );
    appendTechnicalSection(
      lines,
      'Detalhamento',
      ctx.technicalDetails ?? buildInfraTechnicalDetails(payload),
    );
  } else {
    lines.push(
      `<b>Empresa:</b> ${escapeHtml(fieldOrMissing(ctx.empresa))}`,
      `<b>Operacao:</b> ${escapeHtml(fieldOrMissing(ctx.operacao))}`,
      `<b>Detalhamento:</b> ${escapeHtml(
        'O monitoramento indica que a condicao normalizou. Confira se a operacao concluiu corretamente no app.',
      )}`,
    );
  }

  lines.push('', `Estado: ${escapeHtml(state.label)} | Ambiente: ${escapeHtml(env)}`);

  if (sections.timestampBr) {
    lines.push(`Horario: ${escapeHtml(sections.timestampBr)} (Brasilia)`);
  }

  if (payload.ruleName) {
    lines.push(`Regra: <code>${escapeHtml(payload.ruleName)}</code>`);
  }

  if (sections.viewInAppUrl) {
    lines.push('', `<a href="${escapeHtml(sections.viewInAppUrl)}">Abrir no Kibana</a>`);
  }

  return lines.join('\n');
}

function formatInfraTelegram(payload: KibanaAlertPayload): string {
  const sections = buildObservabilityAlertSections(payload);
  const copy = resolveAlertCopy(payload.ruleName);
  const state = formatAlertStateLabel(payload.alertState);

  const emoji = state.isRecovered ? '✅' : copy.severity === 'critical' ? '🚨' : '⚠️';
  const headline = state.isRecovered
    ? `${emoji} ${state.headlinePrefix} — ${escapeHtml(copy.title)}`
    : `${emoji} ${state.headlinePrefix} — ${escapeHtml(copy.title)}`;

  const problema = state.isRecovered
    ? copy.title
    : copy.summary;

  const detalhamentoParts: string[] = [];
  if (state.isRecovered) {
    detalhamentoParts.push(
      sections.summary,
      sections.impact,
    );
  } else {
    detalhamentoParts.push(sections.impact);
    sections.actions.forEach((action, index) => {
      detalhamentoParts.push(`${index + 1}. ${action}`);
    });
  }

  if (sections.technicalReason) {
    detalhamentoParts.push(`Motivo tecnico: ${sections.technicalReason}`);
  }

  const infraTechnical = buildInfraTechnicalDetails(payload);
  for (const line of infraTechnical) {
    if (!detalhamentoParts.some((part) => part.includes(line))) {
      detalhamentoParts.push(line);
    }
  }

  const lines: string[] = [
    `<b>${headline}</b>`,
    `Estado: ${escapeHtml(sections.stateLabel)}`,
    `Ambiente: ${escapeHtml(sections.environment)}`,
  ];

  if (sections.timestampBr) {
    lines.push(`Horario: ${escapeHtml(sections.timestampBr)} (Brasilia)`);
  }

  lines.push(
    '',
    `<b>Problema:</b> ${escapeHtml(problema)}`,
    '',
    `<b>Detalhamento:</b>`,
    escapeHtml(detalhamentoParts.join('\n')),
  );

  if (sections.ruleId) {
    lines.push(`Regra: <code>${escapeHtml(sections.ruleId)}</code>`);
  }

  if (sections.viewInAppUrl) {
    lines.push('', `<a href="${escapeHtml(sections.viewInAppUrl)}">Abrir no Kibana</a>`);
  }

  return lines.join('\n');
}

export function formatObservabilityAlertTelegramText(payload: KibanaAlertPayload): string {
  let text = isOperationalAlertRule(payload.ruleName)
    ? formatOperationalTelegram(payload)
    : formatInfraTelegram(payload);

  if (text.length > TELEGRAM_MAX_CHARS) {
    text = `${text.slice(0, TELEGRAM_MAX_CHARS - 1)}…`;
  }
  return text;
}

function formatOperationalEmailHtml(payload: KibanaAlertPayload): string {
  const ctx = pickContext(payload);
  const state = formatAlertStateLabel(payload.alertState);
  const copy = resolveAlertCopy(payload.ruleName);
  const env = resolveEnvironmentLabel(payload.ruleName);
  const sections = buildObservabilityAlertSections(payload);
  const headline = state.isRecovered
    ? `Recuperado — ${ctx.operacao ?? copy.title}`
    : `Erro na operacao — ${ctx.operacao ?? copy.title}`;

  const bodyRows = state.isRecovered
    ? `
      <p><strong>Empresa:</strong> ${escapeHtml(fieldOrMissing(ctx.empresa))}<br>
      <strong>Operacao:</strong> ${escapeHtml(fieldOrMissing(ctx.operacao))}</p>
      <p><strong>Detalhamento:</strong> O monitoramento indica que a condicao normalizou. Confira se a operacao concluiu corretamente no app.</p>
    `
    : `
      <p><strong>Empresa:</strong> ${escapeHtml(fieldOrMissing(ctx.empresa))}<br>
      <strong>Usuario:</strong> ${escapeHtml(fieldOrMissing(ctx.usuario))}<br>
      <strong>Operacao:</strong> ${escapeHtml(fieldOrMissing(ctx.operacao))}</p>
      <p><strong>Descricao do erro:</strong> ${escapeHtml(
        fieldOrMissing(ctx.errorDescription ?? payload.reason),
      )}</p>
      ${
        (ctx.technicalDetails?.length ?? 0) > 0
          ? `<h3 style="margin-bottom: 0.25rem;">Detalhamento</h3><pre style="white-space: pre-wrap; font-size: 13px; background: #f6f6f6; padding: 12px; border-radius: 6px;">${escapeHtml(
              formatTechnicalBlock(ctx.technicalDetails ?? []),
            )}</pre>`
          : ''
      }
    `;

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.5;">
      <h2 style="color:#e69500; margin-bottom: 0.25rem;">${escapeHtml(headline)}</h2>
      <p style="margin-top: 0;"><strong>Estado:</strong> ${escapeHtml(state.label)}<br>
      <strong>Ambiente:</strong> ${escapeHtml(env)}${
        sections.timestampBr ? `<br><strong>Horario:</strong> ${escapeHtml(sections.timestampBr)} (Brasilia)` : ''
      }</p>
      ${bodyRows}
      ${payload.ruleName ? `<p style="font-size: 13px; color: #555;"><strong>Regra:</strong> <code>${escapeHtml(payload.ruleName)}</code></p>` : ''}
      ${sections.viewInAppUrl ? `<p><a href="${escapeHtml(sections.viewInAppUrl)}" style="color:#e69500;">Abrir no Kibana</a></p>` : ''}
    </div>
  `;
}

function formatInfraEmailHtml(payload: KibanaAlertPayload): string {
  const sections = buildObservabilityAlertSections(payload);
  const copy = resolveAlertCopy(payload.ruleName);
  const state = formatAlertStateLabel(payload.alertState);

  const problema = state.isRecovered ? copy.title : sections.summary;
  const detalhamentoParts: string[] = [];

  if (state.isRecovered) {
    detalhamentoParts.push(sections.summary, sections.impact);
  } else {
    detalhamentoParts.push(sections.impact);
    sections.actions.forEach((action, index) => {
      detalhamentoParts.push(`${index + 1}. ${action}`);
    });
  }

  if (sections.technicalReason) {
    detalhamentoParts.push(`Motivo tecnico: ${sections.technicalReason}`);
  }

  const infraTechnical = buildInfraTechnicalDetails(payload);
  for (const line of infraTechnical) {
    if (!detalhamentoParts.some((part) => part.includes(line))) {
      detalhamentoParts.push(line);
    }
  }

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.5;">
      <h2 style="color:#e69500; margin-bottom: 0.25rem;">${escapeHtml(sections.headline)}</h2>
      <p style="margin-top: 0;"><strong>Estado:</strong> ${escapeHtml(sections.stateLabel)}<br>
      <strong>Ambiente:</strong> ${escapeHtml(sections.environment)}${
        sections.timestampBr ? `<br><strong>Horario:</strong> ${escapeHtml(sections.timestampBr)} (Brasilia)` : ''
      }</p>

      <h3 style="margin-bottom: 0.25rem;">Problema</h3>
      <p>${escapeHtml(problema)}</p>

      <h3 style="margin-bottom: 0.25rem;">Detalhamento</h3>
      <p style="white-space: pre-line;">${escapeHtml(detalhamentoParts.join('\n'))}</p>

      ${sections.ruleId ? `<p style="font-size: 13px; color: #555;"><strong>Regra:</strong> <code>${escapeHtml(sections.ruleId)}</code></p>` : ''}
      ${sections.viewInAppUrl ? `<p><a href="${escapeHtml(sections.viewInAppUrl)}" style="color:#e69500;">Abrir no Kibana</a></p>` : ''}
    </div>
  `;
}

export function formatObservabilityAlertEmailHtml(payload: KibanaAlertPayload): string {
  return isOperationalAlertRule(payload.ruleName)
    ? formatOperationalEmailHtml(payload)
    : formatInfraEmailHtml(payload);
}

export function formatObservabilityAlertEmailSubject(payload: KibanaAlertPayload): string {
  const env = resolveEnvironmentLabel(payload.ruleName);
  const state = formatAlertStateLabel(payload.alertState);
  const prefix = state.isRecovered ? '[Recuperado]' : '[Alerta]';

  if (isOperationalAlertRule(payload.ruleName)) {
    const ctx = pickContext(payload);
    const operacao = ctx.operacao ?? resolveAlertCopy(payload.ruleName).title;
    const empresa = ctx.empresa ? ` — ${ctx.empresa}` : '';
    return `${prefix} Quiver Tap — ${operacao}${empresa} (${env})`;
  }

  const copy = resolveAlertCopy(payload.ruleName);
  return `${prefix} Quiver Tap — ${copy.title} (${env})`;
}
