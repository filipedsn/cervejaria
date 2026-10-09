# TAP-76 — Controles da prévia do portal

Revisão de 09/10/2026, sobre o commit `7b305d9`.

[Capturas das quatro combinações, antes/depois, em 390px e 768px](comparacao.html).
Inclui imagem sintética com cantos identificados e fundo padrão: 32 PNGs
originais e oito arquivos JSON com medidas reais e estilos dos botões.

## Reprodução antes da correção

As quatro combinações foram executadas no DEV existente em
`http://127.0.0.1:5202/configuracoes/aparencia`, com APIs, uploads e WebSockets
simulados, em contextos Chromium novos e com service worker bloqueado.
Nenhum dado real foi lido ou alterado.

O processo de :5202 estava ativo e servia Vite deste projeto. As respostas de
`/`, `/src/pages/AparenciaPage.tsx`, `/src/components/PortalBackground.tsx` e
`/src/components/PortalBackground.css` retornaram HTTP 200 e `Cache-Control:
no-cache`, incluindo os controles e o componente introduzidos em `7b305d9`.
A reprodução independente de service worker confirma que os defeitos
encontrados não dependem de cache da PWA. O cache de uma sessão antiga do
usuário não foi inspecionado ou limpo.

Defeitos comprovados:

1. Os botões de dispositivo tinham `aria-pressed` correto, mas nenhum estilo
   persistente para esse estado. Ambos ficavam com o mesmo fundo branco;
   somente o hover temporário podia dar impressão de seleção. O estado
   horizontal também não recebia destaque persistente.
2. A moldura usava largura disponível com máximo de 384px e `aspect-ratio`,
   sem limite de altura pela viewport. Celular vertical chegava a 701px em
   tela de 390px e 831px em tela de 768px, tornando a simulação alta demais
   para mostrar junto aos controles e à navegação.

Não foi reproduzida perda da orientação ao trocar dispositivo, submissão
de formulário ou request gerada pelos controles. As razões largura/altura
já estavam corretas. `flex-shrink` computado era 1, mas a moldura não estava
em um contêiner flex; não foi a causa. A imagem continuava inteira com
`contain`, inclusive na combinação horizontal; sem imagem, o fundo padrão
também funcionava.

## Correção limitada à prévia

`AparenciaPage` calcula a mesma razão de dispositivo/orientação como número
e fornece `--portal-preview-ratio`. A classe específica da prévia calcula
largura limitada pelo espaço disponível, 384px e pelo orçamento de altura
`min(50dvh, 512px)` multiplicado pela razão. Assim as duas dimensões diminuem
juntas; não se aplica um `max-height` isolado que deformaria a moldura.
Há fallback `50vh`. Nenhuma alteração de `flex-shrink` foi necessária.

Os botões selecionados recebem fundo, borda e texto da cor de marca via
`aria-pressed`. A orientação continua indicada pelo texto vertical/horizontal
e pelo estado pressionado. Trocar dispositivo preserva a orientação existente.
Os handlers continuam sendo apenas mudanças de estado React, com
`type="button"` explícito.

O tratamento de `PortalBackground.tsx`, imagem, camada escura e CSS do portal
real permanece igual. Nenhum contrato de upload, salvamento ou remoção mudou.

Medidas em pixels, iguais com imagem e fundo padrão (arredondadas):

| Tela | Dispositivo/orientação | Antes | Depois | Razão esperada |
| --- | --- | --- | --- | --- |
| 390 | Celular vertical | 324 × 701,16 | 195 × 422 | 0,4621 |
| 390 | Celular horizontal | 324 × 149,70 | 324 × 149,70 | 2,1641 |
| 390 | Tablet vertical | 324 × 432 | 316,5 × 422 | 0,7500 |
| 390 | Tablet horizontal | 324 × 243 | 324 × 243 | 1,3333 |
| 768 | Celular vertical | 384 × 831 | 236,58 × 511,97 | 0,4621 |
| 768 | Celular horizontal | 384 × 177,44 | 384 × 177,44 | 2,1641 |
| 768 | Tablet vertical | 384 × 512 | 384 × 512 | 0,7500 |
| 768 | Tablet horizontal | 384 × 288 | 384 × 288 | 1,3333 |

## Validação

Antes: quatro cenários de reprodução aprovados, registrando as 16 combinações
sem exigir o novo limite de altura ou estilo ativo. Capturas em `before/`.
Depois: quatro testes focados aprovados, novamente cobrindo 16 combinações,
com asserts de medidas, razão, limite de altura, ausência de overflow,
seleção persistente sem hover, orientação preservada durante troca de
dispositivo e estilo coerente do botão de orientação. Capturas em `after/`.

Cada sequência exige zero requests após a carga inicial, inclusive assets,
e verifica `type="button"`. Com imagem, a URL salva e proporção permanecem
iguais e `object-fit` segue `contain`. Sem imagem, a mesma sequência verifica
o fundo padrão. Não se realiza upload durante esses testes.

Executar contra DEV, sempre com APIs simuladas:

```powershell
$env:E2E_BASE_URL = 'http://127.0.0.1:5202'
$env:E2E_SKIP_SERVER = '1'
npx.cmd playwright test --config=playwright.portal-preview.config.ts
```

Sem as variáveis, o runner inicia somente um frontend local em :5197.
As capturas do card ocultam a navegação fixa do app somente durante a captura;
controles, imagem e conteúdo da prévia não são ocultados. Medidas, estados
e ausência de overflow são verificados na página normal.

`npm.cmd run build --prefix frontend`: aprovado, com os avisos existentes
de tamanho de bundle e importação dinâmica.

A regressão de `playwright.portal-background.config.ts` verifica as imagens
horizontal/vertical/quadrada, portais EVENTO/CAIXA, rolagem longa, rotação,
quatro cantos por pixels e fallback. Uma execução teve timeout antes de exibir
a primeira tela de indisponibilidade de um cenário; o mesmo cenário passou
na reexecução sem mudança de código. A matriz final foi reexecutada integralmente:
16/16 testes aprovados.

Sem QA de migração, acesso a PROD, alteração de dados/imagens de clientes ou
mudança de PWA/cache global. Alterações locais e stashes preservados.
TAP-76 mantém título e **In Progress**. `PROD_DEPLOY_REQUIRED: Yes`;
release em produção e aceite geral da TAP-76 permanecem pendentes.
