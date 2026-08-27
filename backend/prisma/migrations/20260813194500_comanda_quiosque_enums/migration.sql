-- Enum extensions must commit before use in a follow-up migration (PostgreSQL 55P04).

CREATE TYPE "public"."ComandaOrigem" AS ENUM ('EVENTO', 'QUIOSQUE');

ALTER TYPE "public"."ComandaTipo" ADD VALUE IF NOT EXISTS 'MESA';
ALTER TYPE "public"."ComandaTipo" ADD VALUE IF NOT EXISTS 'FICHA';
ALTER TYPE "public"."ComandaTipo" ADD VALUE IF NOT EXISTS 'APELIDO';
