# Marcos TAP-98

## Etapa 1 — Infraestrutura

- Implementado runner descartável com migrações fixadas, seed de A/B e personas aleatórias, build em `%TEMP%` e cleanup com verificação dos labels do container.
- Comando: `npm run qa:release-e2e -- --grep SMK`.
- Resultado: container, migrações, seed, frontend e confirmação `CANONICAL_PDV` em A/B passaram; SMK-S01/S02/S03 passaram; SMK-S04 falhou em todos os projetos porque a persona Cozinha entrou em `/operacao/comandas` em vez de `/operacao/cozinha`. Falha mantida como evidência, sem alterar `frontend/src`.
- Commit: a registrar após commit desta etapa.
