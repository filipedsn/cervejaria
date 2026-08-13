export function normalizarBuscaComanda(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

export function textoCorrespondeBuscaComanda(
  termo: string,
  ...campos: Array<string | number | null | undefined>
): boolean {
  const q = normalizarBuscaComanda(termo);
  if (!q) return true;
  return campos.some(
    (campo) => campo != null && normalizarBuscaComanda(String(campo)).includes(q),
  );
}
