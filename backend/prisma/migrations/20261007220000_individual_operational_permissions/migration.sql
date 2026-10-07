ALTER TABLE public."Usuario"
ADD COLUMN "permissoesOperacao" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Preserve existing attendant actions. Item removal had a separate legacy
-- route; full Por Caixa command cancellation was owner-only and is not granted.
UPDATE public."Usuario"
SET "permissoesOperacao" = ARRAY[
  'cash.open',
  'cash.close',
  'cash.values.read',
  'cash.movement.write',
  'payment.receive',
  'debt.receive',
  'command.close',
  'command.item.cancel',
  'event.dashboard.read'
]::TEXT[] || CASE WHEN "podeDarDescontoOperacao" THEN ARRAY['discount.apply']::TEXT[] ELSE ARRAY[]::TEXT[] END
WHERE "papel" = 'ATENDENTE';
