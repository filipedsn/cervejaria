import { digitsOnly } from './phone';

/** Máscara BRL enquanto digita: centavos → R$ 12,34 */
export function formatCurrencyInput(value: string): string {
  const digits = digitsOnly(value);
  if (!digits) return '';
  const amount = parseInt(digits, 10) / 100;
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Converte valor mascarado (ou parcial) para número em reais */
export function parseCurrencyInput(value: string): number {
  const digits = digitsOnly(value);
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
}

/** Inicializa input a partir de preço da API (número ou string) */
export function formatCurrencyInputFromNumber(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(num) || num <= 0) return '';
  return formatCurrencyInput(String(Math.round(num * 100)));
}
