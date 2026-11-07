import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { toNumber } from '../utils.js';
import { isBebidaChopeOperacao } from '../produto-utils.js';
import { assertProdutoNoCardapioTurno } from './sessao-cardapio.js';
import type { EstacaoPreparo } from './estacao-preparo.js';

type TxClient = Prisma.TransactionClient;

export class ComboInvalidoError extends Error {
  statusCode = 400;
}

export type EscolhaComboInput = { grupoId: string; opcaoIds: string[] };

export type GrupoComboInput = {
  nome: string;
  minimo: number;
  maximo: number;
  somenteCardapioTurno?: boolean;
  opcoes: Array<{ produtoId: string; precoNoCombo: number; quantidade?: number }>;
};

export const LIMITES_COMBO = { grupos: 20, opcoesPorGrupo: 100, quantidadePorOpcao: 20 } as const;

export const escolhasComboSchema = z.array(z.object({
  grupoId: z.string().min(1),
  opcaoIds: z.array(z.string().min(1)).max(LIMITES_COMBO.opcoesPorGrupo),
})).max(LIMITES_COMBO.grupos).optional();

export const composicaoComboSchema = z.object({
  grupos: z.array(z.object({
    nome: z.string().trim().min(1).max(80),
    minimo: z.number().int().min(0).max(LIMITES_COMBO.opcoesPorGrupo),
    maximo: z.number().int().min(1).max(LIMITES_COMBO.opcoesPorGrupo),
    somenteCardapioTurno: z.boolean().optional(),
    opcoes: z.array(z.object({
      produtoId: z.string().min(1),
      precoNoCombo: z.number().min(0).max(99999),
      quantidade: z.number().int().min(1).max(LIMITES_COMBO.quantidadePorOpcao).optional(),
    })).min(1).max(LIMITES_COMBO.opcoesPorGrupo),
  })).min(1).max(LIMITES_COMBO.grupos),
});

const PRODUTO_DA_OPCAO = {
  id: true, nome: true, ativo: true, combo: true, tipo: true, formato: true, categoria: true,
  exigePreparo: true, estacaoPreparo: true, controlaEstoque: true,
} satisfies Prisma.ProdutoSelect;

const INCLUDE_COMPOSICAO = {
  opcoes: { orderBy: { ordem: 'asc' }, include: { produto: { select: PRODUTO_DA_OPCAO } } },
} satisfies Prisma.ComboGrupoInclude;

export async function listarComposicaoCombo(client: TxClient, comboProdutoId: string) {
  const grupos = await client.comboGrupo.findMany({
    where: { comboProdutoId },
    orderBy: { ordem: 'asc' },
    include: INCLUDE_COMPOSICAO,
  });
  return grupos.map((grupo) => ({
    id: grupo.id,
    nome: grupo.nome,
    minimo: grupo.minimo,
    maximo: grupo.maximo,
    somenteCardapioTurno: grupo.somenteCardapioTurno,
    opcoes: grupo.opcoes.map((opcao) => ({
      id: opcao.id,
      produtoId: opcao.produtoId,
      nome: opcao.produto.nome,
      ativo: opcao.produto.ativo,
      categoria: opcao.produto.categoria,
      precoNoCombo: toNumber(opcao.precoNoCombo),
      quantidade: opcao.quantidade,
      exigePreparo: opcao.produto.exigePreparo,
      estacaoPreparo: opcao.produto.estacaoPreparo,
      controlaEstoque: opcao.produto.controlaEstoque,
    })),
  }));
}

/** "A partir de": em cada grupo, as `minimo` opções mais baratas. */
export function precoBaseCombo(grupos: Array<{ minimo: number; opcoes: Array<{ precoNoCombo: number; quantidade?: number }> }>): number {
  const centavos = grupos.reduce((total, grupo) => {
    const valores = grupo.opcoes
      .map((opcao) => Math.round(opcao.precoNoCombo * 100) * (opcao.quantidade ?? 1))
      .sort((a, b) => a - b);
    return total + valores.slice(0, grupo.minimo).reduce((soma, valor) => soma + valor, 0);
  }, 0);
  return centavos / 100;
}

/**
 * Preço unitário de cada componente para uma unidade do combo. O fator vem do
 * preço do combo no cardápio/turno sobre o preço do catálogo; a diferença de
 * arredondamento vai para o último componente vendido em quantidade 1, para o
 * total bater com o cardápio.
 */
export function ratearPrecoCombo(linhas: Array<{ precoNoCombo: number; quantidade: number }>, fator: number): number[] {
  const unitarios = linhas.map((linha) => Math.round(Math.round(linha.precoNoCombo * 100) * fator));
  const alvo = Math.round(linhas.reduce((soma, linha) => soma + Math.round(linha.precoNoCombo * 100) * linha.quantidade, 0) * fator);
  const somado = unitarios.reduce((soma, valor, indice) => soma + valor * linhas[indice]!.quantidade, 0);
  const ajustavel = linhas.map((linha) => linha.quantidade).lastIndexOf(1);
  if (ajustavel >= 0) unitarios[ajustavel] = Math.max(0, unitarios[ajustavel]! + alvo - somado);
  return unitarios.map((valor) => valor / 100);
}

export function fatorPrecoCombo(precoEfetivo: number, precoCatalogo: number): number {
  return precoCatalogo > 0 ? precoEfetivo / precoCatalogo : 1;
}

export function validarGruposCombo(grupos: GrupoComboInput[]) {
  if (grupos.length === 0) throw new ComboInvalidoError('Inclua ao menos um grupo no combo');
  if (grupos.length > LIMITES_COMBO.grupos) throw new ComboInvalidoError(`Um combo aceita até ${LIMITES_COMBO.grupos} grupos`);
  for (const grupo of grupos) {
    const nome = grupo.nome.trim();
    if (!nome) throw new ComboInvalidoError('Dê um nome para cada grupo do combo');
    if (grupo.opcoes.length === 0) throw new ComboInvalidoError(`Inclua ao menos um produto em "${nome}"`);
    if (grupo.opcoes.length > LIMITES_COMBO.opcoesPorGrupo) throw new ComboInvalidoError(`"${nome}" aceita até ${LIMITES_COMBO.opcoesPorGrupo} produtos`);
    if (!Number.isInteger(grupo.minimo) || grupo.minimo < 0) throw new ComboInvalidoError(`Mínimo inválido em "${nome}"`);
    if (!Number.isInteger(grupo.maximo) || grupo.maximo < 1 || grupo.maximo < grupo.minimo) throw new ComboInvalidoError(`O máximo de "${nome}" deve ser pelo menos 1 e não menor que o mínimo`);
    if (grupo.maximo > grupo.opcoes.length) throw new ComboInvalidoError(`"${nome}" permite escolher ${grupo.maximo}, mas tem só ${grupo.opcoes.length} produto(s)`);
    if (new Set(grupo.opcoes.map((opcao) => opcao.produtoId)).size !== grupo.opcoes.length) throw new ComboInvalidoError(`Produto repetido em "${nome}"`);
    for (const opcao of grupo.opcoes) {
      if (!(opcao.precoNoCombo >= 0)) throw new ComboInvalidoError(`Preço inválido em "${nome}"`);
      const quantidade = opcao.quantidade ?? 1;
      if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > LIMITES_COMBO.quantidadePorOpcao) throw new ComboInvalidoError(`Quantidade inválida em "${nome}"`);
    }
  }
  if (!grupos.some((grupo) => grupo.minimo >= 1)) throw new ComboInvalidoError('Ao menos um grupo precisa ser obrigatório (mínimo 1)');
}

export async function substituirComposicaoCombo(tx: TxClient, cervejariaId: string, comboProdutoId: string, grupos: GrupoComboInput[]) {
  const combo = await tx.produto.findFirst({ where: { id: comboProdutoId, cervejariaId }, select: { id: true, combo: true, pontoVendaId: true } });
  if (!combo) throw Object.assign(new Error('Produto não encontrado'), { statusCode: 404 });
  if (!combo.combo) throw new ComboInvalidoError('Este produto não é um combo');
  validarGruposCombo(grupos);

  const produtoIds = [...new Set(grupos.flatMap((grupo) => grupo.opcoes.map((opcao) => opcao.produtoId)))];
  const produtos = await tx.produto.findMany({
    where: { id: { in: produtoIds }, cervejariaId },
    select: { ...PRODUTO_DA_OPCAO, pontoVendaId: true, precos: { select: { volumeMl: true } } },
  });
  if (produtos.length !== produtoIds.length || produtos.some((produto) => produto.pontoVendaId !== combo.pontoVendaId)) {
    throw Object.assign(new Error('Produto do combo não pertence à empresa ou ao ponto de venda'), { statusCode: 404 });
  }
  for (const produto of produtos) {
    if (produto.combo) throw new ComboInvalidoError(`${produto.nome} é um combo e não pode fazer parte de outro combo`);
    if (isBebidaChopeOperacao(produto)) throw new ComboInvalidoError(`${produto.nome} é vendido por Tap e não pode fazer parte de um combo`);
  }

  await tx.comboGrupo.deleteMany({ where: { comboProdutoId } });
  for (const [ordem, grupo] of grupos.entries()) {
    await tx.comboGrupo.create({
      data: {
        comboProdutoId,
        cervejariaId,
        nome: grupo.nome.trim(),
        minimo: grupo.minimo,
        maximo: grupo.maximo,
        somenteCardapioTurno: grupo.somenteCardapioTurno ?? false,
        ordem,
        opcoes: {
          create: grupo.opcoes.map((opcao, ordemOpcao) => ({
            produtoId: opcao.produtoId,
            precoNoCombo: opcao.precoNoCombo,
            quantidade: opcao.quantidade ?? 1,
            ordem: ordemOpcao,
          })),
        },
      },
    });
  }

  await tx.preco.deleteMany({ where: { produtoId: comboProdutoId } });
  await tx.preco.create({ data: { produtoId: comboProdutoId, volumeMl: 1, preco: precoBaseCombo(grupos) } });
  return listarComposicaoCombo(tx, comboProdutoId);
}

/**
 * Transforma um produto simples em combo. Preço de catálogo e cardápios ficam como estão
 * até a composição ser salva; vendas antigas continuam como item comum.
 */
export async function converterProdutoEmCombo(tx: TxClient, cervejariaId: string, produtoId: string) {
  const produto = await tx.produto.findFirst({
    where: { id: produtoId, cervejariaId },
    select: { id: true, nome: true, tipo: true, formato: true, categoria: true, combo: true, precos: { select: { volumeMl: true } } },
  });
  if (!produto) throw Object.assign(new Error('Produto não encontrado'), { statusCode: 404 });
  if (produto.combo) throw new ComboInvalidoError(`${produto.nome} já é um combo`);
  if (produto.categoria === 'Chope' || isBebidaChopeOperacao(produto)) {
    throw new ComboInvalidoError(`${produto.nome} é vendido por Tap e não pode virar combo`);
  }

  const opcaoEmCombo = await tx.comboGrupoOpcao.findFirst({
    where: { produtoId },
    select: { grupo: { select: { comboProduto: { select: { nome: true } } } } },
  });
  if (opcaoEmCombo) {
    throw new ComboInvalidoError(`${produto.nome} faz parte do combo ${opcaoEmCombo.grupo.comboProduto.nome}. Retire-o de lá antes de transformá-lo em combo`);
  }

  const saldo = await tx.inventoryBalance.findFirst({ where: { produtoId, NOT: { quantidade: 0 } }, select: { quantidade: true } });
  if (saldo) {
    throw new ComboInvalidoError(`${produto.nome} tem ${toNumber(saldo.quantidade).toLocaleString('pt-BR')} un em estoque. Zere o estoque antes de transformá-lo em combo`);
  }

  await tx.produtoOpcionalVinculo.deleteMany({ where: { produtoId } });
  return tx.produto.update({
    where: { id: produtoId },
    data: { combo: true, exigePreparo: false, prepararEmPedidoSeparado: false, controlaEstoque: false },
    select: { id: true },
  });
}

export type ComponenteComboResolvido = {
  produtoId: string;
  nome: string;
  grupoNome: string;
  precoUnit: number;
  quantidade: number;
  exigePreparo: boolean;
  estacaoPreparo: EstacaoPreparo;
  controlaEstoque: boolean;
};

/** Confere as escolhas contra a composição atual e devolve os componentes de uma linha de combo. */
export async function resolverEscolhasCombo(
  tx: TxClient,
  params: {
    comboProdutoId: string;
    comboNome: string;
    quantidade: number;
    escolhas: EscolhaComboInput[] | undefined;
    precoEfetivo: number;
    precoCatalogo: number;
    sessaoCaixaId?: string;
  },
): Promise<ComponenteComboResolvido[]> {
  const grupos = await tx.comboGrupo.findMany({
    where: { comboProdutoId: params.comboProdutoId },
    orderBy: { ordem: 'asc' },
    include: INCLUDE_COMPOSICAO,
  });
  if (grupos.length === 0) throw new ComboInvalidoError(`${params.comboNome} ainda não tem composição`);

  const escolhas = params.escolhas ?? [];
  const gruposPorId = new Map(grupos.map((grupo) => [grupo.id, grupo]));
  if (escolhas.some((escolha) => !gruposPorId.has(escolha.grupoId))) {
    throw new ComboInvalidoError(`A composição de ${params.comboNome} mudou. Escolha os itens novamente.`);
  }
  const escolhidasPorGrupo = new Map<string, Set<string>>();
  for (const escolha of escolhas) {
    const atuais = escolhidasPorGrupo.get(escolha.grupoId) ?? new Set<string>();
    for (const opcaoId of escolha.opcaoIds) atuais.add(opcaoId);
    escolhidasPorGrupo.set(escolha.grupoId, atuais);
  }

  const linhas: Array<{ grupoNome: string; opcao: (typeof grupos)[number]['opcoes'][number] }> = [];
  for (const grupo of grupos) {
    const escolhidas = escolhidasPorGrupo.get(grupo.id) ?? new Set<string>();
    const opcoes = grupo.opcoes.filter((opcao) => escolhidas.has(opcao.id));
    if (opcoes.length !== escolhidas.size) {
      throw new ComboInvalidoError(`A composição de ${params.comboNome} mudou. Escolha os itens novamente.`);
    }
    if (opcoes.length < grupo.minimo || opcoes.length > grupo.maximo) {
      const faixa = grupo.minimo === grupo.maximo ? `${grupo.minimo}` : `de ${grupo.minimo} a ${grupo.maximo}`;
      throw new ComboInvalidoError(`Escolha ${faixa} opção(ões) em "${grupo.nome}"`);
    }
    for (const opcao of opcoes) {
      if (!opcao.produto.ativo) throw new ComboInvalidoError(`${opcao.produto.nome} está indisponível`);
      if (grupo.somenteCardapioTurno && params.sessaoCaixaId
        && !(await assertProdutoNoCardapioTurno(params.sessaoCaixaId, opcao.produtoId, 0))) {
        throw new ComboInvalidoError(`${opcao.produto.nome} não está no cardápio deste turno`);
      }
      linhas.push({ grupoNome: grupo.nome, opcao });
    }
  }

  const precos = ratearPrecoCombo(
    linhas.map(({ opcao }) => ({ precoNoCombo: toNumber(opcao.precoNoCombo), quantidade: opcao.quantidade })),
    fatorPrecoCombo(params.precoEfetivo, params.precoCatalogo),
  );
  return linhas.map(({ grupoNome, opcao }, indice) => ({
    produtoId: opcao.produtoId,
    nome: opcao.produto.nome,
    grupoNome,
    precoUnit: precos[indice]!,
    quantidade: params.quantidade * opcao.quantidade,
    exigePreparo: opcao.produto.exigePreparo,
    estacaoPreparo: opcao.produto.estacaoPreparo,
    controlaEstoque: opcao.produto.controlaEstoque,
  }));
}
