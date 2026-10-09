# TAP-76 — Enquadramento do fundo do portal

## Causa e correção

O corte estava no CSS, não na transformação do arquivo. `PortalClientePage`
e `PortalPdvPage` usavam `backgroundSize: cover` e `backgroundAttachment: fixed`
no elemento que contém a página rolável. A prévia em Aparência também usava
`bg-cover`, em um retângulo sem proporção de dispositivo e com outro gradiente.

O upload em `backend/src/lib/cervejaria-branding.ts`, função
`savePortalBackground`, já aplica orientação EXIF com `rotate()` e reduz para
até 2400 × 2400 usando `fit: inside`, sem ampliar, antes de converter para WEBP.
Esse limite é uma caixa máxima de processamento, não uma proporção obrigatória.
Não foi necessário alterar o backend ou reprocessar arquivos existentes.

O componente `PortalBackground` e seu CSS agora são compartilhados pelos dois
portais e pela prévia. A camada do portal é fixa, com altura `100dvh` e fallback
`100vh`, independente da altura do conteúdo. As dimensões naturais da imagem
determinam sua proporção; unidades de contêiner limitam sua largura pela largura
e altura da camada. `object-fit: contain` preserva o arquivo inteiro.

A imagem fica centralizada e não se repete. O gradiente original (opacidades
0,76 a 0,88) cobre somente a área da imagem; os espaços restantes conservam
`--color-canvas`. A camada usa `pointer-events: none`, isolamento de empilhamento
e contenção de overflow. Ausência de imagem ou erro de carregamento mantém o
fundo padrão, sem ícone de imagem quebrada ou gradiente residual.

Aparência oferece celular (390:844), tablet (768:1024) e orientação horizontal,
com o mesmo componente e gradiente do portal. A orientação exibida é:
“A imagem será exibida inteira. Espaços restantes usarão a cor de fundo do portal.”

## Contratos preservados

- Upload multipart `background`, salvamento imediato, URL salva e remoção.
- PNG, JPG e WEBP; máximo de 5 MB. Nenhuma dimensão única exigida.
- Autorização de dono e `cervejariaId` da sessão no upload e na remoção;
  arquivo nomeado por empresa. Nenhuma mudança no isolamento entre empresas.
- Fundo padrão e cores atuais do portal.
- Alterações locais preexistentes e os dois stashes foram preservados;
  o commit contém somente esta correção, testes e documentação.

## Validação focada — 09/10/2026

`npm.cmd run build --prefix frontend`: aprovado, incluindo TypeScript, bundle
e service worker. Permanecem os avisos de tamanho de bundle e importação dinâmica
que também aparecem no build do snapshot baseado em HEAD.

`npx.cmd playwright test --config=playwright.portal-background.config.ts`:
16 testes aprovados, com Chromium, viewport e toques simulados.

- Imagens PNG sintéticas geradas em memória: 3200 × 1600, 1600 × 3200 e
  2800 × 2800, com cores e rótulos TL/TR/BL/BR nos quatro cantos.
- Matriz 390 × 844, 768 × 1024, 844 × 390 e 1024 × 768, mais rotação
  sem recarregar a página. Verificação de escala uniforme, centralização,
  quatro cantos por pixels renderizados, gradiente e cor dos espaços restantes.
- EVENTO: indisponibilidade, identificação, confirmação, cadastro divergente,
  cadastro novo, cardápio e resumo. CAIXA: indisponibilidade, identificação,
  cardápio e resumo. Todos usam o mesmo fundo.
- Cardápios longos de 45 produtos: o tamanho e a posição do fundo permanecem
  iguais antes e depois de rolar. Sem rolagem horizontal; controles respondem
  a toque e a camada de fundo não recebe eventos.
- Prévia celular/tablet em ambas as orientações para cada proporção; upload
  envia os bytes originais, salvamento persiste após recarga e remoção restaura
  o padrão. Arquivo 404 e empresa sem imagem não reutilizam o fundo anterior.

As capturas para leitura dos pixels ocultam temporariamente o conteúdo de
primeiro plano e a navegação fixa apenas no navegador de teste, preservando a
camada escura. As verificações de geometria e interação usam a página normal.
Capturas da prévia ficam em `test-results/portal-background/` (não versionadas).

Também foi validado um snapshot temporário do frontend de HEAD com apenas os
arquivos do ajuste, sem worktree e sem as alterações locais de outros trabalhos:
build aprovado e a mesma matriz de 16 testes aprovada. Isso verifica o conteúdo
do commit isoladamente, além do workspace atual.

Todas as APIs, uploads e WebSockets são interceptados. O runner inicia somente
o frontend local em 127.0.0.1:5197, sem backend ou banco de dados. Não houve QA
de migração, acesso a PROD ou alteração de imagens de clientes.

## Publicação

Registrar o SHA e o resultado do push no comentário de evidência da TAP-76.
Manter o título e **In Progress**: o aceite geral do ticket continua fora do
escopo deste ajuste. `PROD_DEPLOY_REQUIRED: Yes`; release em produção pendente,
sem execução neste trabalho.
