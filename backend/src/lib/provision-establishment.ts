import { z } from 'zod';
import { createSinglePdv } from './single-pdv-provisioning.js';

export const establishmentEnablementsSchema = z.object({
  plannedOperations: z.boolean(),
  taps: z.boolean(),
  inventory: z.boolean(),
  kitchen: z.boolean(),
});

export const provisionEstablishmentRequestSchema = z.object({
  nome: z.string().min(2),
  dono: z.object({ nome: z.string().min(2), email: z.string().email(), senha: z.string().min(6) }),
  enablements: establishmentEnablementsSchema.optional(),
});

export type ProvisionEstablishmentInput = {
  nome: string;
  dono: { nome: string; email: string; senhaHash: string };
  enablements?: z.infer<typeof establishmentEnablementsSchema>;
};

export type ProvisioningResources = {
  legacyProjection?: boolean;
  legacyExclusivo?: boolean;
};

/** Creates only identity and explicit enablement unless a legacy adapter requests a compatibility resource. */
export async function provisionEstablishment(
  tx: any,
  input: ProvisionEstablishmentInput & { slug: string },
  resources: ProvisioningResources = {},
) {
  const { enablements } = input;
  const cervejaria = await tx.cervejaria.create({
    data: {
      nome: input.nome,
      slug: input.slug,
    },
  });
  const dono = await tx.usuario.create({
    data: { nome: input.dono.nome, email: input.dono.email, senhaHash: input.dono.senhaHash, papel: 'DONO', cervejariaId: cervejaria.id },
    select: { id: true, nome: true, email: true, papel: true },
  });
  const configuracaoOperacional = await tx.configuracaoOperacional.create({
    data: {
      cervejariaId: cervejaria.id,
      // This record remains the owner of setup metadata and compatibility
      // fields. Canonical operational decisions live on ConfiguracaoPontoVenda.
      ...(enablements ? {
        plannedOperationsEnabled: false,
        tapsEnabled: enablements.taps,
        inventoryEnabled: enablements.inventory,
        kitchenEnabled: enablements.kitchen,
      } : {}),
      setupCompletedAt: enablements ? new Date() : null,
    },
  });
  const { pontoVenda, configuracaoPdv } = await createSinglePdv(tx, {
    cervejariaId: cervejaria.id,
    nome: 'Principal',
    operationalSettings: {
      tapsEnabled: enablements?.taps ?? false,
      inventoryEnabled: enablements?.inventory ?? false,
      kitchenEnabled: enablements?.kitchen ?? false,
      kitchenItemsChargeAtLaunch: false,
      allowCloseComandaWithPendingKitchenOrders: false,
      whatsappPedidoProntoEnabled: false,
      whatsappPedidoProntoNaCozinha: false,
      quantidadeMesas: null,
    },
  });
  // This row is a temporary route-context projection, never the new source of truth.
  if (resources.legacyProjection) {
    if (!enablements) throw new Error('Legacy provisioning requires explicit enablements');
    await tx.configuracaoOperacao.create({
      data: {
        cervejariaId: cervejaria.id,
        controlaEstoque: enablements.inventory,
        temCozinha: enablements.kitchen,
        exclusivo: resources.legacyExclusivo === true,
      },
    });
  }
  return { cervejaria, dono, configuracaoOperacional, pontoVenda, configuracaoPdv };
}

export function adaptLegacyProvisioning(input: {
  cervejariaNome: string; donoNome: string; donoEmail: string; senhaHash: string;
  moduloCervejaria: boolean; moduloOperacao: boolean; operacaoControlaEstoque: boolean; operacaoTemCozinha: boolean;
}, slug: string) {
  return {
    input: {
      nome: input.cervejariaNome,
      slug,
      dono: { nome: input.donoNome, email: input.donoEmail, senhaHash: input.senhaHash },
      enablements: {
        plannedOperations: input.moduloCervejaria,
        taps: input.moduloCervejaria,
        inventory: input.operacaoControlaEstoque,
        kitchen: input.operacaoTemCozinha,
      },
    },
    resources: {
      legacyProjection: input.moduloOperacao,
      legacyExclusivo: !input.moduloCervejaria,
    },
  };
}
