/** Cardápios salvos estão sempre disponíveis; o antigo toggle foi removido. */
export async function cervejariaUsaCardapio(_cervejariaId: string, _db?: unknown): Promise<boolean> {
  return true;
}

export async function operacaoUsaCardapio(cervejariaId: string): Promise<boolean> {
  return cervejariaUsaCardapio(cervejariaId);
}
