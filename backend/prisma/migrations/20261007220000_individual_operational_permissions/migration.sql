ALTER TABLE public."Usuario"
ADD COLUMN "permissoesOperacao" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Preserve the actions that existing attendants could already perform through
-- authenticated Por Caixa and event routes. Owner-only dashboards/reports and
-- owner-only cancellation of non-empty operational commands stay ungranted.
UPDATE public."Usuario"
SET "permissoesOperacao" = ARRAY[
  'cash.open',
  'cash.close',
  'cash.values.read',
  'cash.movement.write',
  'payment.receive',
  'debt.receive',
  'command.close',
  'command.cancel',
  'event.dashboard.read'
]::TEXT[] || CASE WHEN "podeDarDescontoOperacao" THEN ARRAY['discount.apply']::TEXT[] ELSE ARRAY[]::TEXT[] END
WHERE "papel" = 'ATENDENTE';
