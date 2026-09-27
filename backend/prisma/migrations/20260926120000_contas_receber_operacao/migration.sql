ALTER TABLE public."Pagamento"
  ADD COLUMN IF NOT EXISTS "contaReceberId" text,
  ADD COLUMN IF NOT EXISTS "sessaoCaixaId" text;

CREATE TABLE IF NOT EXISTS public."ContaReceber" (
  "id" text PRIMARY KEY,
  "comandaId" text NOT NULL UNIQUE,
  "clienteId" text NOT NULL,
  "valorOriginal" numeric(10,2) NOT NULL,
  "criadoPorId" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "Pagamento_contaReceberId_pagoEm_idx"
  ON public."Pagamento"("contaReceberId", "pagoEm");
CREATE INDEX IF NOT EXISTS "Pagamento_sessaoCaixaId_pagoEm_idx"
  ON public."Pagamento"("sessaoCaixaId", "pagoEm");
CREATE INDEX IF NOT EXISTS "ContaReceber_clienteId_createdAt_idx"
  ON public."ContaReceber"("clienteId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Pagamento_contaReceberId_fkey') THEN
    ALTER TABLE public."Pagamento" ADD CONSTRAINT "Pagamento_contaReceberId_fkey"
      FOREIGN KEY ("contaReceberId") REFERENCES public."ContaReceber"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContaReceber_comandaId_fkey') THEN
    ALTER TABLE public."ContaReceber" ADD CONSTRAINT "ContaReceber_comandaId_fkey"
      FOREIGN KEY ("comandaId") REFERENCES public."Comanda"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContaReceber_clienteId_fkey') THEN
    ALTER TABLE public."ContaReceber" ADD CONSTRAINT "ContaReceber_clienteId_fkey"
      FOREIGN KEY ("clienteId") REFERENCES public."Cliente"("id") ON DELETE RESTRICT;
  END IF;
END $$;
