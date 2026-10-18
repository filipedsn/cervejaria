export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/** Normaliza telefone BR para armazenamento (somente DDD + número, 10 ou 11 dígitos). */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = digitsOnly(value);
  // Telefones informados com o código do Brasil devem corresponder ao mesmo
  // cadastro do formato nacional usado no caixa (DDD + número).
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  digits = digits.slice(0, 11);
  return digits.length >= 10 ? digits : null;
}

export function formatPhoneBr(value: string | null | undefined): string {
  if (!value) return '';
  let digits = digitsOnly(value);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 3) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits[2]} ${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}
