import { api } from './http.js';
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

interface ResumoComanda {
  id: string;
  tipo: string;
  identificador: string | null;
  status: string;
  subtotal: number;
  desconto: number;
  total: number;
  pago: number;
  saldo: number;
  pagamentos: Array<{ forma: string; valor: number; valorRecebido: number | null; troco: number | null }>;
}

/** Identificação (MESA/FICHA), duplicidade, troco, split e cancelamento. */
export async function runQuiosqueComandaTests(ctx: QaContext, test: TestFn) {
  const cfg: ConfigTenantFixture | undefined = ctx.configTenants?.find((c) => c.code === 'QUIOSQUE-00');
  if (!cfg?.produtoId) {
    await test(
      { id: 'QCM-00', category: 'Quiosque comandas', name: 'Seed QUIOSQUE-00', requirement: 'QCM' },
      async () => ({ status: 'failed', message: 'QUIOSQUE-00 ausente ou incompleto no contexto' }),
    );
    return;
  }

  const stamp = Date.now();
  const PRECO = 8;
  let pontoId = '';
  let atendenteToken = '';
  let mesaId = '';
  let fichaId = '';
  let cancelavelId = '';

  await test(
    { id: 'QCM-01', category: 'Quiosque comandas', name: 'Setup ponto de venda + caixa aberto', requirement: 'QCM-01' },
    async () => {
      const ponto = await api<{ id: string }>('POST', '/api/quiosque/pontos-venda', {
        token: cfg.donoToken,
        body: { nome: `Comandas QA ${stamp}` },
      });
      if (ponto.status !== 201 || !ponto.data?.id) {
        return { status: 'failed', message: 'Criar ponto', expected: '201', actual: String(ponto.status) };
      }
      pontoId = ponto.data.id;

      const caixa = await api('POST', '/api/quiosque/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, trocoInicial: 200 },
      });
      if (caixa.status !== 201) {
        return { status: 'failed', message: 'Abrir caixa', expected: '201', actual: String(caixa.status) };
      }

      const login = await api<{ token: string }>('POST', '/api/auth/login', {
        body: { email: `${cfg.slug}-a1@qa.test`, senha: 'qa123456' },
      });
      atendenteToken = login.data?.token ?? '';

      return { message: `Ponto ${pontoId} com caixa aberto`, expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'QCM-02', category: 'Quiosque comandas', name: 'Comanda tipo MESA', requirement: 'QCM-02' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCM-01 incompleto' };
      const r = await api<ResumoComanda>('POST', '/api/quiosque/comandas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          tipo: 'MESA',
          identificador: `12-${stamp}`,
          itens: [{ produtoId: cfg.produtoId, quantidade: 1 }],
        },
      });
      if (r.status !== 201 || r.data?.tipo !== 'MESA') {
        return { status: 'failed', message: 'Comanda MESA', expected: '201 MESA', actual: `${r.status} ${r.data?.tipo}` };
      }
      mesaId = r.data.id;
      if (r.data.total !== PRECO) {
        return { status: 'failed', message: 'Total da comanda', expected: String(PRECO), actual: String(r.data.total) };
      }
      return { message: `MESA ${r.data.identificador} · total ${r.data.total}`, expected: 'MESA', actual: r.data.tipo };
    },
  );

  await test(
    { id: 'QCM-03', category: 'Quiosque comandas', name: 'Comanda tipo FICHA', requirement: 'QCM-03' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCM-01 incompleto' };
      const r = await api<ResumoComanda>('POST', '/api/quiosque/comandas', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, tipo: 'FICHA', identificador: `F${stamp}`, itens: [] },
      });
      if (r.status !== 201 || r.data?.tipo !== 'FICHA') {
        return { status: 'failed', message: 'Comanda FICHA', expected: '201 FICHA', actual: `${r.status} ${r.data?.tipo}` };
      }
      fichaId = r.data.id;
      if (r.data.total !== 0) {
        return { status: 'failed', message: 'FICHA sem itens', expected: '0', actual: String(r.data.total) };
      }
      return { message: 'FICHA aberta sem itens', expected: 'FICHA', actual: r.data.tipo };
    },
  );

  await test(
    { id: 'QCM-04', category: 'Quiosque comandas', name: 'Identificador duplicado no mesmo ponto → 409', requirement: 'QCM-04' },
    async () => {
      if (!mesaId) return { status: 'failed', message: 'QCM-02 incompleto' };
      const r = await api<{ error?: string; comandaId?: string }>('POST', '/api/quiosque/comandas', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, tipo: 'MESA', identificador: `12-${stamp}`, itens: [] },
      });
      if (r.status !== 409) {
        return { status: 'failed', message: 'Duplicata aceita', expected: '409', actual: String(r.status) };
      }
      if (r.data?.comandaId !== mesaId) {
        return { status: 'failed', message: 'Conflito aponta comanda existente', expected: mesaId, actual: String(r.data?.comandaId) };
      }
      return { message: '409 apontando a comanda aberta', expected: '409', actual: '409' };
    },
  );

  await test(
    { id: 'QCM-05', category: 'Quiosque comandas', name: 'Mesmo identificador com outro tipo é permitido', requirement: 'QCM-05' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCM-01 incompleto' };
      const r = await api<ResumoComanda>('POST', '/api/quiosque/comandas', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, tipo: 'APELIDO', identificador: `12-${stamp}`, itens: [] },
      });
      if (r.status !== 201) {
        return { status: 'failed', message: 'APELIDO com mesmo texto da MESA', expected: '201', actual: String(r.status) };
      }
      cancelavelId = r.data.id;
      return { message: 'Chave é (ponto, tipo, identificador)', expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'QCM-06', category: 'Quiosque comandas', name: 'Cobrar comanda zerada → 409', requirement: 'QCM-06' },
    async () => {
      if (!fichaId) return { status: 'failed', message: 'QCM-03 incompleto' };
      const r = await api<{ error?: string }>('POST', `/api/quiosque/comandas/${fichaId}/pagamentos`, {
        token: cfg.donoToken,
        body: { pagamentos: [{ forma: 'DINHEIRO', valor: 1 }] },
      });
      if (r.status !== 409) {
        return { status: 'failed', message: 'Cobrança sem itens', expected: '409', actual: String(r.status) };
      }
      return { message: 'Sem item, sem cobrança', expected: '409', actual: '409' };
    },
  );

  await test(
    { id: 'QCM-07', category: 'Quiosque comandas', name: 'Pedido adicional soma no total', requirement: 'QCM-07' },
    async () => {
      if (!fichaId) return { status: 'failed', message: 'QCM-03 incompleto' };
      const r = await api<ResumoComanda>('POST', `/api/quiosque/comandas/${fichaId}/pedidos`, {
        token: atendenteToken || cfg.donoToken,
        body: { itens: [{ produtoId: cfg.produtoId, quantidade: 3 }] },
      });
      if (r.status !== 201) {
        return { status: 'failed', message: 'Adicionar pedido', expected: '201', actual: `${r.status} ${r.raw.slice(0, 100)}` };
      }
      if (r.data?.total !== PRECO * 3 || r.data.saldo !== PRECO * 3) {
        return {
          status: 'failed',
          message: 'Total/saldo após pedido',
          expected: `${PRECO * 3}`,
          actual: `${r.data?.total}/${r.data?.saldo}`,
        };
      }
      return { message: `Total ${r.data.total}`, expected: String(PRECO * 3), actual: String(r.data.total) };
    },
  );

  await test(
    { id: 'QCM-08', category: 'Quiosque comandas', name: 'Pagamento parcial rejeitado → 400', requirement: 'QCM-08' },
    async () => {
      if (!fichaId) return { status: 'failed', message: 'QCM-03 incompleto' };
      const r = await api<{ error?: string }>('POST', `/api/quiosque/comandas/${fichaId}/pagamentos`, {
        token: cfg.donoToken,
        body: { pagamentos: [{ forma: 'PIX', valor: PRECO }] },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Pagamento parcial aceito', expected: '400', actual: String(r.status) };
      }
      if (!r.data?.error?.includes('somam')) {
        return { status: 'failed', message: 'Mensagem de divergência', expected: 'Os pagamentos somam...', actual: r.data?.error ?? '' };
      }
      return { message: 'Quiosque exige quitação total', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QCM-09', category: 'Quiosque comandas', name: 'Split multi-forma fecha a comanda', requirement: 'QCM-09' },
    async () => {
      if (!fichaId) return { status: 'failed', message: 'QCM-03 incompleto' };
      const r = await api<ResumoComanda>('POST', `/api/quiosque/comandas/${fichaId}/pagamentos`, {
        token: cfg.donoToken,
        body: {
          pagamentos: [
            { forma: 'CARTAO_DEBITO', valor: PRECO },
            { forma: 'CARTAO_CREDITO', valor: PRECO },
            { forma: 'PIX', valor: PRECO },
          ],
        },
      });
      if (r.status !== 200 || r.data?.status !== 'FECHADA') {
        return { status: 'failed', message: 'Split', expected: '200 FECHADA', actual: `${r.status} ${r.data?.status}` };
      }
      if (r.data.saldo !== 0 || r.data.pagamentos.length !== 3) {
        return {
          status: 'failed',
          message: 'Saldo/pagamentos após split',
          expected: 'saldo 0 / 3 pagamentos',
          actual: `${r.data.saldo} / ${r.data.pagamentos.length}`,
        };
      }
      const formas = r.data.pagamentos.map((p) => p.forma).sort().join(',');
      if (formas !== 'CARTAO_CREDITO,CARTAO_DEBITO,PIX') {
        return { status: 'failed', message: 'Formas registradas', expected: 'CARTAO_CREDITO,CARTAO_DEBITO,PIX', actual: formas };
      }
      return { message: 'Split 3 formas quitou a conta', expected: 'saldo 0', actual: '0' };
    },
  );

  await test(
    { id: 'QCM-10', category: 'Quiosque comandas', name: 'Troco só existe em dinheiro', requirement: 'QCM-10' },
    async () => {
      if (!mesaId) return { status: 'failed', message: 'QCM-02 incompleto' };
      const r = await api<{ error?: string }>('POST', `/api/quiosque/comandas/${mesaId}/pagamentos`, {
        token: cfg.donoToken,
        body: { pagamentos: [{ forma: 'PIX', valor: PRECO, valorRecebido: PRECO + 5 }] },
      });
      if (r.status !== 400 || !r.data?.error?.includes('Troco só existe')) {
        return {
          status: 'failed',
          message: 'valorRecebido em PIX',
          expected: '400 Troco só existe em pagamento com dinheiro',
          actual: `${r.status} ${r.data?.error ?? ''}`,
        };
      }
      return { message: 'Troco bloqueado fora do dinheiro', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QCM-11', category: 'Quiosque comandas', name: 'Pagamento em dinheiro calcula troco', requirement: 'QCM-11' },
    async () => {
      if (!mesaId) return { status: 'failed', message: 'QCM-02 incompleto' };
      const r = await api<ResumoComanda>('POST', `/api/quiosque/comandas/${mesaId}/pagamentos`, {
        token: cfg.donoToken,
        body: { pagamentos: [{ forma: 'DINHEIRO', valor: PRECO, valorRecebido: 20 }] },
      });
      if (r.status !== 200 || r.data?.status !== 'FECHADA') {
        return { status: 'failed', message: 'Pagar em dinheiro', expected: '200 FECHADA', actual: `${r.status} ${r.data?.status}` };
      }
      const pago = r.data.pagamentos[0];
      if (pago?.troco !== 20 - PRECO) {
        return { status: 'failed', message: 'Troco calculado', expected: String(20 - PRECO), actual: String(pago?.troco) };
      }
      return { message: `Troco ${pago.troco}`, expected: String(20 - PRECO), actual: String(pago.troco) };
    },
  );

  await test(
    { id: 'QCM-12', category: 'Quiosque comandas', name: 'Pedido em comanda fechada → 409', requirement: 'QCM-12' },
    async () => {
      if (!mesaId) return { status: 'failed', message: 'QCM-02 incompleto' };
      const r = await api('POST', `/api/quiosque/comandas/${mesaId}/pedidos`, {
        token: cfg.donoToken,
        body: { itens: [{ produtoId: cfg.produtoId, quantidade: 1 }] },
      });
      if (r.status !== 409) {
        return { status: 'failed', message: 'Pedido em comanda fechada', expected: '409', actual: String(r.status) };
      }
      return { message: 'Comanda fechada não recebe pedido', expected: '409', actual: '409' };
    },
  );

  await test(
    { id: 'QCM-13', category: 'Quiosque comandas', name: 'ATENDENTE não cancela comanda → 403', requirement: 'QCM-13' },
    async () => {
      if (!cancelavelId) return { status: 'failed', message: 'QCM-05 incompleto' };
      if (!atendenteToken) return { status: 'skipped', message: 'Token de atendente indisponível' };
      const r = await api('POST', `/api/quiosque/comandas/${cancelavelId}/cancelar`, { token: atendenteToken });
      if (r.status !== 403) {
        return { status: 'failed', message: 'ATENDENTE cancelou', expected: '403', actual: String(r.status) };
      }
      return { message: 'Cancelamento restrito ao DONO', expected: '403', actual: '403' };
    },
  );

  await test(
    { id: 'QCM-14', category: 'Quiosque comandas', name: 'DONO cancela comanda aberta', requirement: 'QCM-14' },
    async () => {
      if (!cancelavelId) return { status: 'failed', message: 'QCM-05 incompleto' };
      const r = await api<ResumoComanda>('POST', `/api/quiosque/comandas/${cancelavelId}/cancelar`, {
        token: cfg.donoToken,
      });
      if (r.status !== 200 || r.data?.status !== 'CANCELADA') {
        return { status: 'failed', message: 'Cancelar comanda', expected: '200 CANCELADA', actual: `${r.status} ${r.data?.status}` };
      }
      return { message: 'Comanda cancelada', expected: 'CANCELADA', actual: r.data.status };
    },
  );

  await test(
    { id: 'QCM-15', category: 'Quiosque comandas', name: 'Comanda com pagamento não cancela → 409', requirement: 'QCM-15' },
    async () => {
      if (!mesaId) return { status: 'failed', message: 'QCM-02 incompleto' };
      const r = await api<{ error?: string }>('POST', `/api/quiosque/comandas/${mesaId}/cancelar`, {
        token: cfg.donoToken,
      });
      if (r.status !== 409) {
        return { status: 'failed', message: 'Cancelamento de comanda paga', expected: '409', actual: String(r.status) };
      }
      return { message: 'Comanda paga é imutável', expected: '409', actual: '409' };
    },
  );

  await test(
    { id: 'QCM-16', category: 'Quiosque comandas', name: 'Listagem ABERTA não traz canceladas nem avulsas', requirement: 'QCM-16' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCM-01 incompleto' };
      const venda = await api('POST', '/api/quiosque/vendas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          itens: [{ produtoId: cfg.produtoId, quantidade: 1 }],
          pagamentos: [{ forma: 'DINHEIRO', valor: PRECO }],
        },
      });
      if (venda.status !== 201) {
        return { status: 'failed', message: 'Venda avulsa', expected: '201', actual: String(venda.status) };
      }

      const r = await api<ResumoComanda[]>('GET', `/api/quiosque/comandas?status=ABERTA&pontoVendaId=${pontoId}`, {
        token: cfg.donoToken,
      });
      if (r.status !== 200 || !Array.isArray(r.data)) {
        return { status: 'failed', message: 'Listar comandas', expected: '200 array', actual: String(r.status) };
      }
      const temAvulsa = r.data.some((c) => c.tipo === 'AVULSA');
      const temCancelada = r.data.some((c) => c.id === cancelavelId);
      const temFechada = r.data.some((c) => c.id === mesaId);
      if (temAvulsa || temCancelada || temFechada) {
        return {
          status: 'failed',
          message: 'Listagem ABERTA poluída',
          expected: 'só abertas não avulsas',
          actual: `avulsa=${temAvulsa} cancelada=${temCancelada} fechada=${temFechada}`,
        };
      }
      return { message: `${r.data.length} comanda(s) aberta(s)`, expected: 'filtrado', actual: 'filtrado' };
    },
  );

  let descontoComandaId = '';

  await test(
    { id: 'QCM-17', category: 'Quiosque comandas', name: 'ATENDENTE sem permissão não aplica desconto → 403', requirement: 'QCM-17' },
    async () => {
      if (!pontoId || !atendenteToken) return { status: 'failed', message: 'QCM-01 incompleto' };

      const abrir = await api<ResumoComanda>('POST', '/api/quiosque/comandas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          tipo: 'APELIDO',
          identificador: `Desc QA ${stamp}`,
          itens: [{ produtoId: cfg.produtoId, quantidade: 2 }],
        },
      });
      if (abrir.status !== 201 || !abrir.data?.id) {
        return { status: 'failed', message: 'Abrir comanda desconto', expected: '201', actual: String(abrir.status) };
      }
      descontoComandaId = abrir.data.id;

      const r = await api<{ error?: string }>('PATCH', `/api/quiosque/comandas/${descontoComandaId}/desconto`, {
        token: atendenteToken,
        body: { desconto: 2 },
      });
      if (r.status !== 403) {
        return { status: 'failed', message: 'Desconto sem permissão', expected: '403', actual: String(r.status) };
      }
      return { message: 'Atendente bloqueado', expected: '403', actual: '403' };
    },
  );

  await test(
    { id: 'QCM-18', category: 'Quiosque comandas', name: 'DONO aplica desconto e reduz saldo', requirement: 'QCM-18' },
    async () => {
      if (!descontoComandaId) return { status: 'failed', message: 'QCM-17 incompleto' };

      const antes = await api<ResumoComanda>('GET', `/api/quiosque/comandas/${descontoComandaId}`, {
        token: cfg.donoToken,
      });
      if (antes.status !== 200 || !antes.data) {
        return { status: 'failed', message: 'GET comanda', expected: '200', actual: String(antes.status) };
      }

      const desconto = 3;
      const r = await api<ResumoComanda>('PATCH', `/api/quiosque/comandas/${descontoComandaId}/desconto`, {
        token: cfg.donoToken,
        body: { desconto },
      });
      if (r.status !== 200 || !r.data) {
        return { status: 'failed', message: 'Aplicar desconto', expected: '200', actual: String(r.status) };
      }

      const esperadoTotal = antes.data.subtotal - desconto;
      if (r.data.desconto !== desconto || r.data.total !== esperadoTotal || r.data.saldo !== esperadoTotal) {
        return {
          status: 'failed',
          message: 'Totais após desconto',
          expected: `total=${esperadoTotal} saldo=${esperadoTotal}`,
          actual: `total=${r.data.total} saldo=${r.data.saldo}`,
        };
      }
      return { message: `Desconto R$ ${desconto}`, expected: String(esperadoTotal), actual: String(r.data.total) };
    },
  );

  await test(
    { id: 'QCM-19', category: 'Quiosque comandas', name: 'Desconto maior que subtotal → 400', requirement: 'QCM-19' },
    async () => {
      if (!descontoComandaId) return { status: 'failed', message: 'QCM-17 incompleto' };

      const atual = await api<ResumoComanda>('GET', `/api/quiosque/comandas/${descontoComandaId}`, {
        token: cfg.donoToken,
      });
      if (atual.status !== 200 || !atual.data) {
        return { status: 'failed', message: 'GET comanda', expected: '200', actual: String(atual.status) };
      }

      const r = await api<{ error?: string }>('PATCH', `/api/quiosque/comandas/${descontoComandaId}/desconto`, {
        token: cfg.donoToken,
        body: { desconto: atual.data.subtotal + 1 },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Desconto excedente', expected: '400', actual: String(r.status) };
      }
      return { message: 'Desconto acima do subtotal rejeitado', expected: '400', actual: '400' };
    },
  );
}
