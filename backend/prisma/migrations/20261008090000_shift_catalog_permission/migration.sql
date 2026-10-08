-- Preserve the operational catalog actions that ATENDENTE users could use
-- before catalog maintenance was split into global and shift-scoped grants.
UPDATE public."Usuario" AS u
SET "permissoesOperacao" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest(u."permissoesOperacao" || ARRAY['catalog.shift.manage']::TEXT[]) AS permission
  ORDER BY permission
)
WHERE u."papel" = 'ATENDENTE';
