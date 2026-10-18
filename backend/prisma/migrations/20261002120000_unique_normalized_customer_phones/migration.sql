-- A unicidade composta existente protege apenas valores textualmente iguais.
-- Esta expressão também considera máscara e código internacional +55.
DO $$
BEGIN
  IF EXISTS (
    WITH normalized AS (
      SELECT "cervejariaId",
        CASE
          WHEN left(regexp_replace("telefone", '[^0-9]', '', 'g'), 2) = '55'
            AND length(regexp_replace("telefone", '[^0-9]', '', 'g')) IN (12, 13)
          THEN substring(regexp_replace("telefone", '[^0-9]', '', 'g') FROM 3)
          ELSE left(regexp_replace("telefone", '[^0-9]', '', 'g'), 11)
        END AS telefone_normalizado
      FROM "Cliente"
      WHERE "telefone" IS NOT NULL
        AND length(regexp_replace("telefone", '[^0-9]', '', 'g')) >= 10
    )
    SELECT 1
    FROM normalized
    GROUP BY "cervejariaId", telefone_normalizado
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Clientes duplicados por telefone normalizado. Unifique os cadastros duplicados e reaplique esta migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "Cliente_cervejariaId_telefone_normalized_key"
ON "Cliente" (
  "cervejariaId",
  (
    CASE
      WHEN left(regexp_replace("telefone", '[^0-9]', '', 'g'), 2) = '55'
        AND length(regexp_replace("telefone", '[^0-9]', '', 'g')) IN (12, 13)
      THEN substring(regexp_replace("telefone", '[^0-9]', '', 'g') FROM 3)
      ELSE left(regexp_replace("telefone", '[^0-9]', '', 'g'), 11)
    END
  )
)
WHERE "telefone" IS NOT NULL
  AND length(regexp_replace("telefone", '[^0-9]', '', 'g')) >= 10;
