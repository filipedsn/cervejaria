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
- **Infra**: Docker Compose local para Postgres/Elasticsearch de desenvolvimento; produção pública em Docker no VPS atrás de Cloudflare e nginx

## Pré-requisitos

- Node.js 24 (baseline suportado; outros majors não são baseline suportado)
- Docker e Docker Compose

## Desenvolvimento local

O runtime oficial do projeto é Node.js 24. Use o `.nvmrc` (`nvm use`) ou confirme o ambiente com `npm run check:node`. A CI também executa em Node.js 24; versões de outros majors podem funcionar, mas não são baseline suportado.

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

O DEV oficial é local. `tapdev.quivercloud.com.br` e o tunnel Cloudflare para DEV são caminhos legados/removidos, não destinos vigentes.

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

## Build local (desenvolvimento/CI)

```bash
# Build frontend + backend
npm run build

# Iniciar API (serve frontend estático + API)
cd backend && npm start
```

A API pode servir o frontend buildado de `frontend/dist` quando disponível. Esse build local não publica a produção pública.

## Arquitetura atual (DEV e produção pública)

- **DEV:** PC Windows; API Node local (`:3002`), Vite (`:5202`), Postgres local em Docker (`:5432` e/ou `:5434`, conforme compose) e cluster Elasticsearch local.
- **PRD pública:** VPS Hostinger; aplicação e Postgres em Docker, atrás do proxy Cloudflare e nginx. O site público não depende do PC ligado.
- **Elasticsearch:** cluster DEV no PC e cluster PRD separado no VPS. Nunca conecte a aplicação DEV ou OTEL de DEV ao cluster PRD.
- **Deploy:** hoje manual no VPS via SSH/Tailscale, somente após autorização explícita. O plano de CD está no [handoff interno](docs/handoff-vps-hostinger-arquiteto.md) §7.1.

Não replique aqui inventário de infraestrutura, IPs, paths de env ou detalhes de chaves; consulte o [handoff interno](docs/handoff-vps-hostinger-arquiteto.md).

## Ferramentas Windows de publicação — legado

Os scripts `deploy.cmd`, `scripts/prod/*`, watchdog e auxiliares Cloudflared permanecem no repositório para compatibilidade e histórico. Eles **não** publicam `tap.quivercloud.com.br`. Não instale ou recrie um tunnel do Tap no PC como caminho de produção.

O procedimento acima é legado e não deve ser usado para servir clientes. Para a operação vigente, leia o [handoff interno](docs/handoff-vps-hostinger-arquiteto.md); para o fluxo Git, PR e gates, leia [CONTRIBUTING.md](CONTRIBUTING.md).

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
