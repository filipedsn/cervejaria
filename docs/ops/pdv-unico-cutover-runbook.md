# Runbook de cutover do PDV único

Este runbook descreve o executor local DEV e o ensaio isolado. A entrega desta rodada implementa o comando, mas deliberadamente não aplica migration, saneamento ou ativação no banco DEV compartilhado.

## Plano sem conexão

Na raiz do repositório:

```powershell
npm.cmd --prefix backend run plan:pdv-dev-cutover
```

O plano mostra a revisão exata, o digest dos blobs SQL versionados, a sequência e os tenants permitidos. Não abre conexão com banco.

## Pré-requisitos para uma janela DEV futura

Use apenas depois de revisão operacional e da janela autorizada. Prepare um backup exclusivo de DEV e um restore drill isolado com prova `PASS` correspondente ao SHA do mesmo backup. O JSON de prova deve declarar `sourceEnvironment: development`, `sourceDatabase: cervejaria_dev`, o `backupSha256`, um `recoveryDatabase` com prefixo `cervejaria_restore_drill_`, e `schemaValidation` e `migrationLedgerValidation` como `PASS`. O executor rejeita prova de outro backup ou ambiente. Não usar backup de PROD.

Revalide a foto antes da execução e configure-a no mesmo PowerShell:

```powershell
$env:PDV_REPRESENTATIVE_PHOTO_FILE = 'C:\Users\Papai\AppData\Local\Temp\tap76-pdv-photo-6e0465525d164feaa656fb4fa66e075a.json'
(Get-FileHash -Algorithm SHA256 $env:PDV_REPRESENTATIVE_PHOTO_FILE).Hash
```

O resultado deve ser `2071D444DF091FE85438278CA1E6D2329D4E2106679B23143F0E863B8769D16B`. O arquivo aprovado tem 8.386.723 bytes. Não regenerar a autorização financeira dos 577 IDs C.

Revise o commit e o digest mostrados pelo plano. O comando de aplicação exige ambos os tenants explicitamente e bloqueia se a revisão, os SQLs, destino, foto, backup ou restore proof mudarem:

```powershell
$run = 'tap76-pdv-' + [guid]::NewGuid().ToString('N')
node backend/scripts/run-pdv-unico-dev-cutover.mjs `
  --profile=dev --apply `
  --tenant=cmr9yis3c0000hvu00q9fe7y1 `
  --tenant=cmsry9xrn0000hvlgopjxy0oo `
  --confirm-target=cervejaria_dev `
  --confirm-revision=<SHA exibido pelo plano> `
  --confirm-migrations-sha256=<digest exibido pelo plano> `
  --confirm-photo-sha256=2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b `
  --backup-file=<backup DEV validado> `
  --restore-drill=<prova PASS do mesmo backup> `
  --run-id=$run
```

O executor valida a URL local `127.0.0.1`/`localhost:5434/cervejaria_dev`, faz preflight de todos os tenants antes do primeiro DDL e bloqueia qualquer divergência. As migrations são aplicadas em dois grupos: pré-requisitos até `20261004150000_pdv_finance_session_link`; preparação negócio/catálogo e cozinha; novo preflight comercial; migrations dependentes; migradores de TAP/sessão/finanças/cozinha/comércio com replay; categorias canônicas; reconciliação financeira/comercial; readiness dos dois tenants. Nenhum item de menu é criado.

Recibos duráveis e encadeados ficam em `%LOCALAPPDATA%\TAP Quiver\pdv-cutover-receipts`; logs de subprocesso e clientes Prisma gerados ficam na pasta de execução em `%TEMP%`. Retomada usa o mesmo `--run-id`, commit, tenants, foto, backup e digest. Ela consulta novamente o ledger, os runs/lotes e os resultados atuais no banco para cada fase já marcada PASS. Se um recibo faltar, cadeia/hash divergir ou evidência viva não corresponder, pare e preserve os arquivos para investigação. Não edite ledger, não apague checkpoint e não repare automaticamente.

## Ensaio descartável QA

A certificação usa o runner Git-snapshot, sem worktree, e PostgreSQL temporário isolado. Com a foto no ambiente:

```powershell
$env:PDV_REPRESENTATIVE_PHOTO_FILE = 'C:\Users\Papai\AppData\Local\Temp\tap76-pdv-photo-6e0465525d164feaa656fb4fa66e075a.json'
node backend/scripts/run-pdv-unico-git-snapshot-qa.mjs --commit=<SHA do executor> --cutover --evidence-out="$env:TEMP\tap76-pdv-qa-evidence.json"
```

O ensaio aplica migrations, migradores e replays apenas no banco descartável QA. A comanda `cmuqaoyta0007hvdg3q4v7hkj` só pode ser cancelada nesse ensaio, pela API autenticada normal e com auditoria; conferir o resultado e as invariantes no relatório. Não rode o entrypoint DEV com `--apply` nesta rodada.

## Resultado desta entrega

O resultado do ensaio e os hashes certificados estão na seção “Certificação concluída” ao final deste runbook e no manifesto JSON. Este status substitui as instruções de preenchimento anteriores. TAP-76 permanece In Progress. `PROD_DEPLOY_REQUIRED=NO`.

### Certificação concluída — 2026-10-08

O runtime certificado é `888a4a8e8f4f347ded6138da218f4b3f01f5f9ea`, árvore `d6214493a19eb05b7b9bb9d6c8856bb3f413b67d`. O ensaio Git-snapshot terminou PASS em 2.275.105 ms: builds backend/frontend; regressão descartável; UI simulada 2/2; guardas QA 13/13; manifesto integrado 112 candidatos; preflight DEV somente leitura 55/55 CLEAR; sequência e operação autenticada em PostgreSQL descartável. O snapshot temporário foi removido e o fingerprint do estado local permaneceu idêntico.

A comanda autorizada `cmuqaoyta0007hvdg3q4v7hkj` foi cancelada só em QA pela API autenticada, com audit `COMANDA_CANCELADA`, data de criação preservada e sem efeitos financeiros/caixa/estoque. Os 605 pagamentos e a lista imutável dos 577 C foram preservados. Todos os gates da sequência, reconciliação, rankings e readiness passaram. Evidência: `docs/testing/pdv-unico-dev-cutover-qa-evidence-888a4a8.json`; SHA-256 `8d27d5e25787e8eed406e1987b60b0c65225022e5213dd69a186541332f51c5d`. Manifestos: `docs/testing/pdv-unico-dev-cutover-manifest.json` e `docs/testing/pdv-unico-integrated-qa-manifest.json`.

**Limite operacional:** nenhum DDL, transformação, saneamento ou ativação foi executado no DEV compartilhado. Para uma janela DEV futura, faltam o backup DEV e prova PASS de restore drill vinculada ao SHA desse backup; o executor bloqueia sem esses artefatos. PROD e metadados de PROD não foram acessados. TAP-76 segue In Progress; `PROD_DEPLOY_REQUIRED=NO`.

## Correção do executor imutável — 2026-10-08

O comando direto `node backend/scripts/run-pdv-unico-dev-cutover.mjs` agora confere o próprio bootstrap e o materializador com os blobs do `HEAD`, materializa a árvore Git completa em `%TEMP%` e roda o worker desse snapshot. Um hook Node rejeita imports de código de projeto fora do snapshot; dependências instaladas e clientes gerados na pasta temporária são identificados separadamente. Alterações locais não entram no worker. Não use `npm run` para `--apply`; invoque o caminho direto mostrado abaixo.

A guarda do ledger compara cada `migration_name` e checksum SHA-256 do SQL com as migrations do commit. Aceita a origem normal (85 aplicadas / 14 pendentes), retomada com o lote mínimo até `20261004150000_pdv_finance_session_link`, ou schema completo (99/99). Migration desconhecida, checksum divergente, linha falhada/incompleta ou aplicação fora de ordem bloqueiam. Em toda retomada, o preflight e o ledger são consultados novamente; recibos não substituem a evidência viva. Recibos de migradores também são conferidos com os runs e lotes existentes no banco.

A fase final grava `PDV_CANONICAL_TENANTS` no `backend/.env.development`, arquivo já lido pelo launcher `scripts/dev/start-dev.ps1` e por `backend/src/lib/load-env.ts`. A gravação é atômica; o recibo de rollback em `%LOCALAPPDATA%\TAP Quiver\pdv-cutover-receipts` guarda hashes e somente a linha anterior, sem credenciais. Em erro depois da gravação, o executor restaura apenas se o hash do arquivo ainda for o hash escrito por ele. Um arquivo alterado desde então bloqueia o rollback para preservar a mudança concorrente.

O backend e o frontend DEV estão atualmente parados. Depois de uma futura aplicação aprovada, inicie os dois pelos scripts existentes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/start-dev.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/status-dev.ps1
```

Se já estiverem ativos na janela de aplicação e precisarem recarregar o ambiente, use `scripts/dev/stop-dev.ps1` e depois `start-dev.ps1`. URLs locais: frontend `http://localhost:5202`, API `http://localhost:3002` e health check `http://localhost:3002/api/health`. O seletor inclui somente CIA Marítima e Churrasquinho do Thiago; os demais tenants continuam no fluxo legado.

### Backup, recuperação isolada e futura aplicação

Os comandos abaixo são apenas para uma janela futura; nenhum deles foi executado nesta rodada. O restore drill verifica o dump num banco temporário, compara o ledger com migrations rastreadas no `HEAD` e emite o JSON de prova que o executor exige:

```powershell
$backupDir = Join-Path $env:LOCALAPPDATA 'TAP Quiver\pdv-cutover-backups'
$proofDir = Join-Path $env:LOCALAPPDATA 'TAP Quiver\pdv-cutover-restore-proofs'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup/backup-db.ps1 `
  -Environment development -DestinationDir $backupDir
$backup = Get-ChildItem -LiteralPath $backupDir -Filter 'backup-dev-*.sql' -File |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup) { throw 'Backup DEV não encontrado.' }
$proof = Join-Path $proofDir ($backup.BaseName + '.restore-proof.json')
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup/restore-drill-dev.ps1 `
  -BackupFile $backup.FullName -ProofFile $proof
(Get-FileHash -LiteralPath $backup.FullName -Algorithm SHA256).Hash
Get-Content -LiteralPath $proof
```

Confirme `status`, `sourceEnvironment`, `sourceDatabase`, `backupSha256`, `recoveryDatabase`, `schemaValidation` e `migrationLedgerValidation` no JSON; o SHA precisa coincidir com o mesmo arquivo `.sql`. Então gere o plano no commit revisado e copie exatamente `revision` e `migrationsSha256` para o comando de aplicação:

```powershell
node backend/scripts/run-pdv-unico-dev-cutover.mjs --dry-run
$env:PDV_REPRESENTATIVE_PHOTO_FILE = 'C:\Users\Papai\AppData\Local\Temp\tap76-pdv-photo-6e0465525d164feaa656fb4fa66e075a.json'
if ((Get-FileHash -Algorithm SHA256 $env:PDV_REPRESENTATIVE_PHOTO_FILE).Hash.ToLowerInvariant() -ne `
  '2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b') { throw 'Foto aprovada divergiu.' }
$run = 'tap76-pdv-' + [guid]::NewGuid().ToString('N')
node backend/scripts/run-pdv-unico-dev-cutover.mjs `
  --profile=dev --apply `
  --tenant=cmr9yis3c0000hvu00q9fe7y1 `
  --tenant=cmsry9xrn0000hvlgopjxy0oo `
  --confirm-target=cervejaria_dev `
  --confirm-revision=<SHA exato exibido no plano> `
  --confirm-migrations-sha256=<digest exato exibido no plano> `
  --confirm-photo-sha256=2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b `
  --backup-file=$backup.FullName `
  --restore-drill=$proof `
  --run-id=$run
```

O cancelamento autorizado de `cmuqaoyta0007hvdg3q4v7hkj` permanece limitado à API normal, com auditoria, em QA descartável. Não incluir produto de menu nem regenerar a autorização financeira dos 577 pagamentos C. A prova integral histórica em `888a4a8` continua válida para aquela árvore e está preservada acima; o gate focado de categories em `7021097` também foi registrado separadamente. Na revisão final `7807721`, o entrypoint DEV real passou dry-run com 1.266 blobs materializados, nove imports de projeto do snapshot e zero imports de projeto do workspace mutável; guardas focadas passaram 20/20 e o build backend passou. O ensaio integral final em QA descartável passou as migrations, preparações, transforms/replays, reconciliação, readiness/ativação e cancelamento autenticado; 605 pagamentos foram preservados e o estado local permaneceu igual. Evidências: [follow-up do executor](../testing/pdv-unico-dev-cutover-followup-evidence-7807721.json), [QA integral final](../testing/pdv-unico-dev-cutover-followup-qa-full-7807721.json) e [gate QA focado](../testing/pdv-unico-dev-cutover-followup-qa-gate.json). Nenhuma migration, saneamento, alteração de configuração ou inicialização de serviço foi feita no DEV compartilhado.

## Ativação global (TAP-99)

Desde o TAP-99 o modelo canônico vale para todas as empresas com `PDV_CANONICAL_ALL=1`. A lista fixa de IDs saiu do código; `PDV_CANONICAL_TENANTS` continua aceito só pelos runners de QA descartáveis.

Pré-condição: toda empresa ativa tem exatamente 1 PDV ativo com `ConfiguracaoPontoVenda`. Sem isso a API responde 409 `CANONICAL_PDV_*`. O `npm run prod:preflight` roda `backend/scripts/check-canonical-readiness.mjs` (somente leitura) e bloqueia o deploy quando falta a variável ou há empresa fora do modelo.

No deploy autorizado para PROD:

1. `npm run prod:preflight` e conferir a lista de empresas bloqueadas.
2. Para cada empresa bloqueada: cutover com recibos (cliente real) ou desativação (empresa de teste), sempre com autorização.
3. Em `backend/.env.production`, trocar `PDV_CANONICAL_TENANTS=...` por `PDV_CANONICAL_ALL=1`.
4. `npm run prod:preflight` de novo até `Modelo canonico : OK`; só então `.\deploy.cmd -Confirmed`.