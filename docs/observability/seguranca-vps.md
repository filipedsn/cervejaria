# Segurança e infraestrutura do VPS no Elastic (TAP-161)

O collector PRD (`quiver-edot-collector-prd`) lê logs do host e os envia ao Elastic PRD no namespace `infra` (retenção de 7 dias, `apply-retention.mjs`). Nenhuma porta nova é aberta e o socket do Docker não é montado no collector.

| Fonte no host | Receiver | Data stream | Campos principais |
|---|---|---|---|
| `/var/log/nginx/access.log` (formato `combined`) | `filelog/nginx` | `logs-nginx_access.otel-infra` | `http.request.method`, `url.path` (sem query string), `http.response.status_code` (inteiro), `http.response.body.bytes`, `user_agent.original`, `source.address` |
| `/var/log/auth.log` (só linhas do `sshd`) | `filelog/ssh` | `logs-ssh_auth.otel-infra` | `ssh.event`, `user.name`, `source.address` |
| `/var/log/quiver-docker-state.log` | `filelog/docker` | `logs-docker_state.otel-infra` | `container`, `image`, `restarts`, `status`, `health`, `uptime_s`, `recent_start`, `oom_killed`, `exit_code` |

Atrás do Cloudflare, o `source.address` do nginx é o IP da borda do Cloudflare; o IP real do cliente fica na trilha de auditoria da aplicação (`client.address`, ver `jornada-usuario.md`).

O collector monta `/var/log` do host como somente leitura em `/var/log/host` e entra no grupo `adm` (gid 4), dono dos logs do nginx e do `auth.log` no Ubuntu.

Os traces PRD são amostrados a 100% (`tail_sampling`), para que toda transação fique registrada.

## Estado dos contêineres

`deploy/tap-quiver/docker-state.sh` roda a cada minuto pelo cron `deploy/tap-quiver/cron.d/quiver-tap-docker-state` e acrescenta uma linha JSON por contêiner. O arquivo é rotacionado em 5 MB (`.1`). `recent_start=true` indica um início há menos de 180 s.

## Regras Kibana PRD

| Regra | Dispara quando |
|---|---|
| `quiver-tap-ssh-bruteforce-prd` | Mais de 50 `Failed password`, `Failed publickey` ou `Invalid user` em 10 min |
| `quiver-tap-ssh-login-prd` | Login SSH aceito de origem fora da rede administrativa, em 2 min |
| `quiver-tap-nginx-5xx-surge-prd` | Mais de 20 respostas 5xx no nginx em 5 min |
| `quiver-tap-container-restart-prd` | Reinício recente com `restarts > 0`, OOM, `unhealthy` ou contêiner essencial fora de `running`, em 3 min |

As regras são aplicadas por `configure-kibana -Target prd`, entram na lista canônica do `wire-alert-actions.ps1` e são conferidas por `diagnose-prd.ps1`; os alertas chegam ao Telegram pelo alert-poller (TAP-139) com o prefixo `[KIBANA]`.

## Instalação no VPS (exige autorização de produção)

Depois do merge e do deploy aprovado que atualizam `/opt/quiver-tap`:

1. Conferir que os logs existem: `ls -l /var/log/nginx/access.log /var/log/auth.log`. Se o `auth.log` não existir (sistema só com journald), instalar o `rsyslog` ou deixar a regra de SSH desativada.
2. Instalar o cron: `install -m 644 /opt/quiver-tap/deploy/tap-quiver/cron.d/quiver-tap-docker-state /etc/cron.d/` e `chmod 755 /opt/quiver-tap/deploy/tap-quiver/docker-state.sh`.
3. Após um minuto, conferir `tail -n 3 /var/log/quiver-docker-state.log`.
4. Recriar o collector com a configuração nova (`docker compose -f docker-compose.observability.yml up -d`, a partir de `deploy/tap-quiver`).
5. Aplicar as regras: `configure-kibana -Target prd`, depois `wire-alert-actions -Target prd` (prévia) e `-Apply` para ligar a ação do índice de alertas nas quatro regras, que é o que leva o alerta ao Telegram.

## Verificação

- `_count` em `logs-nginx_access.otel-infra`, `logs-ssh_auth.otel-infra` e `logs-docker_state.otel-infra` crescendo.
- `diagnose-prd.ps1` sem regras ausentes.
- Game day: `docker kill quiver-tap-alert-poller` faz a política de reinício subir o contêiner de novo (incrementa `restarts`) e deve gerar `quiver-tap-container-restart-prd` em até 3 min. Um `docker restart` manual não incrementa `restarts` e não alerta.

## Reversão

Remover `/etc/cron.d/quiver-tap-docker-state`, voltar o collector para a configuração anterior e desativar as quatro regras no Kibana. Nenhum dado de aplicação é afetado.
