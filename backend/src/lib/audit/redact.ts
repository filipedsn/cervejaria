const SENSITIVE_KEYS = new Set([
  'senha',
  'password',
  'senhaHash',
  'token',
  'jwt',
  'authorization',
  'cookie',
  'JWT_SECRET',
  'SMTP_PASS',
  'OBS_ALERT_TELEGRAM_BOT_TOKEN',
  'secret',
]);

export function maskTelefone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

function redactValue(key: string, value: unknown): unknown {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEYS.has(lower) || lower.includes('senha') || lower.includes('password')) {
    return '[REDACTED]';
  }
  if (lower.includes('telefone') && typeof value === 'string') {
    return maskTelefone(value);
  }
  return value;
}

export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[MAX_DEPTH]';
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactObject(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === 'object' && val !== null) {
      out[key] = redactObject(val, depth + 1);
    } else {
      out[key] = redactValue(key, val);
    }
  }
  return out;
}

export function summarizePrismaArgs(model: string, operation: string, args: unknown): string {
  const redacted = redactObject(args) as Record<string, unknown>;
  const where = redacted.where ? ` WHERE ${JSON.stringify(redacted.where)}` : '';
  const data = redacted.data ? ` DATA ${JSON.stringify(redacted.data)}` : '';
  const select = redacted.select ? ' [select]' : '';
  return `${operation} ${model}${where}${data}${select}`.slice(0, 2000);
}
