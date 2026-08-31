# TQ-OBS-MAINT-01 — Corrigir aplicação efetiva das políticas ILM

Status: BACKLOG

Origem: TQ-SA-02/TQ-SA-02A, 2026-08-31.

## Problema observado

No cluster DEV local:

- backing indices audit estavam `managed=false`;
- o backing technical estava `managed=false`;
- metrics tinha um backing sob a policy built-in `metrics` e outro unmanaged;
- `quiver-tap-alert-events` e `quiver-tap-alert-events-dev` não tinham ILM.

As políticas versionadas de 90 dias para audit, 30 dias para technical e 45 dias para metrics não estavam efetivamente associadas aos backings observados. O template `quiver-otel-replicas-zero` tinha prioridade 250, enquanto os templates gerados por `setup-ilm.ps1` usam prioridade 110; a precedência/aplicação deve ser auditada antes de qualquer mudança.

## Escopo futuro

1. Mapear templates efetivos e suas prioridades por família.
2. Definir retenção do índice de alertas DEV, considerando seu baixo volume.
3. Ajustar templates/policies sem alterar documentos existentes indevidamente.
4. Comprovar `_ilm/explain` managed/policy/phase em DEV.
5. Tratar PRD somente com autorização explícita e plano separado.

## Fora de escopo

TQ-SA-02A não alterou ILM, templates, backing indices nem retenção. A API key runtime do Support Analyst não receberá `manage_ilm`, `manage_index_templates` ou qualquer privilégio de cluster.
