import { prisma } from '../../src/lib/prisma.js';
import { api } from './http.js';
import { ensureTenantEventoAberto } from './tenant-evento.js';
import type { TenantFixture } from './types.js';

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

/** Posicionar, trocar, remover chope no tap + histórico TransacaoLog. */
export async function runTapMontagemTests(tenant: TenantFixture, test: TestFn) {
  const stamp = Date.now();
  let tapId = tenant.tapId;
  let chopeAltId = '';

  await test(
    { id: 'TAP-M-01', category: 'Montagem taps', name: 'GET /eventos/:id/taps lista montagem', requirement: 'TAP-M-01' },
    async () => {
      await ensureTenantEventoAberto(tenant);
      await prisma.tap.update({
        where: { id: tenant.tapId },
        data: { produtoId: tenant.produtoId, ativo: true },
      });
      const r = await api<Array<{ id: string; chopeAtual?: { id: string; nome: string } | null }>>(
        'GET',
        `/api/eventos/${tenant.eventoId}/taps`,
        { token: tenant.donoToken },
      );
      if (r.status !== 200 || !Array.isArray(r.data) || r.data.length === 0) {
        return { status: 'failed', message: 'Listar taps', expected: '200 array', actual: String(r.status) };
      }
      const tap = r.data.find((t) => t.id === tapId) ?? r.data[0];
      tapId = tap.id;
      if (!tap.chopeAtual?.id) {
        return { status: 'failed', message: 'Tap sem chopeAtual', expected: 'chope montado', actual: 'null' };
      }
      return { message: `Tap ${tapId} · ${tap.chopeAtual.nome}`, expected: 'chopeAtual', actual: tap.chopeAtual.id };
    },
  );

  await test(
    { id: 'TAP-M-02', category: 'Montagem taps', name: 'Setup segundo chope para troca', requirement: 'TAP-M-02' },
    async () => {
      const r = await api<{ id: string }>('POST', '/api/produtos', {
        token: tenant.donoToken,
        body: {
          nome: `IPA QA ${stamp}`,
          tipo: 'BEBIDA',
          formato: 'CHOPE',
          precos: [{ volumeMl: 500, preco: 18 }],
        },
      });
      if (r.status !== 201 || !r.data?.id) {
        return { status: 'failed', message: 'Criar chope alt', expected: '201', actual: String(r.status) };
      }
      chopeAltId = r.data.id;

      const tapRow = await prisma.tap.findFirst({
        where: { id: tapId, cervejariaId: tenant.cervejariaId },
        select: { trailerId: true, numero: true },
      });
      if (!tapRow) return { status: 'failed', message: 'Tap não encontrado' };

      await prisma.tap.update({
        where: { id: tapId },
        data: { produtoId: chopeAltId },
      });

      return { message: chopeAltId, expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'TAP-M-03', category: 'Montagem taps', name: 'PUT posiciona chope no tap', requirement: 'TAP-M-03' },
    async () => {
      if (!chopeAltId) return { status: 'failed', message: 'TAP-M-02 incompleto' };
      await ensureTenantEventoAberto(tenant);

      const antes = await prisma.tapMontagem.count({
        where: { eventoId: tenant.eventoId, tapId, encerradoEm: null },
      });

      const r = await api<{ taps?: Array<{ id: string; chopeAtual?: { id: string } | null }>; message?: string }>(
        'PUT',
        `/api/eventos/${tenant.eventoId}/taps/${tapId}/chope`,
        { token: tenant.donoToken, body: { produtoId: chopeAltId } },
      );
      if (r.status !== 200) {
        return { status: 'failed', message: 'Posicionar chope', expected: '200', actual: `${r.status} ${r.raw.slice(0, 120)}` };
      }
      const tap = r.data?.taps?.find((t) => t.id === tapId);
      if (tap?.chopeAtual?.id !== chopeAltId) {
        return {
          status: 'failed',
          message: 'chopeAtual após PUT',
          expected: chopeAltId,
          actual: tap?.chopeAtual?.id ?? 'null',
        };
      }

      const historico = await prisma.tapMontagem.count({ where: { eventoId: tenant.eventoId, tapId } });
      if (historico <= antes) {
        return { status: 'failed', message: 'Histórico montagem', expected: '> antes', actual: String(historico) };
      }

      return { message: r.data?.message ?? 'OK', expected: chopeAltId, actual: tap.chopeAtual.id };
    },
  );

  await test(
    { id: 'TAP-M-04', category: 'Montagem taps', name: 'TransacaoLog TAP_CHOPE_POSICIONADO', requirement: 'TAP-M-04' },
    async () => {
      const logs = await api<Array<{ tipo: string; metadata?: Record<string, unknown> }>>(
        'GET',
        `/api/eventos/${tenant.eventoId}/transacoes?limit=30`,
        { token: tenant.donoToken },
      );
      if (logs.status !== 200 || !Array.isArray(logs.data)) {
        return {
          status: 'failed',
          message: 'Listagem transações',
          expected: '200 array',
          actual: `${logs.status} ${typeof logs.data}`,
        };
      }
      const hit = logs.data.find((l) => l.tipo === 'TAP_CHOPE_POSICIONADO');
      if (!hit) {
        return {
          status: 'failed',
          message: 'Log posicionamento',
          expected: 'TAP_CHOPE_POSICIONADO',
          actual: logs.data.map((l) => l.tipo).join(', '),
        };
      }
      return { message: 'Log registrado', expected: 'TAP_CHOPE_POSICIONADO', actual: hit.tipo };
    },
  );

  await test(
    { id: 'TAP-M-04a', category: 'Montagem taps', name: 'DELETE produto com histórico de tap → 409', requirement: 'TAP-M-04' },
    async () => {
      const r = await api<{ error?: string }>('DELETE', `/api/produtos/${chopeAltId}`, { token: tenant.donoToken });
      if (r.status !== 409) {
        return { status: 'failed', message: 'Excluir chope com histórico', expected: '409', actual: `${r.status} ${r.raw.slice(0, 120)}` };
      }
      if (!r.data?.error?.includes('montagem de um tap')) {
        return { status: 'failed', message: 'Mensagem de bloqueio', expected: 'histórico de tap', actual: r.data?.error ?? r.raw };
      }
      return { message: r.data.error, expected: '409', actual: '409' };
    },
  );

  await test(
    { id: 'TAP-M-05', category: 'Montagem taps', name: 'Produto não-chope → 400', requirement: 'TAP-M-05' },
    async () => {
      const lata = await api<{ id: string }>('POST', '/api/produtos', {
        token: tenant.donoToken,
        body: {
          nome: `Lata tap ${stamp}`,
          tipo: 'BEBIDA',
          formato: 'LATA',
          precos: [{ volumeMl: 350, preco: 8 }],
        },
      });
      if (lata.status !== 201 || !lata.data?.id) {
        return { status: 'failed', message: 'Setup lata', expected: '201', actual: String(lata.status) };
      }

      const r = await api('PUT', `/api/eventos/${tenant.eventoId}/taps/${tapId}/chope`, {
        token: tenant.donoToken,
        body: { produtoId: lata.data.id },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Lata no tap', expected: '400', actual: String(r.status) };
      }
      return { message: 'Apenas chope no tap', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'TAP-M-06', category: 'Montagem taps', name: 'DELETE remove chope do tap', requirement: 'TAP-M-06' },
    async () => {
      await ensureTenantEventoAberto(tenant);
      const r = await api<Array<{ id: string; chopeAtual?: unknown; temMontagemAtiva?: boolean }>>(
        'DELETE',
        `/api/eventos/${tenant.eventoId}/taps/${tapId}/chope`,
        { token: tenant.donoToken },
      );
      if (r.status !== 200) {
        return { status: 'failed', message: 'Remover chope', expected: '200', actual: String(r.status) };
      }
      const tap = r.data?.find((t) => t.id === tapId);
      if (tap?.temMontagemAtiva) {
        return { status: 'failed', message: 'Montagem encerrada', expected: 'false', actual: 'true' };
      }
      return { message: 'Chope removido', expected: 'sem montagem', actual: 'OK' };
    },
  );

  await test(
    { id: 'TAP-M-07', category: 'Montagem taps', name: 'TransacaoLog TAP_CHOPE_REMOVIDO', requirement: 'TAP-M-07' },
    async () => {
      const logs = await api<Array<{ tipo: string }>>(
        'GET',
        `/api/eventos/${tenant.eventoId}/transacoes?limit=40`,
        { token: tenant.donoToken },
      );
      if (logs.status !== 200 || !Array.isArray(logs.data)) {
        return {
          status: 'failed',
          message: 'Listagem transações',
          expected: '200 array',
          actual: `${logs.status} ${typeof logs.data}`,
        };
      }
      const hit = logs.data.find((l) => l.tipo === 'TAP_CHOPE_REMOVIDO');
      if (!hit) {
        return {
          status: 'failed',
          message: 'Log remoção',
          expected: 'TAP_CHOPE_REMOVIDO',
          actual: logs.data.map((l) => l.tipo).join(', '),
        };
      }
      return { message: 'Log registrado', expected: 'TAP_CHOPE_REMOVIDO', actual: hit.tipo };
    },
  );

  await test(
    { id: 'TAP-M-08', category: 'Montagem taps', name: 'PATCH ativo=false encerra montagem', requirement: 'TAP-M-08' },
    async () => {
      await ensureTenantEventoAberto(tenant);

      await api('PUT', `/api/eventos/${tenant.eventoId}/taps/${tapId}/chope`, {
        token: tenant.donoToken,
        body: { produtoId: chopeAltId || tenant.produtoId },
      });

      const off = await api('PATCH', `/api/eventos/${tenant.eventoId}/taps/${tapId}/ativo`, {
        token: tenant.donoToken,
        body: { ativo: false },
      });
      if (off.status !== 200) {
        return { status: 'failed', message: 'Desativar tap', expected: '200', actual: String(off.status) };
      }

      const ativos = await prisma.tapMontagem.count({
        where: { eventoId: tenant.eventoId, tapId, encerradoEm: null },
      });
      if (ativos > 0) {
        return { status: 'failed', message: 'Montagem encerrada ao desativar', expected: '0', actual: String(ativos) };
      }

      await api('PATCH', `/api/eventos/${tenant.eventoId}/taps/${tapId}/ativo`, {
        token: tenant.donoToken,
        body: { ativo: true },
      });

      // TAP-M-02 trocou o chope cadastrado do tap; restaura para não quebrar RNF-04 e demais suítes.
      await prisma.tap.update({ where: { id: tapId }, data: { produtoId: tenant.produtoId } });
      await api('PUT', `/api/eventos/${tenant.eventoId}/taps/${tapId}/chope`, {
        token: tenant.donoToken,
        body: { produtoId: tenant.produtoId },
      });

      return { message: 'Tap reativado e chope original restaurado', expected: '0 montagens ativas', actual: String(ativos) };
    },
  );
}
