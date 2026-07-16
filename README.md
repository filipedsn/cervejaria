# Quiver Tap PWA

Aplicação web (PWA) para cervejarias móveis — controle de comandas, pagamentos, ranking de consumo e relatórios em tempo real.

## Funcionalidades

- **Multi-cervejaria (SaaS)**: cada cervejaria com login próprio e dados isolados
- **Comandas**: abrir por cliente (nome + telefone), adicionar pedidos por tap/volume (300/500/700 ml)
- **Pagamentos**: fechar comanda com dinheiro, Pix ou cartão (com divisão opcional)
- **Tempo real**: sincronização entre tablets via Socket.IO
- **Ranking**: gamificação por volume consumido no evento, com modo tela cheia
- **Catálogo**: gestão de bebidas, preços e taps (dono)
- **Relatórios**: totais por evento, bebida e forma de pagamento + exportação CSV

## Stack

- **Backend**: Node.js, TypeScript, Fastify, Prisma, PostgreSQL, Socket.IO, JWT
- **Frontend**: React, Vite, Tailwind CSS, PWA, React Query
- **Infra**: Docker Compose (Postgres), Cloudflare Tunnel (produção)

## Pré-requisitos

- Node.js 20+
- Docker e Docker Compose

## Desenvolvimento local

```bash
# 1. Subir o banco Postgres
docker compose up -d postgres

# 2. Instalar dependências
npm install
cd backend && npm install
cd ../frontend && npm install
cd ..

# 3. Configurar variáveis (já existe backend/.env de exemplo)
cp backend/.env.example backend/.env

# 4. Rodar migrations e seed
cd backend
npx prisma migrate dev --name init
npm run db:seed
cd ..

# 5. Iniciar backend + frontend
npm run dev

# Reiniciar ambos (encerra portas 3002 e 5202 e sobe de novo)
npm run restart
# ou: scripts\restart-dev.cmd
```

- Frontend: http://localhost:5202
- API: http://localhost:3002
- Health check: http://localhost:3002/api/health

### Credenciais demo (após seed)

| Papel | E-mail | Senha |
|-------|--------|-------|
| Admin (cadastra cervejarias) | contato@quivercloud.com.br | *(definida no seed)* |
| Proprietário | dono@demo.com | 123456 |
| Atendente | atendente@demo.com | 123456 |

> Apenas o **admin** pode cadastrar novas cervejarias. Proprietários cadastram atendentes em **Equipe**.

### Recuperação de senha

1. Na tela de login, clique em **Esqueci minha senha**
2. Informe o e-mail — um link será enviado (ou exibido no console do backend em dev, se SMTP não estiver configurado)
3. Configure SMTP no `backend/.env` para produção:

```env
APP_URL="https://app.seudominio.com.br"
SMTP_HOST="smtp.hostinger.com"
SMTP_PORT="587"
SMTP_USER="seu-email@seudominio.com.br"
SMTP_PASS="sua-senha"
SMTP_FROM="Cervejaria Movel <noreply@seudominio.com.br>"
```

## Produção (build)

```bash
# Build frontend + backend
npm run build

# Iniciar API (serve frontend estático + API)
cd backend && npm start
```

A API serve o frontend buildado de `frontend/dist` quando disponível.

## Exposição via Cloudflare Tunnel + Hostinger

### 1. Instalar cloudflared

```bash
# Windows (winget)
winget install Cloudflare.cloudflared

# Linux
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
```

### 2. Autenticar e criar tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create cervejaria
```

Anote o **Tunnel ID** gerado.

### 3. Configurar DNS na Hostinger

No painel Cloudflare (domínio apontado para Cloudflare):

```
CNAME  app  <TUNNEL_ID>.cfargotunnel.com
```

Ou via CLI:

```bash
cloudflared tunnel route dns cervejaria app.seudominio.com.br
```

### 4. Arquivo de configuração

Crie `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /path/to/<TUNNEL_ID>.json

ingress:
  - hostname: app.seudominio.com.br
    service: http://localhost:3001
  - service: http_status:404
```

### 5. Rodar em produção

```bash
# Terminal 1: app
cd backend && npm start

# Terminal 2: tunnel
cloudflared tunnel run cervejaria
```

## Produção no Windows (sem IDE, reinício automático)

Para manter **backend + frontend estático + Cloudflare Tunnel** no ar mesmo com a IDE fechada e após reiniciar o PC:

```
Cloudflare → API :3001 (frontend estático + API)
```

### 1. Pré-requisitos

- Node.js 20+, PostgreSQL rodando (Docker ou serviço)
- Build do backend (`backend/dist`) e frontend (`frontend/dist`) — o instalador tenta gerar automaticamente
- No painel Cloudflare, `tap.quivercloud.com.br` apontando para **`http://localhost:3001`**
- `backend/.env.production` com `APP_URL` e `CORS_ORIGIN` = `https://tap.quivercloud.com.br`

### 2. Configurar caminhos

```powershell
copy deploy\production.settings.psd1.example deploy\production.settings.psd1
# Edite ProjectRoot e ApiPort (3001) se necessário
```

### 3. Instalar (PowerShell como Administrador)

```powershell
npm run prod:install
# ou: scripts\prod\install-autostart.cmd
```

Isso cria três tarefas agendadas:

| Tarefa | Quando |
|--------|--------|
| `QuiverTap-AtLogon` | Ao entrar no Windows |
| `QuiverTap-AtStartup` | 1 minuto após ligar o PC |
| `QuiverTap-Watchdog` | A cada 2 min — sobe backend, frontend e tunnel se caírem |

### 4. Comandos úteis

```powershell
npm run prod:status    # backend, frontend, tunnel e tarefas
npm run prod:ensure    # força verificação agora
npm run prod:stop      # para processos iniciados pelos scripts
npm run prod:uninstall # remove tarefas agendadas
```

Logs em `deploy/logs/` (`api.log`, `frontend.log`, `tunnel.log`, `watchdog.log`).

### 5. Tunnel 24/7 (recomendado)

O serviço Windows **Cloudflared** (via token) já cobre o tunnel 24/7. O watchdog monitora e tenta recuperar se cair.

### Variáveis de produção

Atualize `backend/.env`:

```env
DATABASE_URL="postgresql://cervejaria:SENHA_FORTE@localhost:5432/cervejaria"
JWT_SECRET="gere-um-segredo-longo-e-aleatorio"
PORT=3001
HOST=0.0.0.0
CORS_ORIGIN="https://app.seudominio.com.br"
```

## Instalar como PWA no tablet

1. Abra o app no Chrome/Edge do tablet
2. Menu → "Instalar app" ou "Adicionar à tela inicial"
3. O app funciona em tela cheia, ideal para operação

## Fluxo de uso

1. Login → abrir evento (local + data)
2. Nova comanda → nome do cliente
3. Selecionar tap → volume → adicionar
4. Fechar comanda → registrar pagamento
5. Ranking atualiza automaticamente para todos os tablets

## Estrutura do projeto

```
├── backend/          # API Node + Prisma
├── frontend/         # React PWA
├── docs/             # Manual, roadmap, especificação
├── assets/logo/      # Logo oficial (PWA icons)
├── docker-compose.yml
└── README.md
```

## LGPD

Telefone é opcional e usado apenas para identificar clientes recorrentes e compor o ranking. Informe os clientes sobre a coleta de dados no ponto de venda.
