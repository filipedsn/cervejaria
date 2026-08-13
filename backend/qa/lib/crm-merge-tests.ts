import { prisma } from '../../src/lib/prisma.js';
import { api } from './http.js';
import { ensureTenantEventoAberto } from './tenant-evento.js';
import type { QaContext, TenantFixture } from './types.js';

type TestStatus = 'passed' | 'failed' | 'skipped' | 'warning';

interface Outcome {
  status?: TestStatus;
  message?: string;
  details?: string;
  expected?: string;
  actual?: string;
}

type TestFn = (
  meta: { id: string; category: string; name: string; requirement?: string },
  fn: () => Promise<Outcome>,
) => Promise<void>;

interface MergeResponse {
  comandasMovidas?: number;
  pedidosMovidos?: number;
  estatisticas?: { totalComandasFechadas?: number; totalGasto?: number | string };
  error?: string;
}

/** Merge concorrente: clientes legados sem telefone, cada um com comandas fechadas. */
export async function runCrmMergeTests(ctx: QaContext, test: TestFn) {
  const tenant: TenantFixture | undefined = ctx.tenants[4] ?? ctx.tenants[0];
  if (!tenant) {
    await test(
      { id: 'CRM-C-01', category: 'CRM concorrente', name: 'Seed CRM-C', requirement: 'CRM-C' },
      async () => ({ status: 'failed', message: 'Tenant indisponível' }),
    );
    return;
  }

  await ensureTenantEventoAberto(tenant);

  const criados: string[] = [];

  /** Cliente legado (sem telefone) com N comandas fechadas de `valor` cada. */
  async function criarClienteComComandas(nome: string, comandas: number, valor: number) {
    const cliente = await prisma.cliente.create({
      data: { nome, telefone: null, cervejariaId: tenant.cervejariaId, cadastradoVia: 'COMANDA' },
    });
    criados.push(cliente.id);

    for (let i = 0; i < comandas; i += 1) {
      await prisma.comanda.create({
        data: {
          eventoId: tenant.eventoId,
          clienteId: cliente.id,
          status: 'FECHADA',
          tipo: 'COMANDA',
          total: valor,
          fechadaEm: new Date(),
          pagamentos: { create: [{ forma: 'PIX', valor }] },
        },
      });
    }
    return cliente.id;
  }

  await test(
    {
      id: 'CRM-C-01',
      category: 'CRM concorrente',
      name: 'Dois merges simultâneos da mesma fonte: um vence',
      requirement: 'CRM-C-01',
    },
    async () => {
      const stamp = Date.now();
      const fonteId = await criarClienteComComandas(`QA CRMC Fonte ${stamp}`, 2, 25);
      const destinoAId = await criarClienteComComandas(`QA CRMC Destino A ${stamp}`, 1, 10);
      const destinoBId = await criarClienteComComandas(`QA CRMC Destino B ${stamp}`, 1, 10);

      const [a, b] = await Promise.all([
        api<MergeResponse>('POST', `/api/clientes/${destinoAId}/unir`, {
          token: tenant.donoToken,
          body: { fonteId },
        }),
        api<MergeResponse>('POST', `/api/clientes/${destinoBId}/unir`, {
          token: tenant.donoToken,
          body: { fonteId },
        }),
      ]);

      const okCount = [a, b].filter((r) => r.status === 200).length;
      if (okCount !== 1) {
        return {
          status: 'failed',
          message: 'Exatamente um merge deveria vencer',
          expected: '1x 200',
          actual: `${a.status} / ${b.status}`,
          details: `${a.raw.slice(0, 120)} | ${b.raw.slice(0, 120)}`,
        };
      }

      const perdedor = a.status === 200 ? b : a;
      if (perdedor.status !== 404 && perdedor.status !== 409) {
        return {
          status: 'failed',
          message: 'Perdedor deveria receber erro de negócio, não falha interna',
          expected: '404 ou 409',
          actual: `${perdedor.status} ${perdedor.raw.slice(0, 160)}`,
        };
      }

      const fonteRestante = await prisma.cliente.findUnique({ where: { id: fonteId } });
      if (fonteRestante) {
        return { status: 'failed', message: 'Fonte deveria ter sido removida', expected: 'ausente', actual: 'existe' };
      }

      return {
        message: `Vencedor 200, perdedor ${perdedor.status}, fonte removida`,
        expected: '1 vencedor',
        actual: `${a.status}/${b.status}`,
      };
    },
  );

  await test(
    {
      id: 'CRM-C-02',
      category: 'CRM concorrente',
      name: 'Stats do vencedor somam as comandas da fonte',
      requirement: 'CRM-C-02',
    },
    async () => {
      const stamp = Date.now();
      const fonteId = await criarClienteComComandas(`QA CRMC Stats Fonte ${stamp}`, 3, 20);
      const destinoId = await criarClienteComComandas(`QA CRMC Stats Destino ${stamp}`, 2, 15);

      const merge = await api<MergeResponse>('POST', `/api/clientes/${destinoId}/unir`, {
        token: tenant.donoToken,
        body: { fonteId },
      });
      if (merge.status !== 200) {
        return { status: 'failed', message: 'Merge', expected: '200', actual: `${merge.status} ${merge.raw.slice(0, 120)}` };
      }
      if (merge.data.comandasMovidas !== 3) {
        return {
          status: 'failed',
          message: 'Comandas movidas',
          expected: '3',
          actual: String(merge.data.comandasMovidas),
        };
      }

      // 2 comandas de 15 + 3 de 20 = 5 comandas / R$ 90.
      const stats = await prisma.clienteEstatisticas.findUnique({
        where: { clienteId: destinoId },
        select: { totalComandasFechadas: true, totalGasto: true },
      });
      const gasto = Number(stats?.totalGasto ?? 0);
      if (stats?.totalComandasFechadas !== 5 || Math.abs(gasto - 90) > 0.01) {
        return {
          status: 'failed',
          message: 'Estatísticas recalculadas incorretamente',
          expected: '5 comandas / 90',
          actual: `${stats?.totalComandasFechadas} comandas / ${gasto}`,
        };
      }

      return { message: '5 comandas e R$ 90,00 consolidados', expected: '5/90', actual: `5/${gasto}` };
    },
  );

  await test(
    {
      id: 'CRM-C-03',
      category: 'CRM concorrente',
      name: 'Merge A→B e B→A simultâneos não apagam os dois',
      requirement: 'CRM-C-03',
    },
    async () => {
      const stamp = Date.now();
      const aId = await criarClienteComComandas(`QA CRMC Cruz A ${stamp}`, 1, 40);
      const bId = await criarClienteComComandas(`QA CRMC Cruz B ${stamp}`, 1, 60);

      const [ab, ba] = await Promise.all([
        api<MergeResponse>('POST', `/api/clientes/${aId}/unir`, { token: tenant.donoToken, body: { fonteId: bId } }),
        api<MergeResponse>('POST', `/api/clientes/${bId}/unir`, { token: tenant.donoToken, body: { fonteId: aId } }),
      ]);

      const [aVivo, bVivo] = await Promise.all([
        prisma.cliente.findUnique({ where: { id: aId }, select: { id: true } }),
        prisma.cliente.findUnique({ where: { id: bId }, select: { id: true } }),
      ]);

      const vivos = [aVivo, bVivo].filter(Boolean);
      if (vivos.length !== 1) {
        return {
          status: 'failed',
          message: 'Merge cruzado deveria deixar exatamente um cliente',
          expected: '1 sobrevivente',
          actual: `${vivos.length} (${ab.status}/${ba.status})`,
          details: `${ab.raw.slice(0, 120)} | ${ba.raw.slice(0, 120)}`,
        };
      }

      const sobreviventeId = vivos[0]!.id;
      const stats = await prisma.clienteEstatisticas.findUnique({
        where: { clienteId: sobreviventeId },
        select: { totalComandasFechadas: true, totalGasto: true },
      });
      const gasto = Number(stats?.totalGasto ?? 0);
      if (stats?.totalComandasFechadas !== 2 || Math.abs(gasto - 100) > 0.01) {
        return {
          status: 'failed',
          message: 'Sobrevivente com stats inconsistentes',
          expected: '2 comandas / 100',
          actual: `${stats?.totalComandasFechadas} comandas / ${gasto}`,
        };
      }

      // Nenhuma comanda pode ter ficado órfã apontando para o cliente apagado.
      const apagadoId = aVivo ? bId : aId;
      const orfas = await prisma.comanda.count({ where: { clienteId: apagadoId } });
      if (orfas > 0) {
        return { status: 'failed', message: 'Comandas órfãs', expected: '0', actual: String(orfas) };
      }

      return {
        message: `1 sobrevivente com 2 comandas (${ab.status}/${ba.status})`,
        expected: '1 sobrevivente íntegro',
        actual: 'OK',
      };
    },
  );

  await test(
    {
      id: 'CRM-C-04',
      category: 'CRM concorrente',
      name: 'Merge com telefones diferentes → 409',
      requirement: 'CRM-C-04',
    },
    async () => {
      const stamp = Date.now();
      const destino = await prisma.cliente.create({
        data: {
          nome: `QA CRMC Tel A ${stamp}`,
          telefone: `1197${String(stamp).slice(-7)}`,
          cervejariaId: tenant.cervejariaId,
          cadastradoVia: 'COMANDA',
        },
      });
      const fonte = await prisma.cliente.create({
        data: {
          nome: `QA CRMC Tel B ${stamp}`,
          telefone: `1198${String(stamp).slice(-7)}`,
          cervejariaId: tenant.cervejariaId,
          cadastradoVia: 'COMANDA',
        },
      });
      criados.push(destino.id, fonte.id);

      const merge = await api<MergeResponse>('POST', `/api/clientes/${destino.id}/unir`, {
        token: tenant.donoToken,
        body: { fonteId: fonte.id },
      });
      if (merge.status !== 409) {
        return { status: 'failed', message: 'Telefones divergentes', expected: '409', actual: `${merge.status} ${merge.raw.slice(0, 120)}` };
      }

      const fonteVivo = await prisma.cliente.findUnique({ where: { id: fonte.id } });
      if (!fonteVivo) {
        return { status: 'failed', message: 'Fonte apagada apesar do 409', expected: 'existe', actual: 'removida' };
      }
      return { message: 'Merge bloqueado sem efeito colateral', expected: '409', actual: '409' };
    },
  );

  await test(
    { id: 'CRM-C-05', category: 'CRM concorrente', name: 'Merge cross-tenant → 404', requirement: 'CRM-C-05' },
    async () => {
      const outro = ctx.tenants.find((t) => t.cervejariaId !== tenant.cervejariaId);
      if (!outro) return { status: 'skipped', message: 'Sem segundo tenant' };

      const stamp = Date.now();
      const destinoId = await criarClienteComComandas(`QA CRMC XT Destino ${stamp}`, 1, 10);
      const fonteOutro = await prisma.cliente.create({
        data: {
          nome: `QA CRMC XT Fonte ${stamp}`,
          telefone: null,
          cervejariaId: outro.cervejariaId,
          cadastradoVia: 'COMANDA',
        },
      });
      criados.push(fonteOutro.id);

      const merge = await api<MergeResponse>('POST', `/api/clientes/${destinoId}/unir`, {
        token: tenant.donoToken,
        body: { fonteId: fonteOutro.id },
      });
      if (merge.status !== 404) {
        return { status: 'failed', message: 'Fonte de outro tenant', expected: '404', actual: String(merge.status) };
      }

      const aindaLa = await prisma.cliente.findUnique({ where: { id: fonteOutro.id } });
      if (!aindaLa) {
        return { status: 'failed', message: 'Cliente do outro tenant foi removido', expected: 'intacto', actual: 'removido' };
      }
      return { message: 'Isolamento preservado no merge', expected: '404', actual: '404' };
    },
  );

  await test(
    { id: 'CRM-C-06', category: 'CRM concorrente', name: 'Cleanup dos clientes de merge', requirement: 'CRM-C-06' },
    async () => {
      const ids = [...new Set(criados)];
      await prisma.comanda.deleteMany({ where: { clienteId: { in: ids } } });
      const del = await prisma.cliente.deleteMany({ where: { id: { in: ids } } });
      return { message: `${del.count} cliente(s) de teste removido(s)`, expected: 'cleanup', actual: String(del.count) };
    },
  );
}
