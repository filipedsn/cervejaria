# Gate coordenado: cozinha e categorias

## Identificação e builds

- Base publicada antes desta entrega: `4edeec64e79586527052d1352d39b8c50dbaf68b`, contendo `f8ba04d` e `5a33472`.
- Build backend limpo dessa base falhou em dois pontos de integração de catálogo público: `resolveLogoVersion` não exportado por `cervejaria-branding.ts` e serializador público sem `categoria` para o filtro de `public.ts`. O build frontend passou. Não foram encontrados erros de build em arquivos de cozinha no HEAD.
- Os dois ajustes locais autorizados foram incorporados em `84ca9cd`: exportação de `resolveLogoVersion` e inclusão de `categoria` na serialização do cardápio público. O primeiro build limpo desse commit identificou uma dependência da mesma correção de logo: o contexto de trailer público precisava selecionar `updatedAt`. Essa linha local foi incluída em `8a89aed`.
- Builds limpos de backend e frontend em `8a89aeddaebb1d5fa047e27310e8930b189b434c` passaram. O backend concluiu `tsc`; o frontend concluiu `tsc -b`, Vite e PWA. Permanecem avisos existentes de tamanho de chunks e import dinâmico.
- Origem claramente separada: o erro estava no HEAD publicado, não em alterações incompletas de cozinha. Os ajustes de integração do cardápio/logo eram alterações locais autorizadas. Demais alterações locais alheias foram preservadas e não entraram nos commits.

## Testes focados

- Playwright de cozinha: 8/8 passaram contra o frontend compilado de `8a89aed`, com API e Socket.IO simulados. Cobertura: três páginas, cartão alto e cinco curtos, pedidos longos, dimensões reais sem overflow/rolagem, realtime/reconexão, proteção durante interação, duplo toque e conflito.
- Playwright de categorias: 9/9 passaram. A asserção de portal foi alinhada ao contrato presente no código publicado: o portal exibe os nomes canônicos como seções, sem filtro de tipo. O teste valida `Petiscos`, `Bebidas especiais`, `Bebidas` nessa ordem e os produtos correspondentes. A expectativa anterior procurava um botão `Bebidas` de uma mudança visual local ainda não publicada e falhava contra o HEAD. Os outros casos cobrem manutenção, permissões, ordem da comanda, Chope por Tap, volume e classificação.
- API autenticada de categorias: passada em PostgreSQL descartável tmpfs a partir do snapshot limpo `472f828`; cobre owner/permissão/isolamento de tenant, ordem canônica e LEGACY, renomeação e preservação de classificação/volume de Chope, opcionais e snapshots. O runner aplicou 100 migrações apenas para inicializar o banco efêmero; não foi executado QA de migração.
- QA de concorrência da cozinha: 3/3 passaram em PostgreSQL descartável. Inclui cancelamento idempotente, status concorrente, retry, comando atrasado e recusa incompatível. Um primeiro lançamento simultâneo foi recusado porque outro container já usava a porta local; a repetição sequencial passou.
- Socket.IO real, duas sessões: 12/12 eventos recebidos sem polling. Amostra mais recente: request/commit/emissão até resposta p50 58,88 ms e p95 242,45 ms; emissão do servidor até recebimento p50 2,63 ms e p95 57,11 ms; evento recebido antes da resposta HTTP em todas as amostras (p50 -0,98 ms). Refetch/renderização visível no navegador continuam sem medição válida; ver `kitchen-realtime-latency.md`.

## DEV e evidência

- Atualização conjunta concluída após os gates: backend e Vite DEV iniciados a partir do arquivo limpo do SHA `472f828d08c869668904991a4d43dcec09f39b98`, mantendo as alterações alheias do workspace intactas.
- Verificação pós-deploy: `/api/health` e `/api/ready` passaram diretamente na API e pelo proxy frontend; ambos reportaram o mesmo `releaseSha` e banco DEV pronto. O módulo de contexto frontend servido contém o mesmo SHA. Portas locais 3002/5202.
- Este registro final altera somente documentação depois da publicação; a revisão servida permanece `472f828d08c869668904991a4d43dcec09f39b98`.
- Capturas Playwright com dados simulados: `artifacts/kitchen-pagination/regression-after/` (topo/fundo em tablet e TV) e `artifacts/kitchen-pagination/masonry-after/page-1.png` (seis pedidos na grade contínua). A fila usa scroll vertical manual; as dimensões e a ausência de paginação são verificadas por assertivas Playwright.
- PROD não acessada. Nenhum pedido real foi alterado. TAP-76 permanece In Progress.
