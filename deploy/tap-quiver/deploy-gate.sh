#!/usr/bin/env bash
# Forced command da chave SSH exclusiva da esteira (GitHub Actions).
# Instalado no VPS em /usr/local/sbin/quiver-tap-deploy-gate e referenciado em
# /root/.ssh/authorized_keys como:
#   restrict,command="/usr/local/sbin/quiver-tap-deploy-gate" ssh-ed25519 AAAA... github-actions-cervejaria-deploy
#
# A chave não abre shell: só aceita
#   deploy <sha40> [head-only|allow-older]
#   status
# O script de deploy executado é sempre o da origin/main (não o do SHA publicado),
# para que rollback para commits antigos use a versão atual do procedimento.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/cervejaria-git}"

read -r -a ARGS <<<"${SSH_ORIGINAL_COMMAND:-}"
ACTION="${ARGS[0]:-}"

case "$ACTION" in
  deploy)
    SHA="${ARGS[1]:-}"
    MODE="${ARGS[2]:-head-only}"
    [[ "${#ARGS[@]}" -le 3 ]] || { echo "argumentos demais"; exit 2; }
    [[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "SHA inválido"; exit 2; }
    [[ "$MODE" == "head-only" || "$MODE" == "allow-older" ]] || { echo "modo inválido"; exit 2; }
    git -C "$REPO_DIR" fetch --quiet origin main
    SCRIPT="$(mktemp /tmp/quiver-tap-deploy.XXXXXX)"
    trap 'rm -f "$SCRIPT"' EXIT
    git -C "$REPO_DIR" show origin/main:deploy/tap-quiver/deploy-prd.sh >"$SCRIPT"
    bash "$SCRIPT" "$SHA" "$MODE"
    ;;
  status)
    curl -fsS http://127.0.0.1:3001/api/health
    echo
    ;;
  *)
    echo "comando não permitido"
    exit 2
    ;;
esac
