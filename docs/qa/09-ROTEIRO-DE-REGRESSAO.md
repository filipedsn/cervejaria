# Roteiro de regressão manual — Quiver Tap

Prompt colável para testador humano ou agente. Complementa a suíte automatizada — não duplica o que já está verde na [matriz de cobertura](./03-MATRIZ-DE-COBERTURA-FUNCIONAL.md).

---

## Restrições absolutas

- **Somente DEV**: API `:3002`, frontend `:5202`, banco `cervejaria_dev`
- **Nunca** testar em `:3001`, `tap.quivercloud.com.br` ou `.env.production`
- Scripts QA abortam automaticamente se detectarem produção (`backend/qa/lib/guard.mjs`)
- Não gravar tokens, cookies ou senhas em evidências

---

## Pré-condições

```powershell
npm run dev:start
npm run dev:status
npm run db:seed
node backend/scripts/run-with-env.mjs development node backend/scripts/diag-seed-quiosque-demo.mjs
```

Opcional antes do manual (regressão automática):

```powershell
npm run test:unit
npm run qa:test
node backend/scripts/diag-smoke-quiosque-pdv.mjs
node backend/scripts/diag-smoke-quiosque-cozinha.mjs
node backend/scripts/diag-smoke-quiosque-caixa.mjs
node backend/scripts/diag-smoke-quiosque-estoque.mjs
```

---

## Credenciais (seed dev)

| Perfil | E-mail | Senha |
|--------|--------|-------|
| Admin | `contato@quivercloud.com.br` | `M1H2sy27!pedro01` |
| Dono cervejaria demo | `dono@demo.com` | `123456` |
| Atendente demo | `atendente@demo.com` | `123456` |
| Quiosque demo | `quiosque.demo@teste.local` | `quiosque123` |
| Híbrida demo | `hibrida.demo@teste.local` | `quiosque123` |

Configs QA automatizadas (9 empresas): dono `{slug}-dono@qa.test`, senha `qa123456` (ex.: `qa-cfg-quiosque-11-dono@qa.test`).

---

## Restrições operacionais (verificadas no código)

- Autenticação: cookie HttpOnly **e** header `Authorization: Bearer`
- Rate limit login: **10 tentativas/minuto** — evite logins repetidos em loop
- Caixa quiosque: **1 sessão por ponto de venda por dia**; fechar trava o ponto até meia-noite SP
- Modo TV `?demo=N`: aceita inteiro `> 0`; strings/decimais ignorados
- Reinício dev: `npm run dev:stop` + `npm run dev:start` (não existe `dev:restart`)
- `prisma generate` no Windows pode dar EPERM se API prod estiver com DLL aberta

---

## Roteiro por perfil

### Admin (`/admin/cervejarias`)

1. Login como admin → lista de empresas com **badges** (Cervejaria, Quiosque, Cozinha, Estoque)
2. Cadastrar empresa **somente Cervejaria** → sem abas quiosque; sem trailer quiosque
3. Cadastrar **somente Quiosque** (exclusivo) → nasce **sem trailer**; só módulo quiosque
4. Cadastrar **Híbrida** com estoque + cozinha → badges corretos; dono acessa os dois módulos
5. Branding: upload logo, cor primária aplicada no header
6. Configurações: SMTP teste (dev), backup manual e download

### Dono cervejaria (`dono@demo.com`)

1. Catálogo: criar chope com preços 300/500/700 ml
2. Evento: abrir sessão do dia, montar taps
3. Comanda: abrir, itens chope + bebida, pagamento conjunto (2 comandas)
4. Encerrar evento → reabrir dentro de 30 min → resumo executivo + dashboard
5. Export CSV de transações (acentuação, separadores)

### Atendente (`atendente@demo.com`)

1. Confirmar acesso a comandas e PDV operacional
2. **Bloqueado**: dashboard, configurações, gestão de equipe, admin

### Quiosque (`quiosque.demo@teste.local`)

1. Abrir **Caixa** com troco inicial
2. **PDV**: venda avulsa com troco em dinheiro; produto esgotado some da grade (se estoque ativo)
3. Comanda por **apelido**, **mesa** e **ficha**
4. **Cozinha**: RECEBIDO → EM_PREPARO → PRONTO → ENTREGUE; senha sequencial
5. **Estoque**: reposição, perda; cancelar comanda com estorno
6. Fechar caixa com contagem e diferença

### Portal cliente (`/c/:slug/t/:trailerId`)

1. QR do trailer → login por telefone → abrir comanda
2. Pedir item → cancelar pendente → equipe confirma/recusa na fila
3. Tema claro/escuro persiste
4. Encerrar evento → sessão portal invalidada (401)

### Híbrida (`hibrida.demo@teste.local`)

1. Alternar Cervejaria ↔ Quiosque no mesmo login
2. Dados de um módulo não vazam para o outro na UI

### Modo TV

1. `/ranking/tv/:eventoId` — fullscreen, selo AO VIVO
2. `?demo=5` — ranking demo sem expor dados reais; não navega para área autenticada

---

## Casos de borda (manual)

| Caso | Passos | Esperado |
|------|--------|----------|
| Isolamento empresas | Dono A tenta URL/ID de B | 404 ou vazio, nunca dados de B |
| RBAC | Atendente acessa `/dashboard` | Bloqueado |
| Venda sem caixa | PDV quiosque com caixa fechado | Erro claro; venda recusada |
| Estoque insuficiente | Vender além do saldo | Bloqueio no PDV e API 400 |
| Comanda duplicada | 2 atendentes, mesmo cliente/evento | 409 |
| Reabertura 30 min | Fechar evento, esperar >30 min, reabrir | Recusado |

---

## Evidência mínima por caso

- Print ou trace Playwright
- Resultado esperado vs encontrado
- Empresa, perfil, URL
- **Sem** tokens/cookies/senhas nos anexos

---

## O que este roteiro não cobre (ondas futuras)

- Performance (k6), segurança (ZAP), resiliência (Postgres down)
- Acessibilidade sistemática (axe)
- Property-based pagamento conjunto / caixa

Ver matriz de cobertura para priorização.
