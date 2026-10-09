# Gate coordenado: cozinha e categorias

## Revisões e builds

- HEAD publicado testado: `4edeec64e79586527052d1352d39b8c50dbaf68b` (contém `f8ba04d` e `5a33472`).
- Build backend do HEAD, em cópia temporária limpa: **falhou** em `backend/src/lib/cervejaria-branding.ts` (a rota `public.ts` importa `resolveLogoVersion`, que não é exportado no HEAD) e em `backend/src/routes/public.ts` (o seletor por categoria recebe produtos sem a propriedade `categoria`).
- Build frontend do HEAD: **passou** (`tsc -b`, Vite e PWA; avisos existentes de chunk grande e import dinâmico).
- Builds do workspace local: **backend e frontend passaram**. O workspace tem alterações locais não publicadas que explicam a diferença: `backend/src/lib/cervejaria-branding.ts` exporta o resolvedor e `backend/src/lib/comanda-service.ts` inclui o nome da categoria na serialização pública. Esses arquivos não foram alterados nesta entrega. Não há arquivos de cozinha modificados localmente.

Assim, os erros estão no HEAD publicado; as alterações locais os corrigem no build combinado. Não foram encontrados erros de build de cozinha para corrigir. O frontend/backend DEV não foram reiniciados porque o HEAD publicado ainda não passa o build backend e as correções locais não estão em um SHA publicado.

## Testes focados

- `backend/scripts/run-kitchen-cancellation-disposable-qa.mjs`: 3/3 passaram; duas sessões simultâneas, retry, comando atrasado, conflito incompatível, histórico e efeitos estoque/financeiro.
- `backend/scripts/run-kitchen-realtime-latency-disposable-qa.mjs`: 12/12 eventos recebidos em duas sessões via Socket.IO real, sem polling; nenhum banco real usado.
- `e2e/current-model/kitchen-pagination-regressions.spec.ts`: 8/8 passaram usando Vite local e Socket.IO simulado isolado (`VITE_SOCKET_URL=http://127.0.0.1:3003`). Inclui três páginas, cartões altos/curtos, pedido longo, reconexão, interação e duplo toque.
- `backend/scripts/run-pdv-gamified-category-api-qa.mjs`: passou em banco PostgreSQL descartável tmpfs; API autenticada cobre permissão/tenant, ordem canônica, LEGACY e classificação Chope. Usou baseline de 100 migrations para criar o banco descartável; não houve acesso a DEV/PROD.
- `e2e/pdv-gamified-categories.spec.ts`: 9/9 passaram com APIs interceptadas e Vite local; inclui mesma ordem/nomes no catálogo, comanda e portal, Chope por Tap, nome/volume e classificação.

## Medição mais recente

Em 12 mudanças de status: request/resposta p50 38,99 ms, p95 112,3 ms; emissão→recebimento Socket.IO p50 1,75 ms, p95 18,12 ms; evento chegou antes da resposta HTTP em todas as amostras (diferença p50 -0,63 ms). Refetch/render visível segue pendente de captura válida no navegador, como registrado em `kitchen-realtime-latency.md`.

Não há correção de produção nesta entrega. O SHA testado publicado permanece `4edeec64e79586527052d1352d39b8c50dbaf68b`; esta evidência documenta a distinção entre HEAD e workspace local. As duas correções locais que fazem o build combinado passar permanecem sem commit até resolver a restrição de não alterar a implementação de categorias. TAP-76 permanece In Progress.
