# Restore drill de PostgreSQL

Este runbook prova que um dump de producao pode ser restaurado sem escrever em `cervejaria`, interromper a API ou alterar o estado de recovery. Ele nao autoriza um restore automatico sobre producao.

## Pre-requisitos

- Executar na maquina de producao, com Docker e o container `cervejaria-db` saudavel.
- Usar um dump SQL produzido pelo fluxo oficial, em `deploy/backups/`.
- Confirmar antes e depois que `npm run prod:status` esta saudavel.
- Ter espaco local para o banco restaurado e escolher um timestamp novo para o destino.

O backup oficial atual e texto SQL, criado no container por:

```powershell
pg_dump -U cervejaria -d cervejaria --no-owner --no-acl -f /tmp/backup-prod-<timestamp>.sql
```

Nao ha politica de retencao implementada: os dumps locais permanecem em `deploy/backups/` ate uma decisao operacional explicita. Isso e um gap a acompanhar.

## Drill seguro

1. Escolha o dump oficial mais recente e registre nome, horario, tamanho e SHA-256. Nao crie um dump novo apenas para o drill.
2. Gere um nome exclusivo: `cervejaria_restore_drill_yyyyMMdd_HHmmss`.
3. Execute:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prod/restore-drill.ps1 `
  -BackupFile deploy/backups/backup-prod-<timestamp>.sql `
  -TargetDatabase cervejaria_restore_drill_yyyyMMdd_HHmmss
```

O script recusa `cervejaria`, `cervejaria_dev`, qualquer nome fora do padrao de drill e banco de destino ja existente. Ele cria o banco isolado e o restaura com o mesmo papel usado pela API, com `psql -v ON_ERROR_STOP=1`; confere schemas/tabelas/contagens, roda apenas `prisma migrate status` e `prisma validate`, gera um relatorio local em `deploy/restore-drills/` e remove o banco somente depois de um resultado bem-sucedido. Use `-KeepDatabase` apenas para investigacao controlada; depois remova-o manualmente com decisao humana.

Para dump em formato custom ou tar, pare antes de executar este script: ele aceita somente SQL texto. Use `pg_restore` compatível com a versao do dump em um banco temporario novo e siga as mesmas validacoes abaixo.

## Validacoes e pontos de parada

O script valida conexao, schemas `public` e `quiosque`, migrations Prisma, tabelas principais e somente contagens de cervejarias, usuarios, eventos, comandas, clientes, produtos e sessoes de caixa. Nenhum dado pessoal deve ser copiado para tickets ou relatorios.

Pare e peça decisao humana se o container nao estiver saudavel, o dump estiver vazio ou em formato inesperado, o restore falhar, migrations/schema divergirem, ou qualquer tabela principal estiver ausente. Em caso de falha, o banco temporario e preservado para diagnostico; nao aplique migrations nem tente "consertar" o dump antes de registrar a falha.

Uma API temporaria e opcional. So a inicie em porta livre, com `DATABASE_URL` apontando exclusivamente ao banco de drill; nunca reutilize a porta, artefatos ou servico da API de producao. Valide startup, Prisma, `/api/ready` e uma leitura segura. Se isso aumentar o risco operacional, registre como nao executado.

## Incidente real

Restaurar PROD e uma decisao manual e consciente de um responsavel. Antes de qualquer acao, pare e avalie impacto, janela, versao do backup, RPO, compatibilidade de migrations, conexoes ativas, rollback e comunicacao. Primeiro restaure e valide uma copia isolada. Este runbook nao orienta parar PROD, limpar recovery, executar deploy ou sobrescrever `cervejaria`.
