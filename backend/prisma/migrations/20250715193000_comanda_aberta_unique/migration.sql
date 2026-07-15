-- Uma comanda ABERTA por (evento, cliente) — evita race em POST /sessao concorrente.
CREATE UNIQUE INDEX IF NOT EXISTS "Comanda_eventoId_clienteId_aberta_key"
ON "Comanda" ("eventoId", "clienteId")
WHERE status = 'ABERTA';
