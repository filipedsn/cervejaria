import nodemailer from 'nodemailer';
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
        <p style="color:#666;font-size:14px;">Enviado em ${new Date().toLocaleString('pt-BR')}</p>
      </div>
    `,
  });
}
