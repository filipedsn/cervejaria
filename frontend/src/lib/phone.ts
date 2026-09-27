export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/** Formata telefones brasileiros: celular (DD) 9 XXXX-XXXX e fixo (DD) XXXX-XXXX. */
export function formatPhone(value: string): string {
  let digits = digitsOnly(value);
  // Se colarem o código do país junto, remove-o antes da máscara nacional.
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  digits = digits.slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 3) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits[2]} ${digits.slice(3, 7)}-${digits.slice(7)}`;
}
