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

function expectStatus(actual: number, expected: number | number[], ctx: string): Outcome {
  const ok = Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  if (ok) return { message: ctx, expected: String(expected), actual: String(actual) };
  return {
    status: 'failed',
    message: ctx,
    expected: Array.isArray(expected) ? expected.join('|') : String(expected),
    actual: String(actual),
  };
}

function pickOther(cfg: ConfigTenantFixture, all: ConfigTenantFixture[]): ConfigTenantFixture | undefined {
  return all.find((o) => o.code !== cfg.code && o.moduloQuiosque && o.produtoId);
}

async function abrirCaixaSeNecessario(token: string, pontoVendaId: string) {
  const atual = await api<{ sessao?: { status: string } }>('GET', `/api/quiosque/caixa?pontoVendaId=${pontoVendaId}`, { token });
  if (atual.data?.sessao?.status === 'ABERTO') return;
  if (atual.data?.sessao?.status === 'FECHADO') {
    throw new Error(`Caixa fechado no PDV ${pontoVendaId} — impossivel continuar CFG`);
  }
  const abrir = await api('POST', '/api/quiosque/caixa/abrir', {
    token,
    body: { pontoVendaId, trocoInicial: 50 },
  });
  if (abrir.status !== 201) {
    throw new Error(`Falha ao abrir caixa CFG: HTTP ${abrir.status} ${abrir.raw.slice(0, 120)}`);
  }
}

export async function runCfgTests(ctx: QaContext, test: TestFn) {
  const configs = ctx.configTenants;
  if (!configs?.length) {
    await test(
      { id: 'CFG-00', category: 'Configuração', name: 'Seed das 9 configs', requirement: 'CFG' },
      async () => ({
        status: 'failed',
        message: 'configTenants ausente no contexto QA — rode setup novamente',
      }),
    );
    return;
  }

  const otherQuiosque = configs.find((c) => c.moduloQuiosque && c.produtoId);

  for (const cfg of configs) {
    const req = `CFG-${cfg.code}`;

    await test(
      { id: `${req}-01`, category: 'Configuração', name: `${cfg.code}: contexto/navegacao`, requirement: req },
      async () => {
        const r = await api<{
          ativo?: boolean;
          controlaEstoque?: boolean;
          temCozinha?: boolean;
        }>('GET', '/api/quiosque/contexto', { token: cfg.donoToken });

        if (cfg.moduloQuiosque) {
          if (r.status !== 200 || r.data.ativo !== true) {
            return { status: 'failed', message: 'Modulo quiosque deveria estar ativo', actual: JSON.stringify(r.data) };
          }
          if (r.data.controlaEstoque !== cfg.controlaEstoque) {
            return {
              status: 'failed',
              message: 'controlaEstoque divergente',
              expected: String(cfg.controlaEstoque),
              actual: String(r.data.controlaEstoque),
            };
          }
          if (r.data.temCozinha !== cfg.temCozinha) {
            return {
              status: 'failed',
              message: 'temCozinha divergente',
              expected: String(cfg.temCozinha),
              actual: String(r.data.temCozinha),
            };
          }
          return { message: 'Contexto quiosque OK' };
        }

        if (r.status === 200 && r.data.ativo === false) return { message: 'Modulo quiosque inativo' };
        if (r.status === 200 && r.data.ativo !== true) return { message: 'Sem quiosque ativo' };
        return { status: 'failed', message: 'Resposta inesperada do contexto', actual: JSON.stringify(r.data) };
      },
    );

    await test(
      { id: `${req}-02`, category: 'Configuração', name: `${cfg.code}: modulo habilitado opera`, requirement: req },
      async () => {
        if (cfg.moduloCervejaria) {
          const eventos = await api('GET', '/api/eventos', { token: cfg.donoToken });
          if (eventos.status !== 200) {
            return expectStatus(eventos.status, 200, 'Listagem de eventos cervejaria');
          }
        }

        if (!cfg.moduloQuiosque || !cfg.pontoVendaId || !cfg.produtoId) {
          if (cfg.moduloCervejaria) return { message: 'Cervejaria operacional' };
          return { status: 'failed', message: 'Config quiosque sem ponto/produto no seed' };
        }

        await abrirCaixaSeNecessario(cfg.donoToken, cfg.pontoVendaId);
        const venda = await api('POST', '/api/quiosque/vendas', {
          token: cfg.donoToken,
          body: {
            pontoVendaId: cfg.pontoVendaId,
            itens: [{ produtoId: cfg.produtoId, quantidade: 1 }],
            pagamentos: [{ forma: 'PIX', valor: 8 }],
          },
        });
        return expectStatus(venda.status, 201, 'Venda PDV quiosque');
      },
    );

    await test(
      { id: `${req}-03`, category: 'Configuração', name: `${cfg.code}: submodulos bloqueados na API`, requirement: req },
      async () => {
        if (!cfg.moduloQuiosque) {
          const produtos = await api('GET', '/api/quiosque/produtos', { token: cfg.donoToken });
          return expectStatus(produtos.status, 404, 'Quiosque indisponivel sem modulo');
        }

        if (!cfg.pontoVendaId) return { status: 'failed', message: 'Sem ponto de venda' };

        const estoque = await api('GET', `/api/quiosque/estoque?pontoVendaId=${cfg.pontoVendaId}`, { token: cfg.donoToken });
        const cozinha = await api('GET', '/api/quiosque/cozinha', { token: cfg.donoToken });

        const estoqueOk = cfg.controlaEstoque ? estoque.status === 200 : estoque.status === 404;
        const cozinhaOk = cfg.temCozinha ? cozinha.status === 200 : cozinha.status === 404;

        if (!estoqueOk || !cozinhaOk) {
          return {
            status: 'failed',
            message: 'Subflag nao refletida na API',
            expected: `estoque=${cfg.controlaEstoque ? 200 : 404}, cozinha=${cfg.temCozinha ? 200 : 404}`,
            actual: `estoque=${estoque.status}, cozinha=${cozinha.status}`,
          };
        }
        return { message: 'Subflags respeitadas na API' };
      },
    );

    await test(
      { id: `${req}-04`, category: 'Configuração', name: `${cfg.code}: isolamento multitenant`, requirement: req },
      async () => {
        if (cfg.moduloCervejaria && !cfg.moduloQuiosque) {
          const otherEv = configs.find((o) => o.eventoId && o.cervejariaId !== cfg.cervejariaId);
          if (!otherEv?.eventoId) return { status: 'skipped', message: 'Sem evento de outro tenant no seed' };
          const leak = await api('GET', `/api/eventos/${otherEv.eventoId}`, { token: cfg.donoToken });
          return expectStatus(leak.status, 404, `Evento de ${otherEv.code}`);
        }

        const other = pickOther(cfg, configs) ?? otherQuiosque;
        if (!other?.produtoId || !cfg.moduloQuiosque || !cfg.pontoVendaId) {
          if (cfg.moduloCervejaria && other?.eventoId) {
            const leak = await api('GET', `/api/eventos/${other.eventoId}`, { token: cfg.donoToken });
            return expectStatus(leak.status, 404, 'Evento de outro tenant');
          }
          return { status: 'skipped', message: 'Sem par de isolamento aplicavel' };
        }

        await abrirCaixaSeNecessario(cfg.donoToken, cfg.pontoVendaId);
        const cross = await api('POST', '/api/quiosque/vendas', {
          token: cfg.donoToken,
          body: {
            pontoVendaId: cfg.pontoVendaId,
            itens: [{ produtoId: other.produtoId, quantidade: 1 }],
            pagamentos: [{ forma: 'PIX', valor: 8 }],
          },
        });
        if (cross.status === 404 || cross.status === 400) {
          return { message: `Produto de ${other.code} recusado`, actual: String(cross.status) };
        }
        return {
          status: 'failed',
          message: 'Vazamento: produto de outro tenant aceito',
          expected: '404|400',
          actual: String(cross.status),
        };
      },
    );

    await test(
      { id: `${req}-05`, category: 'Configuração', name: `${cfg.code}: cenario de erro`, requirement: req },
      async () => {
        if (!cfg.moduloQuiosque) {
          const vendas = await api('POST', '/api/quiosque/vendas', {
            token: cfg.donoToken,
            body: { pontoVendaId: 'x', itens: [], pagamentos: [] },
          });
          return expectStatus(vendas.status, 404, 'Venda quiosque sem modulo');
        }

        if (!cfg.pontoVendaId || !cfg.produtoId) {
          return { status: 'failed', message: 'Seed incompleto para erro quiosque' };
        }

        await abrirCaixaSeNecessario(cfg.donoToken, cfg.pontoVendaId);
        const pagoMenos = await api('POST', '/api/quiosque/vendas', {
          token: cfg.donoToken,
          body: {
            pontoVendaId: cfg.pontoVendaId,
            itens: [{ produtoId: cfg.produtoId, quantidade: 1 }],
            pagamentos: [{ forma: 'PIX', valor: 1 }],
          },
        });
        return expectStatus(pagoMenos.status, 400, 'Pagamento incoerente recusado');
      },
    );
  }
}
