import { z } from 'zod';

export const establishmentEnablementsSchema = z.object({
  directSales: z.boolean(),
  plannedOperations: z.boolean(),
  taps: z.boolean(),
  inventory: z.boolean(),
  kitchen: z.boolean(),
});

export const provisionEstablishmentRequestSchema = z.object({
  nome: z.string().min(2),
  dono: z.object({ nome: z.string().min(2), email: z.string().email(), senha: z.string().min(6) }),
  enablements: establishmentEnablementsSchema,
});

export type ProvisionEstablishmentInput = {
  nome: string;
  dono: { nome: string; email: string; senhaHash: string };
  enablements: z.infer<typeof establishmentEnablementsSchema>;
};

export type ProvisioningResources = {
  createTrailer?: boolean;
  createPointOfSale?: boolean;
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
      ...(resources.createTrailer ? { trailers: { create: { nome: 'Principal' } } } : {}),
    },
  });
  const dono = await tx.usuario.create({
    data: { nome: input.dono.nome, email: input.dono.email, senhaHash: input.dono.senhaHash, papel: 'DONO', cervejariaId: cervejaria.id },
    select: { id: true, nome: true, email: true, papel: true },
  });
  const configuracaoOperacional = await tx.configuracaoOperacional.create({
    data: {
      cervejariaId: cervejaria.id,
      directSalesEnabled: enablements.directSales,
      plannedOperationsEnabled: enablements.plannedOperations,
      tapsEnabled: enablements.taps,
      inventoryEnabled: enablements.inventory,
      kitchenEnabled: enablements.kitchen,
    },
  });
  // This row is a temporary route-context projection, never the new source of truth.
  if (resources.legacyProjection) {
    await tx.configuracaoQuiosque.create({
      data: {
        cervejariaId: cervejaria.id,
        controlaEstoque: enablements.inventory,
        temCozinha: enablements.kitchen,
        exclusivo: resources.legacyExclusivo === true,
      },
    });
    if (resources.createPointOfSale) {
      await tx.pontoVenda.create({ data: { cervejariaId: cervejaria.id, nome: 'Principal' } });
    }
  }
  return { cervejaria, dono, configuracaoOperacional };
}

export function adaptLegacyProvisioning(input: {
  cervejariaNome: string; donoNome: string; donoEmail: string; senhaHash: string;
  moduloCervejaria: boolean; moduloQuiosque: boolean; quiosqueControlaEstoque: boolean; quiosqueTemCozinha: boolean;
}, slug: string) {
  return {
    input: {
      nome: input.cervejariaNome,
      slug,
      dono: { nome: input.donoNome, email: input.donoEmail, senhaHash: input.senhaHash },
      enablements: {
        directSales: input.moduloQuiosque,
        plannedOperations: input.moduloCervejaria,
        taps: input.moduloCervejaria,
        inventory: input.quiosqueControlaEstoque,
        kitchen: input.quiosqueTemCozinha,
      },
    },
    resources: {
      createTrailer: input.moduloCervejaria,
      createPointOfSale: input.moduloQuiosque,
      legacyProjection: input.moduloQuiosque,
      legacyExclusivo: !input.moduloCervejaria,
    },
  };
}
