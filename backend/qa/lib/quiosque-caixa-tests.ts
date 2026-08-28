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

interface ResumoCaixa {
  id: string;
  status: string;
  fechadoEm?: string;
  trocoInicial: number;
  gaveta: {
    trocoInicial: number;
    entradasDinheiro: number;
    suprimentos: number;
    sangrias: number;
    esperadoDinheiro: number;
  };
  esperado: { dinheiro: number; pix: number; cartaoDebito: number; cartaoCredito: number; totalVendas: number };
  contado: { dinheiro: number; pix: number } | null;
  diferencas: { dinheiro: number; pix: number } | null;
  movimentos: Array<{ tipo: string; valor: number }>;
}

/**
 * Ciclo completo de caixa num ponto de venda dedicado — isola o ponto para não
 * interferir nas demais suítes. Vários turnos abrir/fechar no mesmo dia são permitidos.
 */
export async function runQuiosqueCaixaTests(ctx: QaContext, test: TestFn) {
  const cfg: ConfigTenantFixture | undefined = ctx.configTenants?.find((c) => c.code === 'QUIOSQUE-00');
  if (!cfg?.produtoId) {
    await test(
      { id: 'QCX-00', category: 'Quiosque caixa', name: 'Seed QUIOSQUE-00', requirement: 'QCX' },
      async () => ({ status: 'failed', message: 'QUIOSQUE-00 ausente ou incompleto no contexto' }),
    );
    return;
  }

  const stamp = Date.now();
  let pontoId = '';
  const PRECO = 8;

  await test(
    { id: 'QCX-01', category: 'Quiosque caixa', name: 'ATENDENTE não cria ponto de venda', requirement: 'QCX-01' },
    async () => {
      const atendenteCookie = await login(`${cfg.slug}-a1@qa.test`, 'qa123456');
      const r = await api('POST', '/api/quiosque/pontos-venda', {
        cookie: atendenteCookie,
        body: { nome: `Bloqueado ${stamp}` },
      });
      if (r.status !== 403) {
        return { status: 'failed', message: 'ATENDENTE criou ponto de venda', expected: '403', actual: String(r.status) };
      }
      return { message: 'ATENDENTE bloqueado (403)', expected: '403', actual: '403' };
    },
  );

  await test(
    { id: 'QCX-02', category: 'Quiosque caixa', name: 'DONO cria ponto de venda dedicado', requirement: 'QCX-02' },
    async () => {
      const r = await api<{ id: string }>('POST', '/api/quiosque/pontos-venda', {
        token: cfg.donoToken,
        body: { nome: `Caixa QA ${stamp}` },
      });
      if (r.status !== 201 || !r.data?.id) {
        return { status: 'failed', message: 'Criar ponto de venda', expected: '201', actual: String(r.status) };
      }
      pontoId = r.data.id;
      return { message: pontoId, expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'QCX-03', category: 'Quiosque caixa', name: 'Ponto sem sessão retorna sessao null', requirement: 'QCX-03' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const r = await api<{ sessao: unknown }>('GET', `/api/quiosque/caixa?pontoVendaId=${pontoId}`, {
        token: cfg.donoToken,
      });
      if (r.status !== 200 || r.data?.sessao !== null) {
        return { status: 'failed', message: 'Sessão inicial', expected: 'null', actual: JSON.stringify(r.data?.sessao ?? r.status) };
      }
      return { message: 'Sem sessão no ponto novo', expected: 'null', actual: 'null' };
    },
  );

  await test(
    { id: 'QCX-04', category: 'Quiosque caixa', name: 'Venda sem caixa aberto → 400', requirement: 'QCX-04' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const r = await api<{ error?: string }>('POST', '/api/quiosque/vendas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          itens: [{ produtoId: cfg.produtoId, quantidade: 1 }],
          pagamentos: [{ forma: 'DINHEIRO', valor: PRECO }],
        },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Venda sem caixa', expected: '400', actual: String(r.status) };
      }
      if (!r.data?.error?.includes('Abra o caixa')) {
        return { status: 'failed', message: 'Mensagem de caixa fechado', expected: 'Abra o caixa do dia...', actual: r.data?.error ?? '' };
      }
      return { message: 'Venda bloqueada sem caixa', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QCX-04b', category: 'Quiosque caixa', name: 'Comanda sem caixa aberto → 400', requirement: 'QCX-04' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const r = await api<{ error?: string }>('POST', '/api/quiosque/comandas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          tipo: 'FICHA',
          identificador: `sem-caixa-${stamp}`,
          itens: [],
        },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Comanda sem caixa', expected: '400', actual: String(r.status) };
      }
      if (!r.data?.error?.includes('Abra o caixa')) {
        return { status: 'failed', message: 'Mensagem de caixa fechado', expected: 'Abra o caixa do dia...', actual: r.data?.error ?? '' };
      }
      return { message: 'Comanda bloqueada sem caixa', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QCX-05', category: 'Quiosque caixa', name: 'Troco inicial negativo → 400', requirement: 'QCX-05' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const r = await api('POST', '/api/quiosque/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, trocoInicial: -10 },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Troco negativo aceito', expected: '400', actual: String(r.status) };
      }
      return { message: 'Troco negativo rejeitado', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QCX-06', category: 'Quiosque caixa', name: 'Abertura registra troco inicial na gaveta', requirement: 'QCX-06' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const r = await api<ResumoCaixa>('POST', '/api/quiosque/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, trocoInicial: 100 },
      });
      if (r.status !== 201) {
        return { status: 'failed', message: 'Abrir caixa', expected: '201', actual: `${r.status} ${r.raw.slice(0, 100)}` };
      }
      if (r.data?.status !== 'ABERTO' || r.data.gaveta.esperadoDinheiro !== 100) {
        return {
          status: 'failed',
          message: 'Gaveta na abertura',
          expected: 'ABERTO / esperado 100',
          actual: `${r.data?.status} / ${r.data?.gaveta?.esperadoDinheiro}`,
        };
      }
      return { message: 'Caixa aberto com troco 100', expected: '100', actual: String(r.data.gaveta.esperadoDinheiro) };
    },
  );

  await test(
    { id: 'QCX-07', category: 'Quiosque caixa', name: 'Reabrir caixa do dia → 400', requirement: 'QCX-07' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const r = await api<{ error?: string }>('POST', '/api/quiosque/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, trocoInicial: 50 },
      });
      if (r.status !== 400 || !r.data?.error?.includes('já está aberto')) {
        return {
          status: 'failed',
          message: 'Segunda abertura',
          expected: '400 já está aberto hoje',
          actual: `${r.status} ${r.data?.error ?? ''}`,
        };
      }
      return { message: 'Caixa duplicado rejeitado', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QCX-08', category: 'Quiosque caixa', name: 'Movimento com valor zero → 400', requirement: 'QCX-08' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const r = await api('POST', '/api/quiosque/caixa/movimentos', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, tipo: 'SANGRIA', valor: 0 },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Valor zero aceito', expected: '400', actual: String(r.status) };
      }
      return { message: 'Valor não positivo rejeitado', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QCX-09', category: 'Quiosque caixa', name: 'Sangria e suprimento ajustam a gaveta', requirement: 'QCX-09' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const sangria = await api<ResumoCaixa>('POST', '/api/quiosque/caixa/movimentos', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, tipo: 'SANGRIA', valor: 30, observacao: 'QA sangria' },
      });
      if (sangria.status !== 201) {
        return { status: 'failed', message: 'Sangria', expected: '201', actual: String(sangria.status) };
      }
      const suprimento = await api<ResumoCaixa>('POST', '/api/quiosque/caixa/movimentos', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, tipo: 'SUPRIMENTO', valor: 20, observacao: 'QA suprimento' },
      });
      if (suprimento.status !== 201) {
        return { status: 'failed', message: 'Suprimento', expected: '201', actual: String(suprimento.status) };
      }

      const g = suprimento.data.gaveta;
      // 100 troco − 30 sangria + 20 suprimento = 90
      if (g.sangrias !== 30 || g.suprimentos !== 20 || g.esperadoDinheiro !== 90) {
        return {
          status: 'failed',
          message: 'Gaveta após movimentos',
          expected: 'sangria 30 / suprimento 20 / esperado 90',
          actual: `${g.sangrias} / ${g.suprimentos} / ${g.esperadoDinheiro}`,
        };
      }
      if (suprimento.data.movimentos.length !== 2) {
        return { status: 'failed', message: 'Histórico de movimentos', expected: '2', actual: String(suprimento.data.movimentos.length) };
      }
      return { message: 'Gaveta 100−30+20 = 90', expected: '90', actual: String(g.esperadoDinheiro) };
    },
  );

  await test(
    { id: 'QCX-10', category: 'Quiosque caixa', name: 'Venda em dinheiro entra na gaveta', requirement: 'QCX-10' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const venda = await api('POST', '/api/quiosque/vendas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          itens: [{ produtoId: cfg.produtoId, quantidade: 1 }],
          pagamentos: [{ forma: 'DINHEIRO', valor: PRECO }],
        },
      });
      if (venda.status !== 201) {
        return { status: 'failed', message: 'Venda dinheiro', expected: '201', actual: `${venda.status} ${venda.raw.slice(0, 100)}` };
      }

      const r = await api<{ sessao: ResumoCaixa }>('GET', `/api/quiosque/caixa?pontoVendaId=${pontoId}`, {
        token: cfg.donoToken,
      });
      const g = r.data?.sessao?.gaveta;
      // 90 + 8 da venda
      if (g?.entradasDinheiro !== PRECO || g.esperadoDinheiro !== 98) {
        return {
          status: 'failed',
          message: 'Gaveta após venda',
          expected: `entradas ${PRECO} / esperado 98`,
          actual: `${g?.entradasDinheiro} / ${g?.esperadoDinheiro}`,
        };
      }
      return { message: 'Venda somada à gaveta (98)', expected: '98', actual: String(g.esperadoDinheiro) };
    },
  );

  await test(
    { id: 'QCX-11', category: 'Quiosque caixa', name: 'Venda PIX entra em esperado.pix', requirement: 'QCX-11' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const venda = await api('POST', '/api/quiosque/vendas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          itens: [{ produtoId: cfg.produtoId, quantidade: 2 }],
          pagamentos: [{ forma: 'PIX', valor: PRECO * 2 }],
        },
      });
      if (venda.status !== 201) {
        return { status: 'failed', message: 'Venda PIX', expected: '201', actual: String(venda.status) };
      }
      const r = await api<{ sessao: ResumoCaixa }>('GET', `/api/quiosque/caixa?pontoVendaId=${pontoId}`, {
        token: cfg.donoToken,
      });
      const esperado = r.data?.sessao?.esperado;
      if (esperado?.pix !== PRECO * 2 || esperado.dinheiro !== PRECO) {
        return {
          status: 'failed',
          message: 'Totais por forma',
          expected: `pix ${PRECO * 2} / dinheiro ${PRECO}`,
          actual: `${esperado?.pix} / ${esperado?.dinheiro}`,
        };
      }
      return { message: `PIX ${esperado.pix} · dinheiro ${esperado.dinheiro}`, expected: 'separado por forma', actual: 'OK' };
    },
  );

  await test(
    {
      id: 'QCX-11b',
      category: 'Quiosque caixa',
      name: 'Fechar caixa com comanda aberta → 400',
      requirement: 'QCX-11b',
    },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const comanda = await api<{ id?: string }>('POST', '/api/quiosque/comandas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          tipo: 'FICHA',
          identificador: `bloqueio-caixa-${stamp}`,
          itens: [{ produtoId: cfg.produtoId, quantidade: 1 }],
        },
      });
      if (comanda.status !== 201 || !comanda.data?.id) {
        return {
          status: 'failed',
          message: 'Comanda aberta para bloqueio',
          expected: '201',
          actual: String(comanda.status),
        };
      }
      const r = await api<{ error?: string }>('POST', '/api/quiosque/caixa/fechar', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          contadoDinheiro: 100,
          contadoPix: PRECO * 2,
          contadoCartaoDebito: 0,
          contadoCartaoCredito: 0,
        },
      });
      if (r.status !== 400 || !r.data?.error?.includes('comanda')) {
        return {
          status: 'failed',
          message: 'Fechar com comanda aberta',
          expected: '400 comanda aberta',
          actual: `${r.status} ${r.data?.error ?? ''}`,
        };
      }
      const cancelar = await api('POST', `/api/quiosque/comandas/${comanda.data.id}/cancelar`, {
        token: cfg.donoToken,
      });
      if (cancelar.status !== 200) {
        return {
          status: 'failed',
          message: 'Cancelar comanda após teste',
          expected: '200',
          actual: String(cancelar.status),
        };
      }
      return { message: 'Caixa bloqueado com comanda aberta', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QCX-12', category: 'Quiosque caixa', name: 'Fechamento registra divergência sem bloquear', requirement: 'QCX-12' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      // Conta 10 a menos em dinheiro para forçar diferença negativa.
      const r = await api<ResumoCaixa>('POST', '/api/quiosque/caixa/fechar', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          contadoDinheiro: 88,
          contadoPix: PRECO * 2,
          contadoCartaoDebito: 0,
          contadoCartaoCredito: 0,
          observacaoFechamento: 'QA divergência proposital',
        },
      });
      if (r.status !== 200) {
        return { status: 'failed', message: 'Fechar caixa', expected: '200', actual: `${r.status} ${r.raw.slice(0, 100)}` };
      }
      if (r.data?.status !== 'FECHADO') {
        return { status: 'failed', message: 'Status após fechar', expected: 'FECHADO', actual: String(r.data?.status) };
      }
      if (r.data.diferencas?.dinheiro !== -10) {
        return {
          status: 'failed',
          message: 'Diferença de dinheiro',
          expected: '-10',
          actual: String(r.data.diferencas?.dinheiro),
        };
      }
      if (r.data.diferencas.pix !== 0) {
        return { status: 'failed', message: 'Diferença de PIX', expected: '0', actual: String(r.data.diferencas.pix) };
      }
      return { message: 'Fechado com divergência -10 registrada', expected: '-10', actual: '-10' };
    },
  );

  await test(
    { id: 'QCX-13', category: 'Quiosque caixa', name: 'Movimento após fechamento → 400', requirement: 'QCX-13' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const r = await api('POST', '/api/quiosque/caixa/movimentos', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, tipo: 'SANGRIA', valor: 5 },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Movimento em caixa fechado', expected: '400', actual: String(r.status) };
      }
      return { message: 'Caixa fechado bloqueia movimento', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QCX-14', category: 'Quiosque caixa', name: 'Reabertura após fechar no mesmo dia → 201', requirement: 'QCX-14' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const r = await api<{ status?: string; trocoInicial?: number }>('POST', '/api/quiosque/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, trocoInicial: 50 },
      });
      if (r.status !== 201 || r.data?.status !== 'ABERTO') {
        return {
          status: 'failed',
          message: 'Reabertura no mesmo dia',
          expected: '201 ABERTO',
          actual: `${r.status} ${r.data?.status ?? ''}`,
        };
      }
      if (r.data.trocoInicial !== 50) {
        return {
          status: 'failed',
          message: 'Troco do novo turno',
          expected: '50',
          actual: String(r.data.trocoInicial),
        };
      }
      return { message: 'Novo turno aberto no mesmo dia', expected: '201', actual: '201' };
    },
  );

  await test(
    { id: 'QCX-15', category: 'Quiosque caixa', name: 'Venda após fechamento → 400', requirement: 'QCX-15' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const fechar = await api('POST', '/api/quiosque/caixa/fechar', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          contadoDinheiro: 50,
          contadoPix: 0,
          contadoCartaoDebito: 0,
          contadoCartaoCredito: 0,
        },
      });
      if (fechar.status !== 200) {
        return {
          status: 'failed',
          message: 'Fechar turno antes de testar venda',
          expected: '200',
          actual: String(fechar.status),
        };
      }
      const r = await api('POST', '/api/quiosque/vendas', {
        token: cfg.donoToken,
        body: {
          pontoVendaId: pontoId,
          itens: [{ produtoId: cfg.produtoId, quantidade: 1 }],
          pagamentos: [{ forma: 'DINHEIRO', valor: PRECO }],
        },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Venda com caixa fechado', expected: '400', actual: String(r.status) };
      }
      return { message: 'Venda bloqueada após fechamento', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'QCX-16', category: 'Quiosque caixa', name: 'Duas aberturas simultâneas criam um único caixa', requirement: 'TQ-005-B' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const tentativas = await Promise.all(
        [100, 101].map((trocoInicial) =>
          api<ResumoCaixa>('POST', '/api/quiosque/caixa/abrir', {
            token: cfg.donoToken,
            body: { pontoVendaId: pontoId, trocoInicial },
          }),
        ),
      );
      const abertas = tentativas.filter((r) => r.status === 201);
      const rejeitadas = tentativas.filter((r) => r.status === 400);
      const atual = await api<{ sessao: ResumoCaixa | null }>('GET', `/api/quiosque/caixa?pontoVendaId=${pontoId}`, {
        token: cfg.donoToken,
      });
      if (abertas.length !== 1 || rejeitadas.length !== 1 || atual.data?.sessao?.status !== 'ABERTO') {
        return {
          status: 'failed',
          message: 'Abertura concorrente gerou resultado inválido',
          expected: '1x 201, 1x 400 e uma sessão ABERTA',
          actual: `${tentativas.map((r) => r.status).join('/')} / ${atual.data?.sessao?.status ?? 'sem sessão'}`,
        };
      }
      return { message: 'Uma sessão aberta e uma tentativa rejeitada', expected: '201/400', actual: '201/400' };
    },
  );

  await test(
    { id: 'QCX-17', category: 'Quiosque caixa', name: 'Fechamento concorrente com venda mantém corte consistente', requirement: 'TQ-005-D' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const [fechamento, venda] = await Promise.all([
        api<ResumoCaixa>('POST', '/api/quiosque/caixa/fechar', {
          token: cfg.donoToken,
          body: {
            pontoVendaId: pontoId,
            contadoDinheiro: 100,
            contadoPix: 0,
            contadoCartaoDebito: 0,
            contadoCartaoCredito: 0,
          },
        }),
        api<{ fechadaEm?: string }>('POST', '/api/quiosque/vendas', {
          token: cfg.donoToken,
          body: {
            pontoVendaId: pontoId,
            itens: [{ produtoId: cfg.produtoId, quantidade: 1 }],
            pagamentos: [{ forma: 'DINHEIRO', valor: PRECO }],
          },
        }),
      ]);

      if (fechamento.status !== 200 || !fechamento.data?.id || ![201, 400].includes(venda.status)) {
        return {
          status: 'failed',
          message: 'Resultado inválido na corrida venda/fechamento',
          expected: 'fechamento 200; venda 201 ou 400',
          actual: `${fechamento.status}/${venda.status}`,
        };
      }
      if (venda.status === 201 && venda.data?.fechadaEm && fechamento.data.fechadoEm) {
        if (new Date(venda.data.fechadaEm) > new Date(fechamento.data.fechadoEm)) {
          return {
            status: 'failed',
            message: 'Venda foi concluída após o caixa fechado',
            expected: 'venda.fechadaEm <= caixa.fechadoEm',
            actual: `${venda.data.fechadaEm} > ${fechamento.data.fechadoEm}`,
          };
        }
      }
      return { message: `Fechamento 200; venda ${venda.status}`, expected: '200/201|400', actual: `200/${venda.status}` };
    },
  );

  await test(
    { id: 'QCX-18', category: 'Quiosque caixa', name: 'Duplo fechamento tem resultado consistente', requirement: 'TQ-005-F' },
    async () => {
      if (!pontoId) return { status: 'failed', message: 'QCX-02 incompleto' };
      const abrir = await api('POST', '/api/quiosque/caixa/abrir', {
        token: cfg.donoToken,
        body: { pontoVendaId: pontoId, trocoInicial: 50 },
      });
      if (abrir.status !== 201) return { status: 'failed', message: 'Preparação do duplo fechamento', actual: String(abrir.status) };

      const respostas = await Promise.all(
        Array.from({ length: 2 }, () =>
          api('POST', '/api/quiosque/caixa/fechar', {
            token: cfg.donoToken,
            body: {
              pontoVendaId: pontoId,
              contadoDinheiro: 50,
              contadoPix: 0,
              contadoCartaoDebito: 0,
              contadoCartaoCredito: 0,
            },
          }),
        ),
      );
      const sucesso = respostas.filter((r) => r.status === 200).length;
      const rejeitada = respostas.filter((r) => r.status === 400).length;
      if (sucesso !== 1 || rejeitada !== 1) {
        return {
          status: 'failed',
          message: 'Duplo fechamento não respeitou a regra atual',
          expected: '1x 200 e 1x 400',
          actual: respostas.map((r) => r.status).join('/'),
        };
      }
      return { message: 'Primeiro fechamento vence; segundo é rejeitado', expected: '200/400', actual: '200/400' };
    },
  );
}
