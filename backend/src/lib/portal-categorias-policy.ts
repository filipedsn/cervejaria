/**
 * Categorias efetivamente visíveis no portal do cliente.
 * `permitidas === null` = todas; array = só as marcadas (pode ser vazio).
 */
export function categoriasVisiveisNoPortal(
  categoriasEstabelecimento: string[],
  permitidas: unknown,
): string[] {
  if (!Array.isArray(permitidas)) return categoriasEstabelecimento;
  const allowed = new Set(
    permitidas.filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
  );
  return categoriasEstabelecimento.filter((name) => allowed.has(name));
}

/** Alerta de balcão só pode usar categorias que o cliente consegue pedir no portal. */
export function categoriasElegiveisAlertaBalcao(
  categoriasEstabelecimento: string[],
  permitidasNoPortal: unknown,
  selecionadasAlerta: unknown,
): { elegiveis: string[]; alertaAtivo: string[] | null } {
  const elegiveis = categoriasVisiveisNoPortal(categoriasEstabelecimento, permitidasNoPortal);
  const elegivelSet = new Set(elegiveis);
  if (!Array.isArray(selecionadasAlerta)) {
    return { elegiveis, alertaAtivo: null };
  }
  const alertaAtivo = selecionadasAlerta.filter(
    (value): value is string => typeof value === 'string' && elegivelSet.has(value),
  );
  return { elegiveis, alertaAtivo: alertaAtivo.length > 0 ? alertaAtivo : null };
}
