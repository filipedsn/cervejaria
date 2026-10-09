# Agenda calendário — evidência focada em 09/10/2026

O layout anterior (47c86a8) foi substituído por Mês/Lista, seleção de dia, Hoje e navegação mensal. O formulário único salva agendamento avulso ou repetição semanal. As ações de editar, cancelar uma data e interromper a regra têm implementação backend; a UI mockada não é a única evidência desses contratos.

## Verificações

- Builds TypeScript/backend e frontend/PWA aprovados. O frontend conserva os avisos já existentes de tamanho do bundle e importação estática/dinâmica de `auth-session`.
- UI: `npx.cmd playwright test --config=playwright.agenda.config.ts`, 12 testes aprovados, com APIs interceptadas e nenhum request desconhecido permitido. Exercita 390px e 768px, Mês/Lista, navegação e contadores consistentes, período semanal, salvamento atômico pelo endpoint novo, retry com a mesma chave, envio único, rascunho/descarte (incluindo Voltar do navegador), repetições sem datas/inativas, edição/cancelamento, bloqueios de histórico, interrupção, LEGACY e permissão. Viewport reduzido verifica o rodapé com espaço equivalente ao teclado aberto.
- Backend: `node scripts/run-agenda-disposable-qa.mjs` em `backend`, 12 cenários aprovados em PostgreSQL 17 descartável. Falha real de inserção por trigger comprova rollback de regra, datas e recibo de auditoria. Retry concorrente usa uma só série. Há verificações de auditoria, cancelamento sem remoção física, histórico fechado, inatividade, recusa por tenant/PDV/permissão e disputa pelo mesmo advisory lock que protege a associação ao caixa.
- O caso de concorrência executa o protocolo transacional de lock de caixa, lock de ocorrência, revalidação e inserção do vínculo, conforme `abrirCaixa`. Não abre cardápio, vende produtos ou altera dados financeiros.
- O container é rotulado, usa tmpfs e porta exclusiva local validada; foi removido ao finalizar. Nenhuma migração/cutover, agenda real de cliente ou acesso a PROD foi usado.

## Capturas

- `artifacts/agenda-mobile-calendar.png` e `agenda-tablet-calendar.png`.
- `artifacts/agenda-mobile-calendar-list.png` e `agenda-tablet-calendar-list.png`.
- `artifacts/agenda-mobile-calendar-form.png` e `agenda-tablet-calendar-form.png`.

Capturas anteriores foram preservadas como histórico do commit rejeitado. O banner Reconectando, causado pelo socket intencionalmente fechado nas fixtures, é ocultado apenas na captura; a aplicação não foi alterada para escondê-lo.

## Limitações reais

- A certificação visual é em Chromium emulado. Teclados nativos, notch/safe area real e instalação PWA em aparelhos físicos não foram certificados aqui.
- Regra inativa pode ser editada, mas não pode gerar novas datas. Não existe ação nova de reativação. Interrupção preserva datas existentes; cancelamento em lote da série não foi implementado.
- Não foram criadas políticas para operações já abertas/fechadas, reabertura de ocorrências ou alteração de caixa/financeiro. O cancelamento novo limita-se à ocorrência programada sem vínculos.
- A entrega ainda precisa de release coordenada frontend/backend para chegar a produção (`PROD_DEPLOY_REQUIRED: Yes`).

## Suggested Plane Item — sem criação automática

- **Título sugerido:** Investigar binding dos métodos raw e de encerramento no wrapper Prisma observado.
- **Problema:** no QA descartável, usar `$executeRawUnsafe` e `$disconnect` pelo export observado de `src/lib/prisma.ts` produziu `InvalidArg: data did not match any variant of untagged enum JsonBody`, com logs de métodos internos `_engine`/`_tracingHelper` interceptados. A hipótese é que o Proxy instrumenta objetos internos e não preserva o binding em todos os métodos.
- **Impacto:** dificulta DDL e encerramento em scripts de QA que importam esse wrapper; o alcance nos outros consumidores ainda precisa ser investigado.
- **Evidência:** a falha ocorreu ao instalar o trigger descartável para testar rollback; executar os mesmos testes com `new PrismaClient` direto passou integralmente. As rotas da agenda e transações novas passaram com o wrapper existente. Nenhuma correção desse wrapper foi incluída.
- **Prioridade sugerida:** Low, pois a reprodução ficou restrita ao QA descartável e o caminho da entrega está validado. Exige autorização humana para criar item.
