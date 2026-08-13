# Rollbacks do modulo Quiosque

Cada migracao do modulo Quiosque tem aqui o SQL de reversao correspondente,
com o mesmo nome da pasta da migracao.

Trocar de branch nao desfaz migracao. Reverter o codigo do modulo sem rodar o
rollback deixa o banco com o schema `quiosque` orfao — inofensivo, porque nada
fora do modulo o referencia, mas convem limpar.

## Como reverter

```powershell
# dev (container cervejaria-db-dev, porta 5434)
docker exec -i cervejaria-db-dev psql -U cervejaria -d cervejaria_dev -v ON_ERROR_STOP=1 -f /caminho/do/arquivo.sql
```

Depois, remover a linha correspondente de `_prisma_migrations`:

```sql
DELETE FROM "_prisma_migrations" WHERE migration_name = '<nome_da_migracao>';
```

Nunca rodar em producao sem dump recente e autorizacao explicita.
