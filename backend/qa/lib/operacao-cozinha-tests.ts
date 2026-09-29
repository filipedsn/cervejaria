import { api, login } from './http.js';
import type { ConfigTenantFixture, QaContext } from './types.js';

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

interface PedidoCozinha {
  id: string;
  status: string;
  itens?: Array<{ id: string; cancelamentoPendente?: boolean }>;
  statusDesde?: string;
  entregueEm?: string | null;
  createdAt?: string;
}

/** Transições reversas, cancelamento no meio do preparo e escopo da fila. */
export async function runQuiosqueCozinhaTests(ctx: QaContext, test: TestFn) {
  const cfg: ConfigTenantFixture | undefined = ctx.configTenants?.find((c) => c.code === 'QUIOSQUE-01');
  if (!cfg?.produtoId || !cfg.produtoPreparoId) {
    await test(
      { id: 'QCZ-00', category: 'Quiosque cozinha', name: 'Seed QUIOSQUE-01', requirement: 'QCZ' },
      async () => ({ status: 'failed', message: 'QUIOSQUE-01 ausente ou incompleto no contexto' }),
    );
    return;
  }

  const stamp = Date.now();
  let pontoId = '';
  let atendenteToken = '';
  let comandaId = '';
  let pedidoId = '';
  let pedidoBebidaId = '';

  async function setStatus(id: string, status: string, token = cfg.donoToken) {
    return api<PedidoCozinha & { error?: string }>('PATCH', `/api/operacao/cozinha/${id}/status`, {
      token,
      body: { status },
    });
  }

  await test(
    { id: 'QCZ-01', category: 'Quiosque cozinha', name: 'Setup ponto, caixa e comanda com preparo', requirement: 'QCZ-01' },
    async () => {
      const ponto = await api<{ id: string }>('POST', '/api/operacao/pontos-venda', {
        token: cfg.donoToken,
        body: { nome: `Cozinha QA ${stamp}` },
      });
      if (ponto.status !== 201 || !ponto.data?.id) {
        return { status: 'failed', message: 'Criar ponto', expected: '201', actual: String(ponto.status) };
      }
      pontoId = ponto.data.id;

      const caixa = await api('POST', '/api/operacao/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, trocoInicial: 100 },
      });
      if (caixa.status !== 201) {
        return { status: 'failed', message: 'Abrir caixa', expected: '201', actual: String(caixa.status) };
      }

      atendenteToken = await login(`${cfg.slug}-a1@qa.test`, 'qa123456');

      const comanda = await api<{ id: string; pedidos?: Array<{ id: string }> }>('POST', '/api/operacao/comandas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          tipo: 'MESA',
          identificador: `COZ-${stamp}`,
          itens: [{ produtoId: cfg.produtoPreparoId, quantidade: 2 }],
        },
      });
      if (comanda.status !== 201 || !comanda.data?.id) {
        return { status: 'failed', message: 'Comanda com preparo', expected: '201', actual: String(comanda.status) };
      }
      comandaId = comanda.data.id;
      pedidoId = comanda.data.pedidos?.[0]?.id ?? '';
      if (!pedidoId) return { status: 'failed', message: 'Pedido de preparo não criado' };

      return { message: `Pedido ${pedidoId} na fila`, expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'QCZ-02', category: 'Quiosque cozinha', name: 'ATENDENTE avança status da fila', requirement: 'QCZ-02' },
    async () => {
      if (!pedidoId) return { status: 'failed', message: 'QCZ-01 incompleto' };
      if (!atendenteToken) return { status: 'skipped', message: 'Token de atendente indisponível' };
      const r = await setStatus(pedidoId, 'EM_PREPARO', atendenteToken);
      if (r.status !== 200 || r.data?.status !== 'EM_PREPARO') {
        return { status: 'failed', message: 'Avançar para EM_PREPARO', expected: '200 EM_PREPARO', actual: `${r.status} ${r.data?.status}` };
      }
      return { message: 'ATENDENTE opera a fila', expected: 'EM_PREPARO', actual: r.data.status };
    },
  );

  await test(
    { id: 'QCZ-03', category: 'Quiosque cozinha', name: 'ATENDENTE não cancela pedido → 403', requirement: 'QCZ-03' },
    async () => {
      if (!pedidoId) return { status: 'failed', message: 'QCZ-01 incompleto' };
      if (!atendenteToken) return { status: 'skipped', message: 'Token de atendente indisponível' };
      const r = await setStatus(pedidoId, 'CANCELAMENTO_PENDENTE', atendenteToken);
      if (r.status !== 403) {
        return { status: 'failed', message: 'ATENDENTE cancelou pedido', expected: '403', actual: String(r.status) };
      }
      return { message: 'Cancelamento restrito ao DONO', expected: '403', actual: '403' };
    },
  );

  await test(
    { id: 'QCZ-04', category: 'Quiosque cozinha', name: 'Transição reversa EM_PREPARO → RECEBIDO', requirement: 'QCZ-04' },
    async () => {
      if (!pedidoId) return { status: 'failed', message: 'QCZ-01 incompleto' };
      const volta = await setStatus(pedidoId, 'RECEBIDO');
      if (volta.status !== 200 || volta.data?.status !== 'RECEBIDO') {
        return { status: 'failed', message: 'Voltar para RECEBIDO', expected: '200 RECEBIDO', actual: `${volta.status} ${volta.data?.status}` };
      }
      const frente = await setStatus(pedidoId, 'EM_PREPARO');
      if (frente.status !== 200) {
        return { status: 'failed', message: 'Retomar EM_PREPARO', expected: '200', actual: String(frente.status) };
      }
      return { message: 'Correção de toque permitida', expected: 'RECEBIDO', actual: 'RECEBIDO' };
    },
  );

  await test(
    { id: 'QCZ-05', category: 'Quiosque cozinha', name: 'Salto RECEBIDO → ENTREGUE bloqueado → 409', requirement: 'QCZ-05' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCZ-01 incompleto' };
      const comanda = await api<{ id: string; pedidos?: Array<{ id: string }> }>('POST', '/api/operacao/comandas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          tipo: 'FICHA',
          identificador: `SALTO-${stamp}`,
          itens: [{ produtoId: cfg.produtoPreparoId, quantidade: 1 }],
        },
      });
      const novo = comanda.data?.pedidos?.[0]?.id;
      if (comanda.status !== 201 || !novo) {
        return { status: 'failed', message: 'Setup comanda salto', expected: '201', actual: String(comanda.status) };
      }
      const r = await setStatus(novo, 'ENTREGUE');
      if (r.status !== 409) {
        return { status: 'failed', message: 'Salto de status', expected: '409', actual: String(r.status) };
      }
      return { message: 'Fila respeita a máquina de estados', expected: '409', actual: '409' };
    },
  );

  await test(
    { id: 'QCZ-06', category: 'Quiosque cozinha', name: 'DONO cancela pedido em preparo', requirement: 'QCZ-06' },
    async () => {
      if (!pedidoId) return { status: 'failed', message: 'QCZ-01 incompleto' };
      const r = await setStatus(pedidoId, 'CANCELAMENTO_PENDENTE');
      if (r.status !== 200 || r.data?.status !== 'CANCELAMENTO_PENDENTE') {
        return { status: 'failed', message: 'Solicitar cancelamento em preparo', expected: '200 CANCELAMENTO_PENDENTE', actual: `${r.status} ${r.data?.status}` };
      }

      const itensPendentes = r.data.itens?.filter((item) => item.cancelamentoPendente) ?? [];
      if (itensPendentes.length === 0) {
        return { status: 'failed', message: 'Pedido sem itens pendentes de confirmação', expected: 'ao menos 1 item', actual: '0' };
      }
      for (const item of itensPendentes) {
        const confirmacao = await api('PATCH', `/api/operacao/cozinha/${pedidoId}/itens/${item.id}/confirmar-cancelamento`, {
          token: cfg.donoToken,
        });
        if (confirmacao.status !== 200) {
          return { status: 'failed', message: 'Confirmar cancelamento do item', expected: '200', actual: `${confirmacao.status} ${confirmacao.raw.slice(0, 100)}` };
        }
      }

      const fila = await api<PedidoCozinha[]>('GET', '/api/operacao/cozinha', { token: cfg.donoToken });
      if (fila.data?.some((p) => p.id === pedidoId)) {
        return { status: 'failed', message: 'Pedido confirmado cancelado ainda na fila', expected: 'fora da fila', actual: 'presente' };
      }
      return { message: 'Confirmação do item conclui e remove o cancelamento', expected: 'CANCELADO', actual: 'CANCELADO' };
    },
  );

  await test(
    { id: 'QCZ-07', category: 'Quiosque cozinha', name: 'CANCELADO é terminal → 409', requirement: 'QCZ-07' },
    async () => {
      if (!pedidoId) return { status: 'failed', message: 'QCZ-01 incompleto' };
      const r = await setStatus(pedidoId, 'EM_PREPARO');
      if (r.status !== 409) {
        return { status: 'failed', message: 'Ressuscitar cancelado', expected: '409', actual: String(r.status) };
      }
      return { message: 'Cancelamento é irreversível', expected: '409', actual: '409' };
    },
  );

  await test(
    { id: 'QCZ-08', category: 'Quiosque cozinha', name: 'Pedido só de bebida fica fora da fila', requirement: 'QCZ-08' },
    async () => {
      if (!comandaId) return { status: 'failed', message: 'QCZ-01 incompleto' };
      const pedido = await api<{ pedidos?: Array<{ id: string }> }>('POST', `/api/operacao/comandas/${comandaId}/pedidos`, {
        token: cfg.donoToken,
        body: { itens: [{ produtoId: cfg.produtoId, quantidade: 1 }] },
      });
      if (pedido.status !== 201) {
        return { status: 'failed', message: 'Pedido de bebida', expected: '201', actual: String(pedido.status) };
      }
      const pedidos = pedido.data?.pedidos ?? [];
      pedidoBebidaId = pedidos[pedidos.length - 1]?.id ?? '';

      const fila = await api<PedidoCozinha[]>('GET', '/api/operacao/cozinha', { token: cfg.donoToken });
      if (pedidoBebidaId && fila.data?.some((p) => p.id === pedidoBebidaId)) {
        return { status: 'failed', message: 'Bebida ocupou a cozinha', expected: 'fora da fila', actual: 'presente' };
      }
      return { message: 'Rodada de bebida não vai à cozinha', expected: 'fora da fila', actual: 'ausente' };
    },
  );

  await test(
    { id: 'QCZ-09', category: 'Quiosque cozinha', name: 'Status em pedido sem preparo → 404', requirement: 'QCZ-09' },
    async () => {
      if (!pedidoBebidaId) return { status: 'skipped', message: 'QCZ-08 não identificou o pedido de bebida' };
      const r = await setStatus(pedidoBebidaId, 'EM_PREPARO');
      if (r.status !== 404) {
        return { status: 'failed', message: 'Pedido de bebida na cozinha', expected: '404', actual: String(r.status) };
      }
      return { message: 'Rota rejeita pedido fora da cozinha', expected: '404', actual: '404' };
    },
  );

  await test(
    { id: 'QCZ-10', category: 'Quiosque cozinha', name: 'Item de cozinha só entra no total após entrega e bloqueia pagamento enquanto pendente', requirement: 'QCZ-10' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCZ-01 incompleto' };
      const comanda = await api<{ id: string; total: number; pedidos?: Array<{ id: string }> }>(
        'POST',
        '/api/operacao/comandas',
        {
          token: cfg.donoToken,
          body: {
            pontoVendaId: pontoId,
            tipo: 'APELIDO',
            identificador: `PAGA-${stamp}`,
            itens: [{ produtoId: cfg.produtoPreparoId, quantidade: 1 }],
          },
        },
      );
      const novo = comanda.data?.pedidos?.[0]?.id;
      if (comanda.status !== 201 || !novo) {
        return { status: 'failed', message: 'Setup comanda paga', expected: '201', actual: String(comanda.status) };
      }
      if (comanda.data.total !== 0) {
        return {
          status: 'failed',
          message: 'Item pendente não pode entrar no total cobrável',
          expected: '0 antes da entrega',
          actual: String(comanda.data.total),
        };
      }

      const pagarAntes = await api('POST', `/api/operacao/comandas/${comanda.data.id}/pagamentos`, {
        token: cfg.donoToken,
        body: { pagamentos: [{ forma: 'PIX', valor: 1 }] },
      });
      if (pagarAntes.status !== 409 || !pagarAntes.data?.error?.includes('cozinha')) {
        return {
          status: 'failed',
          message: 'Cobrar antes da entrega',
          expected: '409 cozinha',
          actual: `${pagarAntes.status} ${pagarAntes.data?.error ?? ''}`,
        };
      }

      const preparo = await setStatus(novo, 'EM_PREPARO');
      if (preparo.status !== 200) {
        return { status: 'failed', message: 'Marcar em preparo', expected: '200', actual: String(preparo.status) };
      }

      const entrega = await setStatus(novo, 'PRONTO');
      if (entrega.status !== 200) {
        return { status: 'failed', message: 'Marcar pronto', expected: '200', actual: String(entrega.status) };
      }
      const entregue = await setStatus(novo, 'ENTREGUE');
      if (entregue.status !== 200) {
        return { status: 'failed', message: 'Marcar entregue', expected: '200', actual: String(entregue.status) };
      }

      const detalhe = await api<{ total: number }>('GET', `/api/operacao/comandas/${comanda.data.id}`, {
        token: cfg.donoToken,
      });
      if (!detalhe.data?.total || detalhe.data.total <= 0) {
        return {
          status: 'failed',
          message: 'Total após entrega',
          expected: '> 0',
          actual: String(detalhe.data?.total),
        };
      }

      const pagar = await api('POST', `/api/operacao/comandas/${comanda.data.id}/pagamentos`, {
        token: cfg.donoToken,
        body: { pagamentos: [{ forma: 'PIX', valor: detalhe.data.total }] },
      });
      if (pagar.status !== 200) {
        return { status: 'failed', message: 'Fechar comanda após entrega', expected: '200', actual: String(pagar.status) };
      }

      const r = await setStatus(novo, 'CANCELAMENTO_PENDENTE');
      if (r.status !== 409 || !r.data?.error?.includes('já foi fechada')) {
        return {
          status: 'failed',
          message: 'Cancelar pedido de comanda paga',
          expected: '409 comanda já foi fechada',
          actual: `${r.status} ${r.data?.error ?? ''}`,
        };
      }
      return { message: 'Pagamento liberado após ENTREGUE', expected: '200', actual: '200' };
    },
  );

  await test(
    {
      id: 'QCZ-11',
      category: 'Quiosque cozinha',
      name: 'Cronômetro registra transições e congela na entrega',
      requirement: 'QCZ-11',
    },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCZ-01 incompleto' };

      const comanda = await api<{ pedidos?: Array<{ id: string }> }>('POST', '/api/operacao/comandas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          tipo: 'FICHA',
          identificador: `CRON-${stamp}`,
          itens: [{ produtoId: cfg.produtoPreparoId, quantidade: 1 }],
        },
      });
      const cronId = comanda.data?.pedidos?.[0]?.id;
      if (comanda.status !== 201 || !cronId) {
        return { status: 'failed', message: 'Setup pedido cronômetro', expected: '201', actual: String(comanda.status) };
      }

      const fila0 = await api<PedidoCozinha[]>('GET', '/api/operacao/cozinha', { token: cfg.donoToken });
      const p0 = fila0.data?.find((p) => p.id === cronId);
      if (!p0?.statusDesde) {
        return { status: 'failed', message: 'statusDesde inicial', expected: 'definido', actual: 'ausente' };
      }

      const prep = await setStatus(cronId, 'EM_PREPARO');
      if (prep.status !== 200 || !prep.data?.statusDesde) {
        return { status: 'failed', message: 'EM_PREPARO', expected: '200 + statusDesde', actual: String(prep.status) };
      }
      if (prep.data.statusDesde === p0.statusDesde) {
        return {
          status: 'failed',
          message: 'statusDesde reinicia na transição',
          expected: 'timestamp novo',
          actual: prep.data.statusDesde,
        };
      }

      await setStatus(cronId, 'PRONTO');
      const entregue = await setStatus(cronId, 'ENTREGUE');
      if (entregue.status !== 200 || !entregue.data?.entregueEm) {
        return {
          status: 'failed',
          message: 'entregueEm na entrega',
          expected: 'preenchido',
          actual: entregue.data?.entregueEm ?? 'null',
        };
      }

      const fila1 = await api<PedidoCozinha[]>('GET', '/api/operacao/cozinha?incluirEntregues=true', {
        token: cfg.donoToken,
      });
      const p1 = fila1.data?.find((p) => p.id === cronId);
      if (!p1?.entregueEm) {
        return { status: 'failed', message: 'entregueEm persistido', expected: 'definido', actual: 'ausente' };
      }

      return { message: 'Cronômetro congelado na entrega', expected: 'entregueEm', actual: p1.entregueEm };
    },
  );
}
