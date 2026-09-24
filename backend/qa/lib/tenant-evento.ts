import { prisma } from '../../src/lib/prisma.js';
import { inicializarMontagemEvento } from '../../src/lib/tap-montagem.js';
import { api } from './http.js';
import type { TenantFixture } from './types.js';

/** Garante evento aberto válido (RF-04 pode ter removido o seed do trailer no dia). */
export async function ensureTenantEventoAberto(tenant: TenantFixture): Promise<void> {
  let ev = await prisma.evento.findUnique({
    where: { id: tenant.eventoId },
    select: { id: true, status: true },
  });

  if (!ev) {
    // The trailer relation is unique. A previous QA phase may have removed
    // only the context marker while leaving its event behind, so reuse that
    // event instead of attempting a duplicate insert.
    const existingForTrailer = await prisma.evento.findFirst({
      where: { trailerId: tenant.trailerId },
      select: { id: true, status: true },
    });
    if (existingForTrailer) {
      tenant.eventoId = existingForTrailer.id;
      if (existingForTrailer.status !== 'ABERTO') {
        await api('PATCH', `/api/eventos/${tenant.eventoId}/reabrir`, { token: tenant.donoToken });
      }
      await inicializarMontagemEvento(tenant.eventoId, tenant.trailerId);
      return;
    }

    const evento = await prisma.evento.create({
      data: {
        nome: `Evento QA ${tenant.index}`,
        local: `Local ${tenant.index}`,
        data: new Date(),
        horaInicio: '18:00',
        status: 'ABERTO',
        cervejariaId: tenant.cervejariaId,
        trailerId: tenant.trailerId,
      },
    });
    await inicializarMontagemEvento(evento.id, tenant.trailerId);
    tenant.eventoId = evento.id;
    return;
  }

  if (ev.status !== 'ABERTO') {
    await api('PATCH', `/api/eventos/${tenant.eventoId}/reabrir`, { token: tenant.donoToken });
  }

  await inicializarMontagemEvento(tenant.eventoId, tenant.trailerId);
}
