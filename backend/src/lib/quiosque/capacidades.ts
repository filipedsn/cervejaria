import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { registrarTransacao, type RegistrarTransacaoInput } from '../transacao-log.js';
import { updateOperationalConfig } from '../operational-config.js';

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

  const operacional = await tx.configuracaoOperacional.findUnique({ where: { cervejariaId: input.cervejariaId } });
  if (!atual?.ativo && !operacional) throw new QuiosqueInativoError();

  const atualEstoque = operacional?.inventoryEnabled ?? atual?.controlaEstoque ?? false;
  const atualCozinha = operacional?.kitchenEnabled ?? atual?.temCozinha ?? false;

  const alteraCozinha = input.temCozinha !== undefined && input.temCozinha !== atualCozinha;
  const alteraEstoque =
    input.controlaEstoque !== undefined && input.controlaEstoque !== atualEstoque;

  if (alteraEstoque && input.confirmacaoEstoque !== true) {
    throw new ConfirmacaoEstoqueObrigatoriaError();
  }

  if (!alteraCozinha && !alteraEstoque) {
    return atual ?? {
      cervejariaId: input.cervejariaId,
      ativo: true,
      exclusivo: false,
      controlaEstoque: atualEstoque,
      temCozinha: atualCozinha,
      usaCardapio: false,
      quantidadeMesas: 0,
    };
  }

  await updateOperationalConfig(tx, input.cervejariaId, {
    ...(alteraCozinha ? { kitchenEnabled: input.temCozinha } : {}),
    ...(alteraEstoque ? { inventoryEnabled: input.controlaEstoque, confirmacaoEstoque: input.confirmacaoEstoque } : {}),
  });

  const atualizado = atual
    ? await tx.configuracaoQuiosque.update({
        where: { cervejariaId: input.cervejariaId },
        data: {
          ...(alteraCozinha ? { temCozinha: input.temCozinha } : {}),
          ...(alteraEstoque ? { controlaEstoque: input.controlaEstoque } : {}),
        },
      })
    : {
        cervejariaId: input.cervejariaId,
        ativo: true,
        exclusivo: false,
        controlaEstoque: input.controlaEstoque ?? atualEstoque,
        temCozinha: input.temCozinha ?? atualCozinha,
        usaCardapio: false,
        quantidadeMesas: 0,
      };

  const timestamp = new Date().toISOString();
  const alteracoes = [
    ...(alteraCozinha
      ? [{ campo: 'temCozinha', anterior: atualCozinha, novo: atualizado.temCozinha }]
      : []),
    ...(alteraEstoque
      ? [
          {
            campo: 'controlaEstoque',
            anterior: atualEstoque,
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
      entidadeTipo: 'ConfiguracaoOperacional',
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
