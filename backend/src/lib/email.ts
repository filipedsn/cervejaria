import nodemailer from 'nodemailer';
import { formatBrazilDateTime } from './event-datetime.js';
import { getSmtpCredentials } from './system-config.js';

let cachedKey: string | null = null;
let transporter: nodemailer.Transporter | null = null;

async function getTransporter() {
  const creds = await getSmtpCredentials();
  if (!creds.configured) return null;

  const key = `${creds.host}:${creds.port}:${creds.user}:${creds.pass.slice(0, 3)}`;
  if (transporter && cachedKey === key) return transporter;

  transporter = nodemailer.createTransport({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.user, pass: creds.pass },
  });
  cachedKey = key;
  return transporter;
}

export function resetEmailTransporter() {
  transporter = null;
  cachedKey = null;
}

const resetEmailHtml = (resetUrl: string) => `
  <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
    <h2>Recuperação de senha</h2>
    <p>Você solicitou a redefinição da sua senha no Quiver Tap.</p>
    <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#e69500;color:#1a1a2e;text-decoration:none;border-radius:8px;font-weight:bold;">Redefinir senha</a></p>
    <p style="color:#666;font-size:14px;">Este link expira em 1 hora. Se você não solicitou, ignore este e-mail.</p>
    <p style="color:#999;font-size:12px;">Ou copie e cole: ${resetUrl}</p>
  </div>
`;

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const creds = await getSmtpCredentials();
  const transport = await getTransporter();

  if (!transport) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n--- E-mail de recuperação (SMTP não configurado) ---');
      console.log(`Para: ${to}`);
      console.log(`Link: ${resetUrl}`);
      console.log('---\n');
    }
    return;
  }

  await transport.sendMail({
    from: creds.from,
    to,
    subject: 'Recuperação de senha - Quiver Tap',
    html: resetEmailHtml(resetUrl),
  });
}

export async function sendTestEmail(to: string): Promise<void> {
  const creds = await getSmtpCredentials();
  const transport = await getTransporter();
  if (!transport) {
    throw new Error('SMTP não configurado. Preencha host, usuário e senha.');
  }

  await transport.sendMail({
    from: creds.from,
    to,
    subject: 'Teste SMTP - Quiver Tap',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Teste de e-mail</h2>
        <p>Se você recebeu esta mensagem, o SMTP está configurado corretamente.</p>
        <p style="color:#666;font-size:14px;">Enviado em ${formatBrazilDateTime()} (horário de São Paulo)</p>
      </div>
    `,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendObservabilityAlertEmail(
  to: string | string[],
  alert: {
    ruleName?: string;
    alertState?: string;
    reason?: string;
    viewInAppUrl?: string;
  },
): Promise<void> {
  const creds = await getSmtpCredentials();
  const transport = await getTransporter();
  if (!transport) {
    throw new Error('SMTP não configurado. Preencha host, usuário e senha.');
  }

  const ruleName = alert.ruleName ?? 'Alerta Quiver Tap';
  const state = alert.alertState ?? 'disparado';
  const reason = alert.reason ?? 'Sem detalhes adicionais.';
  const link = alert.viewInAppUrl;

  const html = `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color:#e69500;">Alerta de observabilidade</h2>
      <p><strong>Regra:</strong> ${escapeHtml(ruleName)}</p>
      <p><strong>Estado:</strong> ${escapeHtml(state)}</p>
      <p><strong>Motivo:</strong> ${escapeHtml(reason)}</p>
      ${link ? `<p><a href="${escapeHtml(link)}" style="color:#e69500;">Abrir no Kibana</a></p>` : ''}
      <p style="color:#666;font-size:12px;">Enviado em ${formatBrazilDateTime()} (horário de São Paulo)</p>
    </div>
  `;

  await transport.sendMail({
    from: creds.from,
    to,
    subject: `[Quiver Tap] ${ruleName} — ${state}`,
    html,
  });
}
