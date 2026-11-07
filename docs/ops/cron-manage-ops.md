# Agendamentos do VPS no painel Ops (TAP-178)

O cartão **Site dos clientes** lista os crons de manutenção do VPS e, com a chave certa neste PC, permite ligar, desligar e alterar o horário (Brasília).

## Peças

| Peça | Onde |
|---|---|
| Templates (bootstrap) | `deploy/tap-quiver/cron.d/*` no repo |
| Runtime | `/etc/cron.d/<id>` no VPS (fonte de verdade) |
| Lib compartilhada | `deploy/tap-quiver/cron-schedules.lib.sh` (em `/opt/quiver-tap/...` após sync) |
| Lista (só leitura) | `ops-report.sh` → campo JSON `schedules` |
| Mutações | `/usr/local/sbin/quiver-tap-cron-manage` (forced command) |
| Painel | `OPS_CRON_SSH_HOST` no `ops-panel/.env` |

## Instalação no VPS (uma vez)

Com a `main` já sincronizada em `/opt/quiver-tap` (para a lib existir):

```bash
install -o root -g root -m 755 /opt/quiver-tap/deploy/tap-quiver/cron-manage.sh /usr/local/sbin/quiver-tap-cron-manage
# Se o ops-report no sbin ainda for antigo, reinstalar também:
install -o root -g root -m 755 /opt/quiver-tap/deploy/tap-quiver/ops-report.sh /usr/local/sbin/quiver-tap-ops-report
```

Gerar chave só para este forced command (no PC do operador) e acrescentar em `/root/.ssh/authorized_keys`:

```text
restrict,from="100.64.0.0/10",command="/usr/local/sbin/quiver-tap-cron-manage" ssh-ed25519 AAAA... quiver-tap-cron-manage
```

Alias no `~/.ssh/config` do PC (exemplo `quiver-vps-cron`) apontando para essa chave / host Tailscale do VPS.

No `ops-panel/.env`:

```env
OPS_CRON_SSH_HOST=quiver-vps-cron
```

Reiniciar o painel Ops. Sem a variável, a lista aparece; os botões de ligar/desligar/horário ficam indisponíveis.

## Comandos aceitos pela chave

- `list`
- `enable <id>`
- `disable <id>`
- `set-time <id> HH:MM` (HH:MM em **Brasília**; gravado em UTC)

Ids: `quiver-tap-backup`, `docker-image-prune`, `docker-builder-prune`, `quiver-tap-docker-state`.

## Notas

- Desligar **não** apaga dumps nem a cópia OneDrive; só para o próximo ciclo do cron.
- `quiver-tap-docker-state` não tem horário editável (continua a cada minuto).
- Alterar o template no git **não** muda sozinho o `/etc/cron.d/`; o Ops edita o runtime. Para realinhar com o repo, copiar de novo o arquivo do template (ou ligar/ajustar pelo painel).
