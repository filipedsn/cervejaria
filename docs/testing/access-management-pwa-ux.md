# Gestão de acessos na PWA — TAP-76

> Evidências de 09/10/2026: a origem tapdev citada nas capturas/execução é histórica. O DEV oficial atual é local: `http://localhost:5202` (API `http://localhost:3002`). Use localhost para repetir o teste.

Correção de UX em 09/10/2026. A lista de equipe passa a mostrar cartões compactos
e um editor individual. As 27 permissões existentes são distribuídas em oito
grupos recolhíveis, com contagem de habilitadas/total. O cadastro usa os mesmos
grupos e começa vazio.

As seleções alteram um rascunho local. Salvar faz um único PATCH no endpoint
existente; a resposta confirmada atualiza o cache e a lista é reconsultada.
No editor de acessos, **Voltar** usa a confirmação de descarte existente quando
há alterações e retorna imediatamente quando o rascunho está limpo. Recusar
mantém o rascunho aberto; confirmar descarta. O botão tem estilo `touch-btn-orange`
e fica ao lado de **Salvar** no rodapé fixo. O X não aparece neste editor; a ação
acessível de fechar permanece disponível no cadastro de atendente, que compartilha
o diálogo. Clicar fora ou Escape solicita confirmação quando houver alterações.
Erros aparecem junto às ações, mantendo o rascunho
para retry. O envio bloqueia submissões duplicadas e o fechamento do editor.
Chaves recebidas da API que não aparecem na UI permanecem no payload.
Dependências são explicadas, sem concessão automática.

O diálogo é específico desta tela, usa foco nativo, corpo rolável, ações fixas,
safe areas e a altura/posição de `visualViewport` para acompanhar o teclado.
O Modal global permanece intacto. O proprietário conserva acesso integral e
não tem editor. Sem a lista de permissões na API (flag desligada), permanece
o contrato booleano de desconto, com os mesmos endpoints e payloads legados.

## Validação focada

- `npm.cmd run build --prefix frontend`: PASS, incluindo TypeScript e PWA.
- `npx.cmd playwright test --config=playwright.permissions-ui.config.ts`: PASS,
  12/12 cenários, seis em 390px e seis em 768px.
- Cobertura: lista compacta, proprietário sem editor, oito grupos/27 opções,
  contagens, seleção sem PATCH, descarte/cancelamento, fechamento/Escape,
  payload para o usuário correto, preservação de chave não representada,
  envio único durante resposta pendente, confirmação ao reabrir, erro e retry,
  cadastro vazio/descarte e contrato legado de atualização/cadastro.
- Geometria: ações integralmente visíveis, alvos de toque de pelo menos 44px,
  ausência de overflow horizontal, viewport curto e simulação de redução
  exclusiva de `visualViewport` com deslocamento pelo teclado.
- O teste do editor verifica X ausente, botão Voltar laranja, retorno sem request
  com rascunho limpo, confirmação recusada mantendo o rascunho, confirmação aceita
  descartando e bloqueio do Voltar durante salvamento.
- Capturas de lista/editor em ambos os tamanhos são anexadas aos resultados.
  O config cria relatórios e resultados em diretórios exclusivos
  `%TEMP%/tap-access-ui-*`, sem substituir relatórios locais preexistentes.

O servidor de teste serve somente o frontend em loopback na porta 5197.
Todas as APIs são simuladas; chamadas não previstas são abortadas e verificadas,
WebSocket é fechado e service workers são bloqueados nos testes.
Nenhuma permissão real de DEV foi alterada. Não houve acesso a PROD, alteração
de schema, migração, cutover ou execução da bateria integral de migração.
O build usa o workspace atual, com alterações locais preexistentes preservadas;
esta evidência não equivale à certificação integral de um snapshot Git.

## Atualizar e validar a PWA DEV

1. O Vite DEV usa os fontes deste projeto na porta 5202; com o serviço ativo,
   a correção é servida automaticamente. Em outra cópia DEV, atualizar os fontes
   para o commit desta correção pelo fluxo normal, preservando trabalho local.
2. Com conexão, fechar completamente e reabrir a PWA de
   `http://localhost:5202`. O app verifica o service worker ao abrir
   e recuperar foco. Se a tela antiga persistir, recarregar essa mesma origem DEV.
3. Como proprietário, abrir **Configurações → Equipe** no celular/tablet.
   Conferir cartões compactos e ausência de editor para o proprietário.
4. Abrir **Gerenciar acessos** de um atendente. Conferir nome/e-mail, oito grupos,
   contagens, descrições de dependência e ações fixas. Selecionar uma opção e
   cancelar; reabrir para confirmar que a permissão original foi preservada.
5. Para validar persistência manualmente, usar somente um atendente de teste DEV
   autorizado: salvar uma alteração, reabrir e conferir. Restaurar seu acesso
   original ao terminar. Sem usuário de teste autorizado, validar apenas descarte.
6. No cadastro, abrir o teclado e expandir grupos; conferir ações acessíveis,
   ausência de rolagem horizontal e nenhuma concessão inicial. Cancelar o cadastro.

Validação em aparelhos físicos e aceite manual da PWA DEV ficam pendentes.
TAP-76 mantém título, prioridade, labels e estado **In Progress**.
`PROD_DEPLOY_REQUIRED: Yes` para disponibilizar esta correção futuramente em PROD;
deploy não realizado nesta tarefa.


## Ajuste complementar: linha compacta da equipe

Cada registro da equipe usa uma linha horizontal compacta: nome e e-mail ficam ? esquerda, com a a??o ? direita. Funcion?rios n?o repetem o selo Atendente; o propriet?rio exibe somente o selo Propriet?rio, sem a??o de edi??o ou bloco explicativo. O bot?o Acessos preserva o nome acess?vel Gerenciar acessos de [nome] e alvo de toque m?nimo de 44 x 44px. Nomes/e-mails de funcion?rios podem ser truncados na lista; o editor exibe os valores completos. Dados do propriet?rio permanecem sem truncamento. O modo LEGACY mant?m o toggle e o payload booleano atuais.

Valida??o adicional em 09/10/2026: build frontend aprovado; Playwright de permiss?es aprovado 12/12 com APIs simuladas em 390px e 768px. Os fixtures usam nome/e-mail longos, confirmam aus?ncia de overflow, abertura do editor do usu?rio correto e exibi??o dos valores completos; salvamento, descarte e contrato LEGACY permanecem cobertos. As capturas compact-list e grouped-editor foram revisadas visualmente nos dois tamanhos: a a??o permanece alinhada ? direita, sem sobreposi??o ou rolagem horizontal. Os artefatos seguem em diret?rio tempor?rio exclusivo tap-access-ui-*.
