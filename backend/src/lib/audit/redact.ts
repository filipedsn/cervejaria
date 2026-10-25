const SENSITIVE_KEYS = new Set([
  'senha',
  'password',
  'senhahash',
  'token',
  'jwt',
  'authorization',
  'cookie',
  'email',
  'endereco',
  'address',
  'jwt_secret',
  'smtp_pass',
  'obs_alert_telegram_bot_token',
  'tap_geo_edge_token',
  'x-tap-geo-auth',
  'secret',
  'cpf', 'cnpj', 'documento', 'document', 'cvv', 'cvc', 'pan', 'cardnumber',
  'nome', 'clientenome', 'observacao', 'observacoes',
]);

export function maskTelefone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

function redactValue(key: string, value: unknown): unknown {
  const lower = key.toLowerCase();
  if (
    SENSITIVE_KEYS.has(lower) ||
    lower.includes('senha') ||
    lower.includes('password') ||
    lower.includes('email') ||
    lower.includes('endereco') ||
    lower.includes('address')
    || /token|secret|api[-_]?key|connection[-_]?string|database[-_]?url|card.?number|credit.?card|cvv|cvc/.test(lower)
  ) {
    return '[REDACTED]';
  }
  if (lower.includes('telefone') && typeof value === 'string') {
    return maskTelefone(value);
  }
  return value;
}

export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[MAX_DEPTH]';
  if (typeof value === 'string') {
    if (/\b(?:bearer|basic)\s+\S+|\beyJ[\w-]+\.[\w-]+\.[\w-]+|\b(?:postgres(?:ql)?|mysql|redis):\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value)) return '[REDACTED]';
    return value.length > 1000 ? value.slice(0, 1000) + '[TRUNCATED]' : value;
  }
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactObject(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, val] of entries.slice(0, 100)) {
    const redacted = redactValue(key, val);
    if (redacted !== val) {
      out[key] = redactObject(redacted, depth + 1);
    } else if (typeof val === 'object' && val !== null) {
      out[key] = redactObject(val, depth + 1);
    } else {
      out[key] = redactObject(redacted, depth + 1);
    }
  }
  if (entries.length > 100) out._truncated = true;
  return out;
}

export function summarizePrismaArgs(model: string, operation: string, args: unknown): string {
  const redacted = redactObject(args) as Record<string, unknown>;
  const where = redacted.where ? ` WHERE ${JSON.stringify(redacted.where)}` : '';
  const data = redacted.data ? ` DATA ${JSON.stringify(redacted.data)}` : '';
  const select = redacted.select ? ' [select]' : '';
  return `${operation} ${model}${where}${data}${select}`.slice(0, 2000);
}
