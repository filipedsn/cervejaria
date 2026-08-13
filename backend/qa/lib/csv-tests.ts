import { UNIT_ML } from '../../src/lib/produto-utils.js';
import { api, apiBytes, uniquePortalTestPhone } from './http.js';
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

/** Nomes hostis: aspas quebram o parser, `=` vira fórmula no Excel. */
const NOME_HOSTIL = 'João "JJ" Silva';
const NOME_FORMULA = '=SUM(1+1)';
const TELEFONE = '11988887777';

function linhas(csv: string): string[] {
  return csv.replace(/^\uFEFF/, '').split('\n').filter((l) => l.length > 0);
}

/** Escape RFC 4180 e neutralização de fórmula nas duas rotas de exportação. */
export async function runCsvTests(ctx: QaContext, test: TestFn) {
  const tenant: TenantFixture | undefined = ctx.tenants[7] ?? ctx.tenants[1];
  if (!tenant) {
    await test(
      { id: 'CSV-01', category: 'Exportação CSV', name: 'Seed CSV', requirement: 'CSV' },
      async () => ({ status: 'failed', message: 'Tenant indisponível para testes de CSV' }),
    );
    return;
  }

  await ensureTenantEventoAberto(tenant);

  let comandaId = '';

  await test(
    { id: 'CSV-01', category: 'Exportação CSV', name: 'Setup comanda com nome hostil', requirement: 'CSV-01' },
    async () => {
      const comanda = await api<{ id: string }>('POST', '/api/comandas', {
        token: tenant.atendenteTokens[0],
        body: { eventoId: tenant.eventoId, clienteNome: NOME_HOSTIL, clienteTelefone: TELEFONE },
      });
      if (comanda.status !== 201 || !comanda.data?.id) {
        return { status: 'failed', message: 'Criar comanda', expected: '201', actual: `${comanda.status} ${comanda.raw.slice(0, 120)}` };
      }
      comandaId = comanda.data.id;

      const item = await api('POST', `/api/comandas/${comandaId}/itens`, {
        token: tenant.atendenteTokens[0],
        body: { produtoId: tenant.produtoId, tapId: tenant.tapId, volumeMl: tenant.volumeMl, quantidade: 1 },
      });
      if (item.status !== 201) {
        return { status: 'failed', message: 'Lançar item', expected: '201', actual: String(item.status) };
      }

      const atual = await api<{ total: string | number }>('GET', `/api/comandas/${comandaId}`, {
        token: tenant.donoToken,
      });
      const fechar = await api('POST', `/api/pagamentos/comandas/${comandaId}/fechar`, {
        token: tenant.atendenteTokens[0],
        body: { pagamentos: [{ forma: 'PIX', valor: Number(atual.data?.total ?? 0) }] },
      });
      if (fechar.status !== 200) {
        return { status: 'failed', message: 'Fechar comanda', expected: '200', actual: String(fechar.status) };
      }
      return { message: `Comanda de "${NOME_HOSTIL}" fechada`, expected: '200', actual: '200' };
    },
  );

  await test(
    { id: 'CSV-02', category: 'Exportação CSV', name: 'Relatório CSV exige DONO', requirement: 'CSV-02' },
    async () => {
      const r = await api('GET', `/api/relatorios/evento/${tenant.eventoId}/csv`, {
        token: tenant.atendenteTokens[0],
      });
      if (r.status !== 403) {
        return { status: 'failed', message: 'ATENDENTE exportou relatório', expected: '403', actual: String(r.status) };
      }
      return { message: 'Exportação restrita ao DONO', expected: '403', actual: '403' };
    },
  );

  await test(
    { id: 'CSV-03', category: 'Exportação CSV', name: 'Relatório CSV: header, BOM e content-type', requirement: 'CSV-03' },
    async () => {
      const r = await apiBytes('GET', `/api/relatorios/evento/${tenant.eventoId}/csv`, { token: tenant.donoToken });
      if (r.status !== 200) {
        return { status: 'failed', message: 'Exportar relatório', expected: '200', actual: String(r.status) };
      }
      if (!r.contentType?.includes('text/csv')) {
        return { status: 'failed', message: 'Content-Type', expected: 'text/csv', actual: String(r.contentType) };
      }
      if (r.bytes[0] !== 0xef || r.bytes[1] !== 0xbb || r.bytes[2] !== 0xbf) {
        return {
          status: 'failed',
          message: 'BOM UTF-8 ausente',
          expected: 'EF BB BF',
          actual: r.bytes.subarray(0, 3).toString('hex'),
        };
      }
      const header = linhas(r.text)[0];
      const esperado = 'cliente,telefone,produto,volume_ml,quantidade,preco_unit,subtotal,forma_pagamento,valor_pago,fechado_em';
      if (header !== esperado) {
        return { status: 'failed', message: 'Cabeçalho', expected: esperado, actual: String(header) };
      }
      return { message: 'BOM + cabeçalho corretos', expected: 'BOM + header', actual: 'OK' };
    },
  );

  await test(
    { id: 'CSV-04', category: 'Exportação CSV', name: 'Aspas internas escapadas (RFC 4180)', requirement: 'CSV-04' },
    async () => {
      const r = await apiBytes('GET', `/api/relatorios/evento/${tenant.eventoId}/csv`, { token: tenant.donoToken });
      if (r.status !== 200) {
        return { status: 'failed', message: 'Exportar relatório', expected: '200', actual: String(r.status) };
      }
      const linha = linhas(r.text).find((l) => l.includes('JJ'));
      if (!linha) {
        return { status: 'failed', message: 'Linha do cliente hostil ausente', expected: NOME_HOSTIL, actual: 'não encontrada' };
      }
      const esperado = `"João ""JJ"" Silva"`;
      if (!linha.startsWith(esperado)) {
        return { status: 'failed', message: 'Aspas não escapadas', expected: esperado, actual: linha.slice(0, 40) };
      }
      // Campo com aspas escapadas continua sendo uma célula só.
      const colunas = linha.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g) ?? [];
      if (colunas.length !== 10) {
        return { status: 'failed', message: 'Número de colunas', expected: '10', actual: String(colunas.length) };
      }
      return { message: 'Aspas duplicadas mantêm 10 colunas', expected: '10 colunas', actual: '10' };
    },
  );

  await test(
    { id: 'CSV-05', category: 'Exportação CSV', name: 'Telefone exportado entre aspas', requirement: 'CSV-05' },
    async () => {
      const r = await apiBytes('GET', `/api/relatorios/evento/${tenant.eventoId}/csv`, { token: tenant.donoToken });
      const linha = linhas(r.text).find((l) => l.includes('JJ'));
      if (!linha) return { status: 'failed', message: 'Linha do cliente ausente' };
      // Sem aspas o Excel trata como número e come o zero à esquerda do DDD.
      if (!linha.includes(`,"${TELEFONE}",`)) {
        return {
          status: 'failed',
          message: 'Telefone sem aspas',
          expected: `,"${TELEFONE}",`,
          actual: linha.slice(0, 60),
        };
      }
      return { message: 'Telefone citado como texto', expected: `"${TELEFONE}"`, actual: 'OK' };
    },
  );

  await test(
    { id: 'CSV-06', category: 'Exportação CSV', name: 'Fórmula em nome de produto é neutralizada', requirement: 'CSV-06' },
    async () => {
      // COMIDA é venda unitária: preço normalizado para UNIT_ML e nenhum tap envolvido.
      const produto = await api<{ id: string }>('POST', '/api/produtos', {
        token: tenant.donoToken,
        body: { nome: NOME_FORMULA, tipo: 'COMIDA', precos: [{ volumeMl: UNIT_ML, preco: 10 }] },
      });
      if (produto.status !== 201 || !produto.data?.id) {
        return { status: 'failed', message: 'Criar produto', expected: '201', actual: `${produto.status} ${produto.raw.slice(0, 120)}` };
      }

      // Venda unitária só é lançável se o produto estiver no cardápio do evento.
      const cardapio = await api<{ produtoIds: string[] }>('GET', `/api/eventos/${tenant.eventoId}/cardapio`, {
        token: tenant.donoToken,
      });
      const produtoIds = [...new Set([...(cardapio.data?.produtoIds ?? []), produto.data.id])];
      const put = await api('PUT', `/api/eventos/${tenant.eventoId}/cardapio`, {
        token: tenant.donoToken,
        body: { produtoIds },
      });
      if (put.status !== 200) {
        return { status: 'failed', message: 'Incluir no cardápio', expected: '200', actual: `${put.status} ${put.raw.slice(0, 120)}` };
      }

      const comanda = await api<{ id: string }>('POST', '/api/comandas', {
        token: tenant.atendenteTokens[0],
        body: {
          eventoId: tenant.eventoId,
          clienteNome: 'Cliente Fórmula',
          clienteTelefone: uniquePortalTestPhone(51, 7),
        },
      });
      if (comanda.status !== 201 || !comanda.data?.id) {
        return { status: 'failed', message: 'Criar comanda', expected: '201', actual: String(comanda.status) };
      }

      const item = await api('POST', `/api/comandas/${comanda.data.id}/itens`, {
        token: tenant.atendenteTokens[0],
        body: { produtoId: produto.data.id, volumeMl: UNIT_ML, quantidade: 1 },
      });
      if (item.status !== 201) {
        return { status: 'failed', message: 'Lançar item', expected: '201', actual: `${item.status} ${item.raw.slice(0, 120)}` };
      }

      const atual = await api<{ total: string | number }>('GET', `/api/comandas/${comanda.data.id}`, {
        token: tenant.donoToken,
      });
      await api('POST', `/api/pagamentos/comandas/${comanda.data.id}/fechar`, {
        token: tenant.atendenteTokens[0],
        body: { pagamentos: [{ forma: 'DINHEIRO', valor: Number(atual.data?.total ?? 0) }] },
      });

      const r = await apiBytes('GET', `/api/relatorios/evento/${tenant.eventoId}/csv`, { token: tenant.donoToken });
      const linha = linhas(r.text).find((l) => l.includes('SUM(1+1)'));
      if (!linha) {
        return { status: 'failed', message: 'Produto não apareceu no CSV', expected: NOME_FORMULA, actual: 'ausente' };
      }
      if (linha.includes(`,"${NOME_FORMULA}"`)) {
        return {
          status: 'failed',
          message: 'Fórmula exportada sem neutralização',
          expected: `"'${NOME_FORMULA}"`,
          actual: `"${NOME_FORMULA}"`,
        };
      }
      if (!linha.includes(`"'${NOME_FORMULA}"`)) {
        return { status: 'failed', message: 'Formato inesperado', expected: `"'${NOME_FORMULA}"`, actual: linha.slice(0, 80) };
      }
      return { message: 'Fórmula prefixada com apóstrofo', expected: `"'${NOME_FORMULA}"`, actual: 'neutralizada' };
    },
  );

  await test(
    { id: 'CSV-07', category: 'Exportação CSV', name: 'CSV de transações exige DONO', requirement: 'CSV-07' },
    async () => {
      const r = await api('GET', `/api/eventos/${tenant.eventoId}/transacoes/csv`, {
        token: tenant.atendenteTokens[0],
      });
      if (r.status !== 403) {
        return { status: 'failed', message: 'ATENDENTE exportou transações', expected: '403', actual: String(r.status) };
      }
      return { message: 'Log de transações restrito ao DONO', expected: '403', actual: '403' };
    },
  );

  await test(
    { id: 'CSV-08', category: 'Exportação CSV', name: 'CSV de transações com BOM e todas as células citadas', requirement: 'CSV-08' },
    async () => {
      const r = await apiBytes('GET', `/api/eventos/${tenant.eventoId}/transacoes/csv`, { token: tenant.donoToken });
      if (r.status !== 200) {
        return { status: 'failed', message: 'Exportar transações', expected: '200', actual: String(r.status) };
      }
      if (r.bytes[0] !== 0xef || r.bytes[1] !== 0xbb || r.bytes[2] !== 0xbf) {
        return {
          status: 'failed',
          message: 'BOM ausente',
          expected: 'EF BB BF',
          actual: r.bytes.subarray(0, 3).toString('hex'),
        };
      }
      const todas = linhas(r.text);
      if (todas[0] !== 'data_hora,tipo,descricao,usuario,comanda_id') {
        return { status: 'failed', message: 'Cabeçalho', expected: 'data_hora,tipo,...', actual: String(todas[0]) };
      }
      if (todas.length < 2) {
        return { status: 'failed', message: 'CSV sem linhas de transação', expected: '≥1 linha', actual: '0' };
      }
      const semAspas = todas.slice(1).find((l) => !l.startsWith('"'));
      if (semAspas) {
        return { status: 'failed', message: 'Célula sem aspas', expected: 'todas citadas', actual: semAspas.slice(0, 60) };
      }
      return { message: `${todas.length - 1} transação(ões) exportada(s)`, expected: 'todas citadas', actual: 'OK' };
    },
  );

  await test(
    { id: 'CSV-09', category: 'Exportação CSV', name: 'Exportar evento de outro tenant → 404', requirement: 'CSV-09' },
    async () => {
      const outro = ctx.tenants.find((t) => t.cervejariaId !== tenant.cervejariaId);
      if (!outro) return { status: 'skipped', message: 'Sem segundo tenant' };
      const rel = await api('GET', `/api/relatorios/evento/${outro.eventoId}/csv`, { token: tenant.donoToken });
      const tx = await api('GET', `/api/eventos/${outro.eventoId}/transacoes/csv`, { token: tenant.donoToken });
      if (rel.status !== 404 || tx.status !== 404) {
        return {
          status: 'failed',
          message: 'Exportação cross-tenant',
          expected: '404/404',
          actual: `${rel.status}/${tx.status}`,
        };
      }
      return { message: 'Exportação isolada por tenant', expected: '404', actual: '404' };
    },
  );
}
