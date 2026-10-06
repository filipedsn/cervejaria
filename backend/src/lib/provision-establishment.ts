import { z } from 'zod';
import { createSinglePdv, type SinglePdvProvisioningMode } from './single-pdv-provisioning.js';

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
  mode: SinglePdvProvisioningMode;
  createTrailer?: boolean;
  createPointOfSale?: boolean;
  legacyProjection?: boolean;
  legacyExclusivo?: boolean;
};

/**
 * Compatibility bridge for the rollout period. CANONICAL creates the unique
 * PDV and its additive configuration atomically. LEGACY preserves the prior
 * JSON/multipart resource and response contract without touching that model.
 * Remove LEGACY only after the separately approved operational cutover.
 */
export async function provisionEstablishment(
  tx: any,
  input: ProvisionEstablishmentInput & { slug: string },
  resources: ProvisioningResources,
) {
  const { enablements } = input;
  const canonical = resources.mode === 'CANONICAL';
  const cervejaria = await tx.cervejaria.create({
    data: {
      nome: input.nome,
      slug: input.slug,
      ...(!canonical && resources.createTrailer ? { trailers: { create: { nome: 'Principal' } } } : {}),
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
        // Keep explicit legacy metadata during transition. CANONICAL profile
        // resolution ignores this selector and fixes the motor to Por Caixa.
        plannedOperationsEnabled: enablements.plannedOperations,
        tapsEnabled: enablements.taps,
        inventoryEnabled: enablements.inventory,
        kitchenEnabled: enablements.kitchen,
      } : {}),
      setupCompletedAt: enablements ? new Date() : null,
    },
  });
  let pontoVenda = null;
  let configuracaoPdv = null;
  if (canonical) {
    ({ pontoVenda, configuracaoPdv } = await createSinglePdv(tx, {
      mode: 'CANONICAL',
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
    }));
  } else if (resources.createPointOfSale) {
    ({ pontoVenda } = await createSinglePdv(tx, {
      mode: 'LEGACY', cervejariaId: cervejaria.id, nome: 'Principal',
    }));
  }
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
      createTrailer: input.moduloCervejaria,
      createPointOfSale: input.moduloOperacao,
      legacyProjection: input.moduloOperacao,
      legacyExclusivo: !input.moduloCervejaria,
    },
  };
}
