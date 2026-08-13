import crypto from 'node:crypto';
import { prisma } from './prisma.js';
import { getJwtSecret } from './security-config.js';

const PLATFORM_KEY = 'platform';

export interface SmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
}

export interface BackupSettings {
  enabled: boolean;
  retentionDays: number;
  scheduleHour: number;
}

export interface PlatformSettings {
  appUrl: string;
  smtp: SmtpSettings & { passEnc?: string };
  backup: BackupSettings;
  lastBackupAt?: string;
  lastBackupFile?: string;
  lastBackupSize?: number;
}

const DEFAULTS: PlatformSettings = {
  appUrl: process.env.APP_URL ?? 'http://localhost:5202',
  smtp: {
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    user: '',
    from: 'Cervejaria Movel <noreply@localhost>',
  },
  backup: {
    enabled: true,
    retentionDays: 14,
    scheduleHour: 3,
  },
};

function encryptionKey(): Buffer {
  return crypto.createHash('sha256').update(getJwtSecret()).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(enc: string): string {
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

async function readRaw(): Promise<PlatformSettings | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key: PLATFORM_KEY } });
  if (!row) return null;
  return row.value as PlatformSettings;
}

function mergeStored(stored: PlatformSettings): PlatformSettings {
  return {
    ...DEFAULTS,
    ...stored,
    smtp: { ...DEFAULTS.smtp, ...stored.smtp },
    backup: { ...DEFAULTS.backup, ...stored.backup },
  };
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const raw = await readRaw();
  if (!raw) {
    return {
      ...DEFAULTS,
      appUrl: process.env.APP_URL ?? DEFAULTS.appUrl,
      smtp: {
        ...DEFAULTS.smtp,
        host: process.env.SMTP_HOST ?? '',
        port: parseInt(process.env.SMTP_PORT ?? '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER ?? '',
        from: process.env.SMTP_FROM ?? DEFAULTS.smtp.from,
        enabled: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
      },
    };
  }
  return mergeStored(raw);
}

export async function savePlatformSettings(partial: Partial<PlatformSettings>): Promise<PlatformSettings> {
  const current = await getPlatformSettings();
  const next: PlatformSettings = {
    ...current,
    ...partial,
    smtp: { ...current.smtp, ...partial.smtp },
    backup: { ...current.backup, ...partial.backup },
  };

  await prisma.systemConfig.upsert({
    where: { key: PLATFORM_KEY },
    create: { key: PLATFORM_KEY, value: next as object },
    update: { value: next as object },
  });

  return next;
}

export async function getAppUrl(): Promise<string> {
  const raw = await readRaw();
  if (raw?.appUrl) return raw.appUrl;
  return process.env.APP_URL ?? DEFAULTS.appUrl;
}

function smtpFromAddress(from: string | undefined, user: string): string {
  const trimmed = from?.trim();
  if (trimmed && !trimmed.includes('noreply@localhost') && !trimmed.includes('@localhost>')) {
    return trimmed;
  }
  if (user.trim()) return `Quiver Tap Alertas <${user.trim()}>`;
  return trimmed ?? DEFAULTS.smtp.from;
}

export async function getSmtpCredentials(): Promise<{
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}> {
  let raw: PlatformSettings | null = null;
  try {
    raw = await readRaw();
  } catch {
    raw = null;
  }

  if (raw?.smtp.enabled && raw.smtp.host && raw.smtp.user && raw.smtp.passEnc) {
    return {
      configured: true,
      host: raw.smtp.host,
      port: raw.smtp.port,
      secure: raw.smtp.secure,
      user: raw.smtp.user,
      pass: decryptSecret(raw.smtp.passEnc),
      from: smtpFromAddress(raw.smtp.from, raw.smtp.user),
    };
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const from = smtpFromAddress(process.env.SMTP_FROM, process.env.SMTP_USER);
    return {
      configured: true,
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from,
    };
  }

  const s = await getPlatformSettings();
  return {
    configured: false,
    host: s.smtp.host,
    port: s.smtp.port,
    secure: s.smtp.secure,
    user: s.smtp.user,
    pass: '',
    from: s.smtp.from,
  };
}

export interface AdminSettingsResponse {
  appUrl: string;
  smtp: SmtpSettings & { passConfigured: boolean };
  backup: BackupSettings;
  lastBackupAt: string | null;
  lastBackupFile: string | null;
  lastBackupSize: number | null;
  smtpSource: 'database' | 'env';
}

export async function getAdminSettingsResponse(): Promise<AdminSettingsResponse> {
  const raw = await readRaw();
  const s = await getPlatformSettings();
  const passConfigured = Boolean(
    raw?.smtp.passEnc || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
  );
  return {
    appUrl: s.appUrl,
    smtp: {
      enabled: s.smtp.enabled,
      host: s.smtp.host,
      port: s.smtp.port,
      secure: s.smtp.secure,
      user: s.smtp.user,
      from: s.smtp.from,
      passConfigured,
    },
    backup: s.backup,
    lastBackupAt: s.lastBackupAt ?? null,
    lastBackupFile: s.lastBackupFile ?? null,
    lastBackupSize: s.lastBackupSize ?? null,
    smtpSource: raw ? 'database' : 'env',
  };
}

export function hasDbSettings(): Promise<boolean> {
  return readRaw().then(Boolean);
}
