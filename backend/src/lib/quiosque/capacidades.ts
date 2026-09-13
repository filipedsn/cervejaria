import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { STATUS_NA_FILA } from './cozinha.js';
import { registrarTransacao, type RegistrarTransacaoInput } from '../transacao-log.js';

type TxClient = Prisma.TransactionClient;

export type OrigemAlteracaoCapacidade = 'ADMIN' | 'DONO';

export type AtualizarCapacidadesQuiosqueInput = {
  cervejariaId: string;
  usuarioId: string;
  papel: 'ADMIN' | 'DONO';
  origem: OrigemAlteracaoCapacidade;
  temCozinha?: boolean;
  controlaEstoque?: boolean;
  confirmacaoEstoque?: boolean;
};

type AuditRecorder = (input: RegistrarTransacaoInput) => Promise<unknown>;

export const updateCapacidadesQuiosqueSchema = z
  .object({
    temCozinha: z.boolean().optional(),
    controlaEstoque: z.boolean().optional(),
    confirmacaoEstoque: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (value) => value.temCozinha !== undefined || value.controlaEstoque !== undefined,
    'Informe ao menos uma capacidade para alterar',
  );

export class QuiosqueInativoError extends Error {
  statusCode = 404;

  constructor() {
    super('A empresa não possui Quiosque ativo');
    this.name = 'QuiosqueInativoError';
  }
}

export class CozinhaComPedidosAtivosError extends Error {
  statusCode = 409;

  constructor() {
    super('A cozinha não pode ser desativada enquanto houver pedidos em andamento');
    this.name = 'CozinhaComPedidosAtivosError';
  }
}

export class ConfirmacaoEstoqueObrigatoriaError extends Error {
  statusCode = 400;

  constructor() {
    super('Confirme que está ciente do impacto da alteração no controle de estoque');
    this.name = 'ConfirmacaoEstoqueObrigatoriaError';
  }
}

/**
 * Atualiza somente capacidades do Quiosque. O modo principal (ativo/exclusivo)
 * nunca faz parte desta operação.
 */
export async function atualizarCapacidadesQuiosque(
  tx: TxClient,
  input: AtualizarCapacidadesQuiosqueInput,
  auditRecorder: AuditRecorder = (audit) => registrarTransacao(audit, tx),
) {
  const atual = await tx.configuracaoQuiosque.findUnique({
    where: { cervejariaId: input.cervejariaId },
    select: {
      cervejariaId: true,
      ativo: true,
      exclusivo: true,
      controlaEstoque: true,
      temCozinha: true,
      usaCardapio: true,
      quantidadeMesas: true,
    },
  });

  if (!atual?.ativo) throw new QuiosqueInativoError();

  const alteraCozinha = input.temCozinha !== undefined && input.temCozinha !== atual.temCozinha;
  const alteraEstoque =
    input.controlaEstoque !== undefined && input.controlaEstoque !== atual.controlaEstoque;

  if (alteraEstoque && input.confirmacaoEstoque !== true) {
    throw new ConfirmacaoEstoqueObrigatoriaError();
  }

  if (alteraCozinha && input.temCozinha === false) {
    const pedidoAtivo = await tx.pedidoQuiosque.findFirst({
      where: {
        cervejariaId: input.cervejariaId,
        status: { in: STATUS_NA_FILA },
        itensComanda: { some: { exigePreparo: true } },
      },
      select: { id: true },
    });
    if (pedidoAtivo) throw new CozinhaComPedidosAtivosError();
  }

  if (!alteraCozinha && !alteraEstoque) return atual;

  const atualizado = await tx.configuracaoQuiosque.update({
    where: { cervejariaId: input.cervejariaId },
    data: {
      ...(alteraCozinha ? { temCozinha: input.temCozinha } : {}),
      ...(alteraEstoque ? { controlaEstoque: input.controlaEstoque } : {}),
    },
    select: {
      cervejariaId: true,
      ativo: true,
      exclusivo: true,
      controlaEstoque: true,
      temCozinha: true,
      usaCardapio: true,
      quantidadeMesas: true,
    },
  });

  const timestamp = new Date().toISOString();
  const alteracoes = [
    ...(alteraCozinha
      ? [{ campo: 'temCozinha', anterior: atual.temCozinha, novo: atualizado.temCozinha }]
      : []),
    ...(alteraEstoque
      ? [
          {
            campo: 'controlaEstoque',
            anterior: atual.controlaEstoque,
            novo: atualizado.controlaEstoque,
          },
        ]
      : []),
  ];

  for (const alteracao of alteracoes) {
    await auditRecorder({
      cervejariaId: input.cervejariaId,
      tipo:
        alteracao.campo === 'temCozinha'
          ? 'QUIOSQUE_PEDIDO_COZINHA'
          : 'QUIOSQUE_ESTOQUE_MOVIMENTO',
      usuarioId: input.usuarioId,
      entidadeTipo: 'ConfiguracaoQuiosque',
      entidadeId: input.cervejariaId,
      metadata: {
        operacao: 'QUIOSQUE_CAPACIDADE_ALTERADA',
        tenantId: input.cervejariaId,
        origem: input.origem,
        papel: input.papel,
        campo: alteracao.campo,
        valorAnterior: alteracao.anterior,
        valorNovo: alteracao.novo,
        timestamp,
        ...(alteracao.campo === 'controlaEstoque' && alteracao.novo === true
          ? { avisoDivergenciaSaldoConfirmado: true }
          : {}),
      },
    });
  }

  return atualizado;
}
