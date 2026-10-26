#!/usr/bin/env bash
# Classifica as migrations Prisma entre dois commits (rodar dentro do clone git).
#   bash migration-guard.sh <from_sha> <to_sha>
#
# Saída (uma linha por item):
#   MIGRATION <nome>                  migration nova a aplicar
#   DESTRUCTIVE <nome>: <linha SQL>   comando que quebra o código anterior ou perde dado
#   CHANGED <nome>                    migration já existente foi alterada/removida
#   ROLLBACK_OVER <nome>              rollback de código para antes desta migration (schema fica)
# Exit: 0 ok · 3 há destrutivas · 4 migration existente alterada/removida · 2 uso inválido
#
# Regra (expand/contract): o código anterior precisa continuar funcionando com o schema
# novo, porque o rollback automático volta só o código. DROP/RENAME/mudança de tipo/
# SET NOT NULL/TRUNCATE/DELETE exigem confirmação explícita (allow-destructive).
set -euo pipefail

FROM="${1:-}"
TO="${2:-}"
DIR="backend/prisma/migrations"
[[ -n "$FROM" && -n "$TO" ]] || { echo "uso: migration-guard.sh <from_sha> <to_sha>" >&2; exit 2; }
git cat-file -e "${FROM}^{commit}" && git cat-file -e "${TO}^{commit}" || exit 2

list_migrations() {
  git ls-tree --name-only "$1" "$DIR/" | sed "s#^$DIR/##" | grep -v '^migration_lock.toml$' || true
}

if [[ "$FROM" != "$TO" ]] && git merge-base --is-ancestor "$TO" "$FROM"; then
  comm -23 <(list_migrations "$FROM" | sort) <(list_migrations "$TO" | sort) | sed 's/^/ROLLBACK_OVER /'
  exit 0
fi

rc=0
while IFS=$'\t' read -r status path; do
  [[ "$path" == */migration.sql ]] || continue
  name="${path#"$DIR"/}"
  name="${name%/migration.sql}"
  if [[ "$status" != "A" ]]; then
    echo "CHANGED $name"
    rc=4
    continue
  fi
  echo "MIGRATION $name"
  while IFS= read -r hit; do
    echo "DESTRUCTIVE $name: $hit"
    ((rc == 4)) || rc=3
  done < <(git show "$TO:$path" | grep -v -E '^\s*--' | grep -i -E \
    -e '\bDROP[[:space:]]+(TABLE|COLUMN|SCHEMA|TYPE|VIEW|MATERIALIZED[[:space:]]+VIEW)\b' \
    -e '\bALTER[[:space:]]+TABLE[[:space:]]+[^[:space:]]+[[:space:]]+RENAME[[:space:]]+(COLUMN|TO)\b' \
    -e '\bALTER[[:space:]]+TYPE[[:space:]]+[^[:space:]]+[[:space:]]+RENAME\b' \
    -e '\bALTER[[:space:]]+COLUMN[[:space:]]+[^[:space:]]+[[:space:]]+(SET[[:space:]]+DATA[[:space:]]+)?TYPE\b' \
    -e '\bSET[[:space:]]+NOT[[:space:]]+NULL\b' \
    -e '\bTRUNCATE\b' \
    -e '\bDELETE[[:space:]]+FROM\b' || true)
done < <(git diff --name-status --no-renames "$FROM" "$TO" -- "$DIR")

exit "$rc"
