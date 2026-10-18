# Marcos TAP-98

## Etapa 1 — Infraestrutura

- Implementado runner descartável com migrações fixadas, seed de A/B e personas aleatórias, build em `%TEMP%` e cleanup com verificação dos labels do container.
- Comando: `npm run qa:release-e2e -- --grep SMK`.
- Resultado: container, migrações, seed, frontend e confirmação `CANONICAL_PDV` em A/B passaram; SMK-S01/S02/S03 passaram; SMK-S04 falhou em todos os projetos porque a persona Cozinha entrou em `/operacao/comandas` em vez de `/operacao/cozinha`. Falha mantida como evidência, sem alterar `frontend/src`.
- Commit: `fa8e4af15464ebf657636b072cc2dad216297227` (push efetuado).

## Etapa 2 — Suporte e relatório

- Implementado global setup de storageState por persona, captura de chamadas API com redação, snapshots/hash de contagens do banco antes/depois, screenshots finais por ID, verificações globais de console/5xx e gerador de relatório.
- Comando: `npm run qa:release-e2e -- --grep SMK --project desktop`; `node scripts/qa/build-release-report.mjs fa8e4af15464ebf657636b072cc2dad216297227`.
- Resultado: suporte gravou `api/SMK-S01..S04.json`, `db/SMK-S01..S04.json` e screenshots; SMK-S01/S02/S03 passaram, SMK-S04 reproduziu o redirecionamento da Cozinha para `/operacao/caixa` (evidência em `artifacts/release-e2e/fa8e4af15464ebf657636b072cc2dad216297227`). Relatório P0 parcial: 3/4, parecer NO-GO.
- Commit: a registrar após commit desta etapa.

## Etapa 3 — P0

- Implementados SMK, ADM-S02, RBAC (28 chaves, concessão/revogação sem novo login), casos negativos selecionados de CXA, SEC/ISO e DSH/REL; casos X com snapshots de permissões e estado de eventos.
- Comandos: `npm run qa:release-e2e -- --grep RBAC --project desktop`; `... --grep ADM-S02 --project desktop`; `... --grep SEC --project desktop`; `... --grep CXA-X --project desktop`; `... --grep DSH --project desktop`.
- Resultado: RBAC 9/9 passou. Defeitos confirmados: ADM-S02 recebe `LEGACY`; SEC-X02 fecha evento com HTTP 200 sem permissão e altera `ABERTO` para `FECHADO`; SEC-X06 confirma senha fixa em `e2e/helpers/auth.ts`; DSH-X02 aceita mês futuro. SMK-S04 redireciona Cozinha a `/operacao/caixa`; CXA-X02 retorna mensagem em inglês. CMD/KDS e demais cenários que exigem um caixa, catálogo e pedidos reais ficam pendentes de massa dedicada e serão listados como não automatizados se não forem estabilizados.
- Commit: a registrar após commit desta etapa.
