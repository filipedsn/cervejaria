-- Add canonical PDV ownership while keeping the legacy Trailer bridge intact.
ALTER TABLE public."Tap" ALTER COLUMN "trailerId" DROP NOT NULL;
ALTER TABLE public."Tap" ADD COLUMN IF NOT EXISTS "pontoVendaId" TEXT;

ALTER TABLE public."Tap" DROP CONSTRAINT IF EXISTS "Tap_produtoId_fkey";
ALTER TABLE public."Tap" DROP CONSTRAINT IF EXISTS "Tap_produtoId_cervejariaId_fkey";
ALTER TABLE public."Tap" DROP CONSTRAINT IF EXISTS "Tap_pontoVendaId_fkey";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Tap_pontoVendaId_fkey' AND conrelid = 'public."Tap"'::regclass) THEN
    ALTER TABLE public."Tap" ADD CONSTRAINT "Tap_pontoVendaId_fkey"
      FOREIGN KEY ("pontoVendaId", "cervejariaId") REFERENCES quiosque."PontoVenda"("id", "cervejariaId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  ALTER TABLE public."Tap" ADD CONSTRAINT "Tap_produtoId_cervejariaId_fkey"
    FOREIGN KEY ("produtoId", "cervejariaId") REFERENCES public."Produto"("id", "cervejariaId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Tap_pontoVendaId_numero_key"
  ON public."Tap"("pontoVendaId", "numero");
CREATE INDEX IF NOT EXISTS "Tap_pontoVendaId_idx" ON public."Tap"("pontoVendaId");

-- A concurrent swap must never leave two open mounts for the same tap/context.
CREATE UNIQUE INDEX IF NOT EXISTS "TapMontagem_active_event_tap_key"
  ON public."TapMontagem"("eventoId", "tapId")
  WHERE "eventoId" IS NOT NULL AND "encerradoEm" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "TapMontagem_active_session_tap_key"
  ON public."TapMontagem"("sessaoCaixaId", "tapId")
  WHERE "sessaoCaixaId" IS NOT NULL AND "encerradoEm" IS NULL;

-- Mount history is evidence and must survive attempted parent deletion.
DO $$ DECLARE c RECORD; BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public."TapMontagem"'::regclass
      AND confrelid IN ('public."Tap"'::regclass, 'public."Evento"'::regclass,
                        'quiosque."SessaoCaixaQuiosque"'::regclass)
      AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE public."TapMontagem" DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public."TapMontagem" ADD CONSTRAINT "TapMontagem_tapId_fkey"
  FOREIGN KEY ("tapId") REFERENCES public."Tap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public."TapMontagem" ADD CONSTRAINT "TapMontagem_eventoId_fkey"
  FOREIGN KEY ("eventoId") REFERENCES public."Evento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public."TapMontagem" ADD CONSTRAINT "TapMontagem_sessaoCaixaId_fkey"
  FOREIGN KEY ("sessaoCaixaId") REFERENCES quiosque."SessaoCaixaQuiosque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
