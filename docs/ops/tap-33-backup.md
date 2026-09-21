# TAP-33 — backup e restore

O fluxo versionado gera `pg_dump` local, valida tamanho/formato, grava SHA-256,
aplica retenção local e off-host e só então copia para `-OffHostDir`, verificando
tamanho e hash. O mesmo script atende DEV (`cervejaria-db-dev` /
`cervejaria_dev`) e PROD (`cervejaria-db` / `cervejaria`).

```powershell
powershell -File scripts/backup/backup-db.ps1 -Environment development
powershell -File scripts/backup/backup-db.ps1 -Environment development -OffHostDir 'D:\TAP Quiver Backups\DEV'
powershell -File scripts/backup/backup-db.ps1 -Environment production -OffHostDir "$env:OneDrive\Quiver\Tap Quiver\Backup banco\PRD"
```

Falha na cópia off-host encerra com erro e preserva o backup local. A política
inicial é manter 7 dumps recentes e 4 representantes semanais. Segredos não
são lidos, impressos ou gravados pelo script.

## OneDrive e automação

O destino autorizado é `OneDrive\Quiver\Tap Quiver\Backup banco\Dev` e
`OneDrive\Quiver\Tap Quiver\Backup banco\PRD`. Instale uma tarefa por
ambiente, sem duplicar tarefas existentes:

```powershell
powershell -File scripts/backup/install-dev-scheduler.ps1 -Environment development
powershell -File scripts/backup/install-dev-scheduler.ps1 -Environment production
```

O restore drill usa uma cópia do destino off-host em banco temporário isolado;
nunca em `cervejaria` ou `cervejaria_dev`. Se o destino falhar, preserve o
arquivo local, registre o erro e permita nova tentativa automática.
