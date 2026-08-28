import bcrypt from 'bcryptjs';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function formatCurrency(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;

  if (typeof value === 'bigint') {
    const converted = Number(value);
    if (Number.isSafeInteger(converted)) return converted;
    throw new TypeError('Valor bigint fora do intervalo seguro para number');
  }

  if (typeof value === 'string') return parseNumericString(value);

  if (value && typeof value === 'object' && typeof value.toString === 'function') {
    return parseNumericString(value.toString());
  }

  throw new TypeError('Valor numérico inválido');
}

function parseNumericString(value: string): number {
  const normalized = value.trim();
  if (!normalized) throw new TypeError('Valor numérico inválido');

  const converted = Number(normalized);
  if (Number.isFinite(converted)) return converted;
  throw new TypeError('Valor numérico inválido');
}
