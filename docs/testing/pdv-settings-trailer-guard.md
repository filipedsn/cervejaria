# PDV único: configurações e bloqueio da gestão legada

Correção vinculada ao TAP-76 em 09/10/2026. Título preservado:
`[DEV/OPERAÇÃO] Certificar fluxos CAIXA/EVENTO após convergência de setembro`.
Estado mantido em **In Progress**, prioridade **high**, labels **Quality/Product**.

## Contrato entregue

Em `CANONICAL_PDV`, Configurações apresenta Equipe, PDV, Operação e Aparência.
A aba PDV usa exclusivamente o único ponto ativo do contexto validado pelo
backend. Ela não cria, exclui nem desativa unidades. Contexto indisponível,
sem fonte explícita, vazio, ambíguo ou inativo não autoriza montar gestão legada
ou provisionar uma unidade.

`PdvTapsSection` fica somente na aba PDV; a montagem do turno continua no fluxo
da sessão. `PdvPortalQrButton` recebe `pontoVendaId`, formando `/c/:slug/p/:id`.
Evento é contexto opcional da sessão Por Caixa; TAPs e portal pertencem ao PDV.
As configurações e o cadastro de TAP continuam restritos ao proprietário.

`/operacao/configuracoes/trailers` e `/configuracoes/trailers`, inclusive os
aliases `carretos` e `clientes`, redirecionam para `/operacao/configuracoes/pdv`.
O acesso direto `/trailer` segue para as comandas canônicas. O provider de
Evento e as demais consultas de Trailer aguardam confirmação explícita de
LEGACY, inclusive durante o carregamento inicial.

POST, PUT, PATCH de ativo e DELETE de `/api/trailers` mantêm autenticação e
`requireDono`, depois recusam tenants canônicos com HTTP 409 e código
`CANONICAL_PDV_TRAILER_MUTATION_BLOCKED`, antes de validar payload ou escrever.
O bloqueio usa `canonicalPdvQaActivationEnabled(process.env, cervejariaId)`,
que consulta o seletor existente `tenantPdvActivation` e sua configuração
persistida `PDV_CANONICAL_TENANTS`; não depende de haver PDV/configuração válidos
nem aceita tenant ou fonte de ativação enviados no corpo da requisição.

LEGACY preserva CRUD, consultas e vínculos históricos. GETs backend e rotas
públicas de QR não foram removidos. **Esta correção retira a gestão legada da
interface canônica; não representa remoção física completa do legado.**
Nenhuma tabela, registro, vínculo histórico ou link QR antigo foi apagado.

## Arquivos do ajuste

- `backend/src/routes/trailers.ts`: guardas das quatro mutações.
- `frontend/src/pages/operacao/OperacaoConfiguracoesPage.tsx`: aba PDV, TAPs, QR, redirecionamento e contexto validado.
- `frontend/src/pages/ConfiguracoesPage.tsx`: encaminhamento da superfície antiga.
- `frontend/src/pages/TrailersPage.tsx`: barreira antes de montar CRUD LEGACY.
- `frontend/src/pages/SelecionarTrailerPage.tsx`: acesso direto canônico.
- `frontend/src/hooks/useOperacaoContexto.ts`: resolução/erro explícitos.
- `frontend/src/contexts/EventoContext.tsx`: consulta de legado somente com fonte confirmada.
- `frontend/src/App.tsx`: erro de contexto nas rotas de Operação.
- `frontend/src/components/operacao/PdvTapsSection.tsx`: ações responsivas.
- `frontend/src/components/operacao/PainelCaixaOperacao.tsx`: sem dependência de Trailer na sessão canônica.
- `frontend/src/components/OperationalSetupWizard.tsx`: orientação de TAPs pelo PDV canônico.
- `frontend/src/pages/DashboardPage.tsx` e `EventoPage.tsx`: consultas de Trailer somente em LEGACY.
- `e2e/pdv-settings.spec.ts` e `playwright.pdv-settings.config.ts`: UI com APIs simuladas.
- `backend/scripts/run-pdv-settings-disposable-qa.mjs` e `pdv-settings-trailer.isolated.test.mjs`: API com PostgreSQL descartável.
- Este documento: evidência e roteiro DEV.

## Validação focada

Executar na raiz, sem carregar ambiente PROD:

```powershell
npm.cmd run build --prefix backend
npm.cmd run build --prefix frontend
npx.cmd playwright test --config playwright.pdv-settings.config.ts
Push-Location backend
node --import ../scripts/node24-tsx-host.mjs --import tsx --test src/lib/canonical-pdv-operational-config.test.ts src/lib/pdv-tenant-activation.test.ts
node --import ../scripts/node24-tsx-host.mjs scripts/run-pdv-settings-disposable-qa.mjs
Pop-Location
```

Resultado: builds backend/frontend aprovados; 10 cenários de UI aprovados; 6 testes de configuração e
seletor aprovados; QA de API com 26 verificações aprovadas. A UI cobre 390px e
768px, redirecionamentos, PDV/TAP/QR corretos, ausência de chamadas a
`/api/trailers`, ausência de manutenção duplicada, carregamento, contexto
inválido/erro, LEGACY e restrição de funcionário. Screenshots ficam em
`test-results/pdv-settings/` e foram inspecionados visualmente.

O QA de API usa Fastify.inject com as rotas reais e Prisma real. Identidades
de proprietário/funcionário são fornecidas pelo harness; não é certificação
de login/JWT. O PostgreSQL é um container de propriedade do runner, publicado
apenas em loopback na faixa 55439–55449, com armazenamento tmpfs e remoção
verificada por labels. A fixture contém somente Trailer, Evento e seu enum;
não executa migrations nem cutover. Ausência deliberada das tabelas de PDV
comprova que contexto inválido não enfraquece a guarda de mutação.

Cada recusa verifica todos os registros/timestamps e uma sequência incrementada
por trigger BEFORE INSERT/UPDATE/DELETE. A sequência detecta tentativas de
escrita mesmo que uma transação faça rollback. O CRUD LEGACY e payloads com
tenant falsificado são testados; IDs de outro tenant retornam 404. Funcionário
continua recebendo 403. Catálogo e permissões reais não são modificados.

## Conferência em DEV já migrado

1. Usar o processo DEV existente (:3002/:5202), autenticado como proprietário
   de um tenant já ativado. Não executar migrations/cutover ou alterar o seletor.
2. Em 390px e 768px, abrir `/operacao/configuracoes/trailers`: verificar destino
   `/operacao/configuracoes/pdv`, subtítulo e nome do PDV. Conferir também
   `/configuracoes/trailers` e aliases. Não deve haver CRUD de Trailer/unidade.
3. Com Network preservado desde o reload, filtrar `/api/trailers`: zero chamadas.
   A consulta de TAP deve usar o ID da única unidade em `/api/operacao/contexto`.
4. Abrir QR e conferir `/c/:slug/p/:pontoVendaId`; não enviar mensagens nem
   criar comandas para essa inspeção. Conferir que Operação não repete cadastro
   de TAPs. Funcionário não acessa as configurações.
5. Simular contexto ausente/ambíguo apenas no teste de UI acima; não adulterar
   DEV nem provisionar uma unidade. Testar mutações recusadas apenas no QA
   descartável acima, evitando editar catálogo, permissões e estruturas reais.

Alterações locais e stashes preservados. Sem worktrees, sem acesso a PROD,
sem bateria integral de migração. Aceite manual DEV permanece pendente deste
roteiro; TAP-76 continua In Progress. `PROD_DEPLOY_REQUIRED: Yes` para uma
eventual entrega desta correção em PROD; nenhum deploy foi executado.
