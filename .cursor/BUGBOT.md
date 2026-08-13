# Revisao de PR — Quiver Tap

O Bugbot nao le `.cursor/rules/`. O que importa para revisar este repositorio esta aqui.

## Contexto

Sistema de gestao para eventos de cervejaria: comanda, caixa, cozinha, quiosque e portal
do cliente. Backend Fastify + Prisma (`backend/`), frontend React + Vite (`frontend/`),
multi-tenant por `cervejariaId`.

Parte dos PRs vem de um agente automatizado (branch `fix/auto-<N>`, label `auto-fix`).
Nesses PRs assuma menos contexto do autor e cobre evidencia mais forte.

## Prioridade maxima

1. **Vazamento entre tenants.** Toda query que le ou escreve dado de negocio precisa
   filtrar por `cervejariaId` (ou por `eventoId` de uma cervejaria ja validada). Um
   `findMany` sem esse filtro e um bug de seguranca, nao de estilo.
2. **Dinheiro.** Comanda, caixa, desconto, pagamento e fechamento. Verifique
   arredondamento, soma de itens, subtracao de desconto e idempotencia. Valor monetario
   nao pode depender de ordem de execucao nem de ponto flutuante acumulado.
3. **Autorizacao.** Rota nova sem verificacao de papel/tenant. Confira se segue o padrao
   das rotas vizinhas em `backend/src/routes/`.
4. **Producao.** Qualquer mudanca em `deploy/**`, `.env*`, `scripts/prod/**`,
   `backend/prisma/migrations/**` ou `.cursor/hooks/**` vinda de PR automatico deve ser
   apontada como fora de escopo — o agente nao tem permissao para tocar nesses caminhos.

## Migrations

Migration precisa de rollback correspondente em `backend/prisma/rollbacks/` com o mesmo
timestamp. `DROP COLUMN`, `DROP TABLE` e `NOT NULL` sem default em tabela populada sao
destrutivos: exija a justificativa no PR.

## Testes

Correcao de bug sem teste que falha antes e passa depois esta incompleta. Testes usam
`node --test` e `fast-check` para propriedades (`backend/src/lib/*.test.ts`). Teste que
so exercita o caminho feliz nao comprova a correcao.

## O que nao apontar

- Formatacao e preferencia de estilo — nao ha formatador imposto no projeto.
- Mensagens de UI e comentarios em portugues sem acento; e a convencao daqui.
- Ausencia de tipagem estrita no backend: existem erros de `tsc` pre-existentes, e o job
  `backend-build` do CI e informativo por isso. Nao trate como regressao do PR.
- Sugestao de extrair helper ou renomear, quando o codigo segue o padrao dos arquivos
  vizinhos.

Prefira dois achados que travam o merge a dez observacoes genericas.
