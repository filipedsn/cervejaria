-- Logical archive only. Preserve schedules, occurrences, maps and audit history.
ALTER TABLE "quiosque"."AgendaOperacional" ADD COLUMN "archivedAt" TIMESTAMP(3);
