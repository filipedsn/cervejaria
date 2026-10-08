-- Keep only operations that ATENDENTE users could already perform under the
-- tenant and PDV checks. Owner-only administration remains an explicit grant.
UPDATE public."Usuario" AS u
SET "permissoesOperacao" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest(u."permissoesOperacao" || ARRAY[
    'command.operate',
    'command.read',
    'kitchen.read',
    'kitchen.operate',
    'inventory.read',
    'inventory.adjust',
    'clients.manage',
    'taps.operate',
    'event.menu.manage'
  ]::TEXT[]) AS permission
  ORDER BY permission
)
WHERE u."papel" = 'ATENDENTE';
