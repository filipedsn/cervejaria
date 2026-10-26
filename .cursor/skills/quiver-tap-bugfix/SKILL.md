---
name: quiver-tap-bugfix
description: Guia para corrigir bugs de produção do Quiver Tap a partir de um dossiê de erro. Use quando estiver corrigindo um bug reportado por um dossiê ou Issue, investigando erro 5xx em produção, ou escrevendo teste de regressão para comanda, caixa, cozinha, quiosque ou portal.
---

# Quiver Tap — correção de bug a partir de dossiê

Esta skill orienta a correção manual a partir de um dossiê ou de uma Issue. Ela não
depende de runtime, credenciais ou capacidades do Support Agent legado.

## Regra que vale mais que todas as outras

**Se você não identificar a causa raiz com confiança, pare.**

Escreva `NAO CONSEGUI DIAGNOSTICAR`, explique o que faltou no dossiê, e não altere
código. Uma correção plausível mas errada custa mais caro que nenhuma correção: ela
consome revisão humana, entra no histórico como resolvida, e o bug volta.

Sinais de que você deve parar:

- o dossiê não tem stack trace **e** a rota tem muitas responsabilidades
- a falha depende de estado de banco que você não consegue inspecionar
- a causa parece ser concorrência, ordem de eventos ou timing
- a correção exigiria mudar schema, migration ou infraestrutura
- você precisaria adivinhar a intenção de negócio para decidir o comportamento correto

## Procedimento

### 1. Entenda antes de editar

Leia o dossiê inteiro. Depois leia os arquivos suspeitos por completo, não apenas a
linha apontada pelo stack. Em Fastify, o erro costuma nascer numa função de `lib/` e
aparecer na rota.

Perguntas a responder antes de tocar em código:

- qual entrada produz a falha?
- qual comportamento é o correto, e por quê?
- por que o código atual não o produz?

Se a terceira pergunta não tiver resposta clara, você ainda não achou a causa raiz.

### 2. Escreva primeiro o teste que falha

Não é formalidade. É a prova de que você reproduziu o bug em vez de reconhecer um
padrão. Sem teste vermelho antes, a correção é uma afirmação.

Convenção do repositório: `node --test` nativo, sem framework externo.

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fecharComanda } from './fechar-comanda.js';

describe('fecharComanda', () => {
  it('rejeita pagamento com sobra em vez de descartar o excedente', () => {
    assert.throws(() => fecharComanda(/* entrada que reproduz o bug */), /sobra/);
  });
});
```

Para regras que valem para toda entrada — dinheiro, alocação, arredondamento — use
`fast-check`, já disponível como devDependency:

```ts
import fc from 'fast-check';

it('soma das formas de pagamento sempre bate com o total', () => {
  fc.assert(
    fc.property(comandaArb, (comandas) => {
      const total = totaisPorForma(comandas);
      assert.equal(somar(total), totalEsperado(comandas));
    }),
  );
});
```

Exemplos completos para copiar o estilo:
`backend/src/lib/fechar-comanda.property.test.ts` e
`backend/src/lib/quiosque/caixa.property.test.ts`.

**Se o arquivo de teste é novo, registre-o em `test:unit` no `backend/package.json`.**
O script lista os arquivos explicitamente; um teste fora da lista nunca roda no CI e
não protege ninguém.

### 3. Corrija a causa raiz

Proibido:

- `try/catch` que engole o erro para o 500 virar 200
- valor default que esconde `undefined` em vez de explicar por que ele chegou ali
- `as any` ou `!` para calar o TypeScript
- alargar um tipo para acomodar um dado que não deveria existir

Se a única correção viável é uma dessas, então o problema é de projeto e você deve
parar e explicar.

### 4. Verifique

```powershell
npm run test:unit --prefix backend   # obrigatório: precisa passar
npm run ci:validate                  # obrigatório: build do frontend + prisma validate
```

Se qualquer um falhar, o trabalho não está pronto. Não abra PR.

### 5. Explique a causa raiz em uma frase

No final da sua resposta, uma frase que qualquer pessoa entenda:

> A alocação de pagamentos usava `Math.floor` sobre reais em vez de centavos, então
> comandas com valor terminando em centavo ímpar deixavam sobra e a validação estourava.

## Mapa dos módulos

O backend é Fastify + Prisma. Rotas em `backend/src/routes/`, regra de negócio em
`backend/src/lib/`. A rota valida e orquestra; a lógica testável vive em `lib/`.

| Domínio | Rota | Regra de negócio |
|---|---|---|
| Comanda (cervejaria) | `routes/comandas.ts` | `lib/comanda-service.ts`, `lib/fechar-comanda.ts`, `lib/comanda-cancelar.ts`, `lib/comanda-numero.ts` |
| Pagamento | `routes/pagamentos.ts` | `lib/fechar-comanda.ts` |
| Evento | `routes/eventos.ts` | `lib/event-datetime.ts`, `lib/evento-cardapio.ts`, `lib/evento-reverter.ts` |
| Cardápio | `routes/cardapios.ts` | `lib/cardapio.ts`, `lib/cardapio-preco.ts`, `lib/cardapio-toggle.ts` |
| Quiosque — caixa | `routes/quiosque/caixa.ts` | `lib/quiosque/caixa.ts` |
| Quiosque — comanda | `routes/quiosque/comandas.ts` | `lib/quiosque/venda.ts`, `lib/quiosque/desconto.ts` |
| Quiosque — cozinha | `routes/quiosque/cozinha.ts` | `lib/quiosque/cozinha.ts` |
| Quiosque — estoque | `routes/quiosque/estoque.ts` | `lib/quiosque/estoque.ts` |
| Quiosque — cardápio | `routes/quiosque/cardapios.ts` | `lib/quiosque/cardapio.ts`, `lib/quiosque/sessao-cardapio.ts`, `lib/quiosque/categorias.ts` |
| Portal do cliente | `routes/public.ts` | `lib/portal-cliente.ts` |
| Autenticação | `routes/auth.ts` | `lib/security-config.ts` |
| Cliente / CRM | `routes/clientes.ts` | `lib/cliente-merge.ts` |
| Auditoria | `routes/audit.ts` | `lib/audit-hooks.ts`, `lib/prisma-audit.ts`, `lib/audit/` |
| Tempo real | — | `lib/realtime.ts` |

Multi-tenant: quase toda query é escopada por `cervejariaId`. **Uma correção que remove
ou alarga esse filtro é vazamento de dados entre tenants, não correção de bug.**

## Reproduzindo em dev

Nunca reproduza em produção. Ambiente dev: API `:3002`, frontend Vite `:5202`, banco
`cervejaria_dev`.

```powershell
npm run dev:start     # sobe API :3002 e Vite :5202
npm run dev:status    # confirma que subiu
npm run dev:stop
```

Para cenários que exigem dados, `npm run qa:test` monta o cenário completo — mas exige
Postgres e API no ar, então não serve para verificação automática sem o DEV ligado.
Prefira teste unitário puro sobre a função de `lib/`. Trabalhe sempre na pasta canônica
`Cervejaria`: não crie worktree, clone ou cópia do repo em outra pasta.

## Fronteiras que você não atravessa

Nunca, em nenhuma hipótese:

- qualquer arquivo `.env`
- `deploy/**` (inclui `prod-artifacts/`)
- `backend/prisma/migrations/**`, `schema.prisma`, `rollbacks/**`
- `.cursor/hooks/**`, `.cursor/cli.json`
- `.github/workflows/**`
- `scripts/prod/**`
- `package-lock.json`
- qualquer comando de produção: `prod:deploy`, `prod:restart`, `db:migrate:prod`,
  `taskkill`, ou escrita em `localhost:3001`

O deploy em produção é sempre liberado por um humano: aprovação da esteira Deploy PRD (VPS)
no environment `production`, pelo painel Ops `:3099` ou pelo GitHub. A regra
`.cursor/rules/quiver-tap-deploy.mdc` continua valendo integralmente.

Se a correção exigir mudança de schema ou migration, **pare e explique** — não tente
contornar o escopo.

## Contexto de produção

Um dossiê de produção tem particularidades que mudam como você lê a evidência:

- **Não há stack trace na telemetria.** Nenhum log em `logs-audit*.otel-prd` traz
  `attributes.metadata.stack`. Quando o dossiê não tem stack, é porque ele não existe —
  não porque a busca falhou.
- **Toda a telemetria de produção é `severity_text: info`.** Falhas são identificadas
  por `event.outcome: failure` e por `http.response.status_code`, não pelo nível do log.
- **4xx não é bug.** Um 401 em `/api/auth/me` é o comportamento correto de um endpoint
  que verifica sessão. O dossiê já separa 4xx (contexto) de 5xx (falha de servidor);
  concentre-se nas falhas de servidor.
- **`cervejariaSlug: system`** indica operação sem tenant — tipicamente login, health
  check ou rota administrativa.
