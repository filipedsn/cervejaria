export type SinglePdvOperationalSettings = {
  tapsEnabled: boolean;
  inventoryEnabled: boolean;
  kitchenEnabled: boolean;
  kitchenItemsChargeAtLaunch: boolean;
  allowCloseComandaWithPendingKitchenOrders: boolean;
  whatsappPedidoProntoEnabled: boolean;
  whatsappPedidoProntoNaCozinha: boolean;
  quantidadeMesas: number | null;
};

export class SinglePdvProvisioningConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'PDV_ALREADY_EXISTS';

  constructor(readonly existingCount: number) {
    super(existingCount > 1
      ? 'A empresa possui mais de um PDV legado; nenhum foi escolhido ou alterado.'
      : 'A empresa já possui um PDV; um segundo PDV não pode ser criado.');
    this.name = 'SinglePdvProvisioningConflictError';
  }
}

/**
 * Create the tenant's first point of sale while serializing every API writer
 * on a tenant-scoped transaction lock. Existing ambiguous legacy rows are
 * never selected, consolidated, or changed.
 */
export async function createSinglePdv(
  tx: any,
  params: {
    cervejariaId: string;
    nome: string;
    operationalSettings?: SinglePdvOperationalSettings;
  },
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${params.cervejariaId}, 0))`;

  const existing = await tx.pontoVenda.findMany({
    where: { cervejariaId: params.cervejariaId },
    select: { id: true },
    take: 2,
  });
  if (existing.length > 0) throw new SinglePdvProvisioningConflictError(existing.length);

  const pontoVenda = await tx.pontoVenda.create({
    data: { cervejariaId: params.cervejariaId, nome: params.nome.trim() || 'Principal' },
  });
  const configuracaoPdv = params.operationalSettings
    ? await tx.configuracaoPontoVenda.create({
        data: {
          cervejariaId: params.cervejariaId,
          pontoVendaId: pontoVenda.id,
          ...params.operationalSettings,
        },
      })
    : null;

  return { pontoVenda, configuracaoPdv };
}
