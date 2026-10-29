/**
 * Normaliza nome de pessoa para o padrão pedido pela operação:
 * inicial maiúscula em cada palavra (e após hífen).
 * Ex.: "joão da silva" → "João Da Silva"
 */
export function formatPersonName(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      word
        .split('-')
        .map((part) => {
          if (!part) return part;
          const first = part.charAt(0).toLocaleUpperCase('pt-BR');
          const rest = part.slice(1).toLocaleLowerCase('pt-BR');
          return `${first}${rest}`;
        })
        .join('-'),
    )
    .join(' ');
}

/** Máscara de digitação: não remove o espaço final enquanto o usuário escreve. */
export function formatPersonNameInput(input: string): string {
  const trailingSpace = /\s$/.test(input);
  const formatted = formatPersonName(input);
  if (!formatted) return trailingSpace ? '' : '';
  return trailingSpace ? `${formatted} ` : formatted;
}
