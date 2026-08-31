# TQ-SA-05 — Incident engine determinístico

Data: 2026-08-31  
Status: concluído — testes offline, typecheck, build e replay sintético validados.

## Modelo e fronteira

Evento é uma observação normalizada; relação é evidência entre dois eventos; incidente é a agregação operacional de ocorrências compatíveis. O `Incident` V1 contém somente identificação técnica, janela temporal, contadores, IDs técnicos de tenant quando necessários, releases, rota normalizada, sinais agregados e reasons estruturados. Ele não persiste payload bruto, body, stack, SQL, bindings, credenciais, IDs de request/correlation/trace/span ou ator.

Os estados são `NEW`, `OBSERVING`, `ASSESSED` (reservado ao contrato) e `CLOSED`. Um incidente novo inicia em `NEW`; ao receber ocorrência única nova passa a `OBSERVING`; fica elegível para `CLOSED` após 60 minutos sem ocorrência, calculados contra `referenceTime` explícito. Não há daemon, polling, workflow ITSM, dossier, feedback, LLM/Ollama ou escrita externa.

## Fingerprint, episódios e dedupe

O fingerprint V1 é SHA-256 do canonical `class | signature técnica | route/action | service | release | tenant policy`. A rota remove query string, UUIDs, IDs numéricos e hashes longos (`/api/comandas/123/fechar?x=1` vira `/api/comandas/:id/fechar`). A release sempre participa: ausência usa apenas o marcador técnico interno `release:unknown`, sem inventar um `releaseSha` no incidente.

Tenant entra no fingerprint somente para `AUTHORIZATION_DENIED`, a política V1 explicitamente tenant-specific. Nas demais classes é `tenant:shared`: muitos requests com correlation IDs diferentes podem portanto formar o mesmo incidente quando classe, assinatura, rota, service, release e janela forem compatíveis.

`incidentId` é `inc1:sha256(fingerprint|firstSeen)`, estável em atualizações. O agrupamento aceita a mesma fingerprint em janela deslizante de 30 minutos. Após a janela, um evento compatível abre episódio novo com `incidentId` novo; release diferente também separa o episódio. `eventId` é a chave de dedupe: reprocessar o mesmo evento não incrementa `occurrences`.

A relação `DETERMINISTIC` pode anexar um evento ao incidente que já contém o outro evento, mas nunca atravessa classe ou release incompatível. Isso mantém `CorrelationRelation` e `IncidentConfidence` separados: o primeiro descreve dois eventos; o segundo é a confiança na interpretação agregada.

## Regras

`Classifier` é puro e retorna classe, `ruleId` e reasons. As classes V1 são `APPLICATION_ERROR`, `DATABASE_FAILURE`, `DATABASE_SLOW`, `AUTH_FAILURE`, `AUTHORIZATION_DENIED`, `REALTIME_AUTH_FAILURE`, `FRONTEND_ERROR`, `AVAILABILITY`, `PERFORMANCE`, `BUSINESS_FAILURE`, `TELEMETRY_FAILURE` e `UNKNOWN`. Saúde/disponibilidade explícita vem antes; `db.operation.slow` ou DB acima de 1 s gera `DATABASE_SLOW`; categorias DB `CONNECTION`, `TIMEOUT`, `DEADLOCK`, `LOCK_TIMEOUT`, `TRANSACTION` e `CONSTRAINT` geram `DATABASE_FAILURE`. Auth, authz e realtime permanecem distintas.

`SeverityEngine` sempre devolve regra e reasons. `SEV1` requer disponibilidade ampla confirmada (três tenants e três ocorrências) ou DB `CONNECTION` recorrente junto com disponibilidade. `SEV2` é DB/5xx recorrente ou impacto multi-tenant. `SEV3` é impacto limitado, negócio, auth/realtime ou lentidão confirmada. `SEV4` é telemetria, desconhecido ou evento isolado/fraco. Auth/security sem evidência adicional fica limitado a `SEV3`.

`ConfidenceEngine` também retorna reasons. `HIGH` exige relação determinística entre fontes ou assinatura repetida (três ocorrências com service/release); `MEDIUM` requer contexto consistente/repetição; `LOW` cobre evento isolado, `UNKNOWN`, somente relação fraca, conflito ou falha de fonte. Assim, uma relation `DETERMINISTIC` não equivale automaticamente a confidence `HIGH`.

## Store e health local

`IncidentStore` usa `SUPPORT_ANALYST_RUNTIME_DIR` pela camada de orquestração e guarda somente `incidents.json` e `state.json`, ambos com `schemaVersion: 1` e `storeVersion: 1`. Arquivo ausente é estado inicial válido. Escrita é temp + rename e tem limite de 5 MiB; JSON corrompido ou schema incompatível falha fechado e nunca é sobrescrito silenciosamente. O lock exclusivo `analyst.lock` faz o segundo writer falhar claramente.

`state.json` suporta health básico: início, último processamento/término bem-sucedido, eventos processados/rejeitados, incidentes criados/atualizados e falhas. Não há watchdog nem consulta de health Elasticsearch nesta tarefa.

## Testes, fixture e limites

Os testes sintéticos cobrem criação/atualização, dedupe, requests com correlation IDs diferentes, relação determinística, release conflitante, janela e episódio novo, fechamento, determinismo/imutabilidade, todas as classes, severity/confidence, penalties, boundary de privacidade, atomicidade, lock, corrupção e reload. `npm run analyst:incident-replay` processa duas falhas DB sintéticas sem Elasticsearch e imprime apenas class, severity, confidence e occurrences.

Ficam para TQ-SA-06: contexto/dossier, facts/evidence/hypotheses, feedback humano e qualquer persistência associada. TQ-SA-07 cobre Ollama opcional. TQ-SA-08 amplia replay e métricas; TQ-SA-HEALTH-01 cobre heartbeat, health de dependências, watchdog e `health.json`.
