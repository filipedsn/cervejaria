# TAP-33 — backup e restore

O fluxo versionado gera `pg_dump` local, valida tamanho/formato, grava SHA-256,
aplica retenção e só então copia para `-OffHostDir`, verificando tamanho e hash.
O ambiente padrão do script é DEV (`cervejaria-db-dev` / `cervejaria_dev`);
PROD só deve ser executado após autorização explícita do destino externo.

```powershell
powershell -File scripts/backup/backup-db.ps1 -Environment development
powershell -File scripts/backup/backup-db.ps1 -Environment development -OffHostDir 'D:\TAP Quiver Backups\DEV'
```

Falha na cópia off-host encerra com erro e preserva o backup local. A política
inicial é manter 7 dumps recentes e 4 representantes semanais. Segredos não
são lidos, impressos ou gravados pelo script.
