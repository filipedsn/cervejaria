CREATE TABLE "public"."ConfiguracaoOperacional" (
    "cervejariaId" TEXT NOT NULL,
    "directSalesEnabled" BOOLEAN,
    "plannedOperationsEnabled" BOOLEAN,
    "tapsEnabled" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracaoOperacional_pkey" PRIMARY KEY ("cervejariaId")
);

ALTER TABLE "public"."ConfiguracaoOperacional"
ADD CONSTRAINT "ConfiguracaoOperacional_cervejariaId_fkey"
FOREIGN KEY ("cervejariaId") REFERENCES "public"."Cervejaria"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
