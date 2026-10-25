# Evidência: grade da cozinha no tablet

Capturas Playwright do build local em 24/10/2026. O arquivo `before-tablet.png` reproduz o layout anterior (auto-fill de cartões 18–20rem, alinhamento no topo) usando quatro pedidos fictícios de 1, 2, 4 e 3 itens. `after-tablet.png` usa o CSS corrigido. Os pedidos e dados são iguais nas duas capturas.

## Comparação e verificação

| Viewport | Antes | Depois | Ações |
| --- | --- | --- | --- |
| 1280×720 paisagem | 3 cartões na linha + 1 abaixo; 70 px de rolagem, com o quarto cartão parcialmente cortado | 4 cartões em uma linha; sem rolagem para os quatro pedidos | botões com 48 px de altura, alinhados à base |
| 1024×600 paisagem | — | 4 cartões em uma linha; cartões de 245 px; conteúdo e ações cabem na altura disponível | botões com 48 px |

`tablet-scroll.png` mostra a versão anterior da fila fictícia longa no fim da rolagem. Na captura, 30 pedidos foram renderizados em linhas de 4 (a última com 2); no fim, o pedido #30 e a ação continuam inteiramente visíveis. `metrics.json` registra medidas do grid, quantidade de cartões por linha, altura dos botões e avanço do relógio de pedido durante a captura.

Na captura original, a grade preservava a ordem do array operacional e esticava os cartões até a altura do maior da linha, sem reduzir a fonte. A fixture de quatro pedidos abre em `/operacao/cozinha/tv?demo=1&tablet=1`; a demo padrão de 30 continua em `/operacao/cozinha/tv?demo=1`.

## Atualização: colunas calculadas por largura (24/10/2026)

A quantidade de colunas agora é calculada com a largura útil da grade, o espaçamento e a largura mínima do cartão, limitada a quatro em paisagem para tablet. A verificação Playwright atual observou 3 colunas em 900/1024 CSS px e 4 em 1100/1280/1366 CSS px; viewport de toque 1920×1200 também fica limitado a 4. No emulador Android de 10″ do Thiago (resolução física 1920×1200, 240 dpi), a captura [`emulator-10in.png`](emulator-10in.png) mostra quatro pedidos na primeira linha. A captura Playwright anterior `after-tablet-1024x600.png` documenta a regra fixa de quatro colunas e é histórica, não representa o cálculo dinâmico atual.

Validação de evento Socket.IO e conferência no DEV oficial permanecem pendentes: os serviços `:3002` e `:5202` estavam desligados, e a faixa de portas exigida pelo teste socket existente (55439–55449) está excluída pelo Windows. Não houve acesso ou alteração em produção.

## Atualização: preenchimento vertical por coluna em tablets (24/10/2026)

Em tablet paisagem, a grade mantém até quatro colunas, limita a quantidade às colunas que realmente têm pedidos e distribui a sequência verticalmente dentro de cada coluna (#1, #5, #9… na primeira; #2, #6, #10… na segunda). Cada cartão acompanha a altura do próprio conteúdo; o próximo pedido da coluna começa após o cartão anterior, sem esperar o cartão mais alto das outras colunas. Isso preenche os espaços marcados na evidência do Thiago sem trocar os pedidos de coluna.

[`simulacao-tablet-10in.png`](simulacao-tablet-10in.png) mostra a fila de 30 pedidos em viewport 1280×800 CSS px, toque habilitado e escala física equivalente a 1920×1200.
