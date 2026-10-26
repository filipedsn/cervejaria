-- DropForeignKey
ALTER TABLE "ContaReceber" DROP CONSTRAINT "ContaReceber_clienteId_fkey";

-- DropForeignKey
ALTER TABLE "ContaReceber" DROP CONSTRAINT "ContaReceber_comandaId_fkey";

-- DropForeignKey
ALTER TABLE "ItemComandaOpcional" DROP CONSTRAINT "ItemComandaOpcional_opcionalCatalogoId_fkey";

-- DropForeignKey
ALTER TABLE "Opcional" DROP CONSTRAINT "Opcional_cervejariaId_fkey";

-- DropForeignKey
ALTER TABLE "Pagamento" DROP CONSTRAINT "Pagamento_contaReceberId_fkey";

-- DropForeignKey
ALTER TABLE "ProdutoOpcionalVinculo" DROP CONSTRAINT "ProdutoOpcionalVinculo_opcionalId_fkey";

-- DropForeignKey
ALTER TABLE "ProdutoOpcionalVinculo" DROP CONSTRAINT "ProdutoOpcionalVinculo_produtoId_fkey";

-- DropForeignKey
ALTER TABLE "Tap" DROP CONSTRAINT "Tap_trailerId_fkey";

-- DropIndex
DROP INDEX "Comanda_sessaoCaixaRealizacaoId_idx";

-- DropIndex
DROP INDEX "PedidoCliente_idempotencyKey_key";

-- DropIndex
DROP INDEX "Produto_categoriaPdvId_cervejariaId_idx";

-- DropIndex
DROP INDEX "Tap_pontoVendaId_idx";

-- AlterTable
ALTER TABLE "Opcional" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PedidoCliente" DROP COLUMN "idempotencyKey";

-- AlterTable
ALTER TABLE "PedidoClienteItem" DROP COLUMN "observacao",
DROP COLUMN "opcionais",
DROP COLUMN "paraViagem";

-- DropEnum
DROP TYPE "quiosque"."FormaPagamentoQuiosque";

-- DropEnum
DROP TYPE "quiosque"."StatusComandaQuiosque";

-- DropEnum
DROP TYPE "quiosque"."TipoComandaQuiosque";

-- RenameForeignKey
ALTER TABLE "Tap" RENAME CONSTRAINT "Tap_pontoVendaId_fkey" TO "Tap_pontoVendaId_cervejariaId_fkey";

-- RenameForeignKey
ALTER TABLE "quiosque"."MovimentoEstoqueQuiosque" RENAME CONSTRAINT "MovimentoEstoqueQuiosque_pedidoId_tenant_point_fkey" TO "MovimentoEstoqueQuiosque_pedidoId_cervejariaId_pontoVendaI_fkey";

-- AddForeignKey
ALTER TABLE "Opcional" ADD CONSTRAINT "Opcional_cervejariaId_fkey" FOREIGN KEY ("cervejariaId") REFERENCES "Cervejaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoOpcionalVinculo" ADD CONSTRAINT "ProdutoOpcionalVinculo_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoOpcionalVinculo" ADD CONSTRAINT "ProdutoOpcionalVinculo_opcionalId_fkey" FOREIGN KEY ("opcionalId") REFERENCES "Opcional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tap" ADD CONSTRAINT "Tap_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemComandaOpcional" ADD CONSTRAINT "ItemComandaOpcional_opcionalCatalogoId_fkey" FOREIGN KEY ("opcionalCatalogoId") REFERENCES "Opcional"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_contaReceberId_fkey" FOREIGN KEY ("contaReceberId") REFERENCES "ContaReceber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaReceber" ADD CONSTRAINT "ContaReceber_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "Comanda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaReceber" ADD CONSTRAINT "ContaReceber_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "PdvCategoriaTransformacaoProduto_categoria_idx" RENAME TO "PdvCategoriaTransformacaoProduto_transformacao_cervejariaId_idx";

