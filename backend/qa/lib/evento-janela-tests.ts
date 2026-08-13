import { prisma } from '../../src/lib/prisma.js';
import { REABRIR_JANELA_MS, REABRIR_PRAZO_EXPIRADO_MSG } from '../../src/lib/evento-utils.js';
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

/** Formata no fuso local — toISOString viraria o dia em UTC-3 depois das 21h. */
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Data (YYYY-MM-DD) do próximo dia da semana pedido, com deslocamento em semanas. */
function proximaDataDoDiaSemana(diaSemana: number, semanasAdiante = 0): string {
  const hoje = new Date();
  const delta = (diaSemana - hoje.getDay() + 7) % 7 || 7;
  const alvo = new Date(hoje);
  alvo.setDate(hoje.getDate() + delta + semanasAdiante * 7);
  return dateKey(alvo);
}

/** Janela de 30 min para reabrir e ciclo de cancelamento de agendamento. */
export async function runEventoJanelaTests(ctx: QaContext, test: TestFn) {
  const tenant: TenantFixture | undefined = ctx.tenants[9] ?? ctx.tenants[2];
  if (!tenant) {
    await test(
      { id: 'EVJ-01', category: 'Janela de evento', name: 'Seed EVJ', requirement: 'EVJ' },
      async () => ({ status: 'failed', message: 'Tenant indisponível' }),
    );
    return;
  }

  const stamp = Date.now();
  let serieId = '';
  const diaSemanaSerie = (new Date().getDay() + 3) % 7;

  /** O evento só fecha com a casa vazia; comandas de outras suítes ficam abertas. */
  async function limparComandasAbertas() {
    await prisma.comanda.updateMany({
      where: { eventoId: tenant.eventoId, status: 'ABERTA' },
      data: { status: 'CANCELADA' },
    });
  }

  await test(
    { id: 'EVJ-01', category: 'Janela de evento', name: 'Reabrir dentro da janela de 30 min', requirement: 'EVJ-01' },
    async () => {
      await ensureTenantEventoAberto(tenant);
      await limparComandasAbertas();

      const fechar = await api('PATCH', `/api/eventos/${tenant.eventoId}/fechar`, { token: tenant.donoToken });
      if (fechar.status !== 200) {
        return { status: 'failed', message: 'Fechar evento', expected: '200', actual: `${fechar.status} ${fechar.raw.slice(0, 120)}` };
      }

      const reabrir = await api<{ status?: string }>('PATCH', `/api/eventos/${tenant.eventoId}/reabrir`, {
        token: tenant.donoToken,
      });
      if (reabrir.status !== 200) {
        return { status: 'failed', message: 'Reabrir', expected: '200', actual: `${reabrir.status} ${reabrir.raw.slice(0, 120)}` };
      }
      return { message: 'Reabertura imediata permitida', expected: '200', actual: '200' };
    },
  );

  await test(
    { id: 'EVJ-02', category: 'Janela de evento', name: 'Reabrir após 30 min → 400 com prazo expirado', requirement: 'EVJ-02' },
    async () => {
      await limparComandasAbertas();
      const fechar = await api('PATCH', `/api/eventos/${tenant.eventoId}/fechar`, { token: tenant.donoToken });
      if (fechar.status !== 200) {
        return { status: 'failed', message: 'Fechar evento', expected: '200', actual: String(fechar.status) };
      }

      // Empurra o encerramento para fora da janela sem esperar 30 minutos reais.
      const expirado = new Date(Date.now() - REABRIR_JANELA_MS - 60_000);
      await prisma.evento.update({ where: { id: tenant.eventoId }, data: { encerradoEm: expirado } });

      const r = await api<{ error?: string }>('PATCH', `/api/eventos/${tenant.eventoId}/reabrir`, {
        token: tenant.donoToken,
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Reabrir fora da janela', expected: '400', actual: String(r.status) };
      }
      if (r.data?.error !== REABRIR_PRAZO_EXPIRADO_MSG) {
        return { status: 'failed', message: 'Mensagem do prazo', expected: REABRIR_PRAZO_EXPIRADO_MSG, actual: r.data?.error ?? '' };
      }
      return { message: 'Prazo de 30 min aplicado', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'EVJ-03', category: 'Janela de evento', name: 'Reabertura volta a valer dentro da janela', requirement: 'EVJ-03' },
    async () => {
      // Traz o encerramento de volta para dentro da janela.
      await prisma.evento.update({
        where: { id: tenant.eventoId },
        data: { encerradoEm: new Date(Date.now() - 60_000) },
      });
      const r = await api('PATCH', `/api/eventos/${tenant.eventoId}/reabrir`, { token: tenant.donoToken });
      if (r.status !== 200) {
        return { status: 'failed', message: 'Reabrir dentro da janela', expected: '200', actual: `${r.status} ${r.raw.slice(0, 120)}` };
      }
      await ensureTenantEventoAberto(tenant);
      return { message: 'Janela é a única barreira', expected: '200', actual: '200' };
    },
  );

  await test(
    { id: 'EVJ-04', category: 'Janela de evento', name: 'Criar agenda semanal', requirement: 'EVJ-04' },
    async () => {
      const r = await api<{ id: string; diaSemana?: number }>('POST', '/api/eventos', {
        token: tenant.donoToken,
        body: {
          nome: `Agenda QA ${stamp}`,
          local: 'Local QA',
          horaInicio: '05:00',
          horaFim: '06:00',
          recorrencia: 'SEMANAL',
          diaSemana: diaSemanaSerie,
          trailerId: tenant.trailerId,
        },
      });
      if (r.status !== 201 || !r.data?.id) {
        return { status: 'failed', message: 'Criar agenda', expected: '201', actual: `${r.status} ${r.raw.slice(0, 140)}` };
      }
      serieId = r.data.id;
      return { message: `Agenda semanal ${serieId}`, expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'EVJ-05', category: 'Janela de evento', name: 'Agenda semanal sem diaSemana → 400', requirement: 'EVJ-05' },
    async () => {
      const r = await api('POST', '/api/eventos', {
        token: tenant.donoToken,
        body: {
          nome: `Agenda Inválida ${stamp}`,
          local: 'Local QA',
          horaInicio: '07:00',
          recorrencia: 'SEMANAL',
          trailerId: tenant.trailerId,
        },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Agenda sem dia da semana', expected: '400', actual: String(r.status) };
      }
      return { message: 'diaSemana obrigatório em SEMANAL', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'EVJ-06', category: 'Janela de evento', name: 'Cancelar data fora do dia da agenda → 400', requirement: 'EVJ-06' },
    async () => {
      if (!serieId) return { status: 'failed', message: 'EVJ-04 incompleto' };
      const outroDia = proximaDataDoDiaSemana((diaSemanaSerie + 1) % 7);
      const r = await api<{ error?: string }>('POST', `/api/eventos/${serieId}/cancelar-agendamento`, {
        token: tenant.donoToken,
        body: { data: outroDia },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Data de outro dia da semana', expected: '400', actual: String(r.status) };
      }
      return { message: 'Data precisa bater com o dia da agenda', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'EVJ-07', category: 'Janela de evento', name: 'Cancelar data passada → 400', requirement: 'EVJ-07' },
    async () => {
      if (!serieId) return { status: 'failed', message: 'EVJ-04 incompleto' };
      // Mesma weekday da agenda, porém no passado.
      const passado = new Date();
      passado.setDate(passado.getDate() - ((passado.getDay() - diaSemanaSerie + 7) % 7 || 7));
      const r = await api('POST', `/api/eventos/${serieId}/cancelar-agendamento`, {
        token: tenant.donoToken,
        body: { data: dateKey(passado) },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Cancelamento retroativo', expected: '400', actual: String(r.status) };
      }
      return { message: 'Passado não se cancela', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'EVJ-08', category: 'Janela de evento', name: 'Cancelar agendamento futuro → 201', requirement: 'EVJ-08' },
    async () => {
      if (!serieId) return { status: 'failed', message: 'EVJ-04 incompleto' };
      const data = proximaDataDoDiaSemana(diaSemanaSerie);
      const r = await api<{ serieId?: string; data?: string }>('POST', `/api/eventos/${serieId}/cancelar-agendamento`, {
        token: tenant.donoToken,
        body: { data },
      });
      if (r.status !== 201 || r.data?.data !== data) {
        return {
          status: 'failed',
          message: 'Cancelar agendamento',
          expected: `201 ${data}`,
          actual: `${r.status} ${r.data?.data ?? r.raw.slice(0, 100)}`,
        };
      }

      const exclusao = await prisma.eventoSerieExclusao.findFirst({
        where: { serieId, cervejariaId: tenant.cervejariaId },
      });
      if (!exclusao) return { status: 'failed', message: 'Exclusão não persistida' };
      return { message: `Sessão de ${data} cancelada`, expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'EVJ-09', category: 'Janela de evento', name: 'Cancelamento é idempotente', requirement: 'EVJ-09' },
    async () => {
      if (!serieId) return { status: 'failed', message: 'EVJ-04 incompleto' };
      const data = proximaDataDoDiaSemana(diaSemanaSerie);
      const r = await api('POST', `/api/eventos/${serieId}/cancelar-agendamento`, {
        token: tenant.donoToken,
        body: { data },
      });
      if (r.status !== 201) {
        return { status: 'failed', message: 'Segundo cancelamento', expected: '201', actual: String(r.status) };
      }
      const total = await prisma.eventoSerieExclusao.count({ where: { serieId } });
      if (total !== 1) {
        return { status: 'failed', message: 'Exclusões duplicadas', expected: '1', actual: String(total) };
      }
      return { message: 'Upsert evita duplicata', expected: '1', actual: '1' };
    },
  );

  await test(
    { id: 'EVJ-10', category: 'Janela de evento', name: 'Cancelar agenda de outro tenant → 404', requirement: 'EVJ-10' },
    async () => {
      if (!serieId) return { status: 'failed', message: 'EVJ-04 incompleto' };
      const outro = ctx.tenants.find((t) => t.cervejariaId !== tenant.cervejariaId);
      if (!outro) return { status: 'skipped', message: 'Sem segundo tenant' };
      const r = await api('POST', `/api/eventos/${serieId}/cancelar-agendamento`, {
        token: outro.donoToken,
        body: { data: proximaDataDoDiaSemana(diaSemanaSerie, 1) },
      });
      if (r.status !== 404) {
        return { status: 'failed', message: 'Agenda de outro tenant', expected: '404', actual: String(r.status) };
      }
      return { message: 'Agenda isolada por tenant', expected: '404', actual: '404' };
    },
  );

  await test(
    { id: 'EVJ-11', category: 'Janela de evento', name: 'Cancelar agendamento em ID de sessão → 404', requirement: 'EVJ-11' },
    async () => {
      const r = await api('POST', `/api/eventos/${tenant.eventoId}/cancelar-agendamento`, {
        token: tenant.donoToken,
        body: { data: proximaDataDoDiaSemana(diaSemanaSerie) },
      });
      if (r.status !== 404) {
        return { status: 'failed', message: 'Sessão tratada como agenda', expected: '404', actual: String(r.status) };
      }
      return { message: 'Rota só aceita série recorrente', expected: '404', actual: '404' };
    },
  );

  await test(
    { id: 'EVJ-12', category: 'Janela de evento', name: 'Limpeza da agenda criada', requirement: 'EVJ-12' },
    async () => {
      if (!serieId) return { status: 'skipped', message: 'Nada a limpar' };
      await prisma.eventoSerieExclusao.deleteMany({ where: { serieId } });
      await prisma.evento.deleteMany({ where: { id: serieId } });
      const restante = await prisma.evento.count({ where: { id: serieId } });
      if (restante !== 0) {
        return { status: 'failed', message: 'Agenda não removida', expected: '0', actual: String(restante) };
      }
      return { message: 'Agenda de teste removida', expected: '0', actual: '0' };
    },
  );
}
