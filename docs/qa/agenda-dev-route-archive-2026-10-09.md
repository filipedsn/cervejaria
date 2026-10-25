# Correção Agenda DEV — rota, arquivamento e confirmações

> Registro histórico de 09/10/2026: URLs públicas e evidências abaixo descrevem o DEV/tunnel usado na execução original. O DEV oficial atual é local: frontend `http://localhost:5202`, API `http://localhost:3002`. Use localhost para qualquer repetição.

## Causa da rota

O frontend de b74eef4 chama `POST /api/operacao/agenda/agendamentos`. O router declara `/agendamentos`, está registrado em `/agenda` no módulo Operação e em `/api/operacao` no `buildApp`. O contrato e os prefixos no código estão corretos.

Antes da atualização do processo, uma chamada sem sessão e com corpo vazio ao endereço `https://tapdev.quivercloud.com.br/api/operacao/agenda/agendamentos` retornou **404**, corpo `{"error":"Rota não encontrada"}`. A mesma chamada em `127.0.0.1:3002` teve a mesma resposta. Já `POST /api/operacao/agenda/agendas` e a consulta de ocorrências retornaram **401**, demonstrando que o processo conhecia as rotas antigas e não registrara a nova operação. Os probes sem sessão/corpo válido não criaram registros.

O listener DEV era PID **32928**, iniciado em **09/10/2026 10:45:11**, executando `tsx ... src/index.ts` neste workspace. O commit b74eef4 é de **13:32:17**. Não havia SHA exato persistido no health antigo; o launcher marcava a revisão genericamente como `dev`. Portanto, não se atribui um SHA histórico fictício a esse processo.

A revisão atual foi validada pelo **buildApp real** em PostgreSQL QA, incluindo autenticação e os prefixos completos. Após atualizar apenas os processos DEV, sem mudar a URL/contrato do frontend, o mesmo endpoint público passou a **401**, chegando à autenticação. Isso demonstra a causa operacional: o processo servido não havia recarregado as novas rotas. O launcher agora fixa o SHA Git no início de ambos os serviços; health traz `releaseSha`/`startedAt`. Após o commit desta correção, os serviços são novamente iniciados com seu SHA, registrado na evidência Plane/entrega.

## Persistência e aplicação DEV

- Migração `20261009180000_agenda_archive`: somente a coluna nullable `archivedAt` em `quiosque.AgendaOperacional`.
- Aplicada em `cervejaria_dev:5434` por `node scripts/apply-agenda-archive-dev.mjs`, que valida runtime/credencial de migração para o mesmo alvo DEV e usa o runner existente. O bundle temporário inclui exclusivamente esta migração; a migração local de telefone e outros trabalhos foram preservados e excluídos da aplicação.
- Não houve alteração de configuração/infraestrutura PROD, exclusão de registros, stashes ou histórico. Nenhuma agenda real de cliente foi criada nos testes.
- Na geração do Prisma Client ocorreu EPERM ao substituir a DLL Windows já existente. Os arquivos JS/schema/tipos foram atualizados com `archivedAt`; o SHA-256 da DLL instalada é idêntico ao da engine distribuída pelo Prisma (`263946105f428384d2318dc3241b85b1c3dd98fbb1bfac62d3e81f513ab35897`). Nenhum processo PROD foi encerrado. A compatibilidade efetiva foi confirmada nos builds, no buildApp/PostgreSQL QA e no início do DEV atualizado.

## Resultados

- Builds backend e frontend/PWA aprovados; avisos de bundle/importação já existentes mantidos.
- **15 cenários PostgreSQL QA**, usando `buildApp`, JWT/sessão persistida e middleware reais: registros de rota, salvamento único/semanal, retry concorrente, rollback, edição, cancelamento/interrupção, histórico, escopo/permissão e arquivamento ativo/inativo. Arquivamento preserva snapshots de datas, caixa fechado, mapa de migração e auditoria anterior; total de 6 datas permanece 6 mesmo quando a consulta mensal contém somente 4. Regras arquivadas não geram e não são editadas pelo PATCH legado. Container descartável removido.
- **16 testes Playwright**, APIs simuladas em 390px/768px: confirmações visuais com nenhum diálogo nativo, campos/foco/teclado após recusa, descarte sem escrita, ações explícitas, arquivamento persistente após reload e Ver arquivadas, além dos fluxos anteriores e LEGACY.
- Capturas novas: `artifacts/agenda-discard-{mobile,tablet}.png`, `agenda-archive-confirm-{mobile,tablet}.png`, `agenda-archived-{mobile,tablet}.png`. Capturas históricas foram preservadas.

## Repetir o cadastro em DEV

1. Abra `http://localhost:5202/operacao/agenda` com sua sessão. Se a PWA estiver com a versão anterior, copie os campos do rascunho antes de recarregar/atualizar a página.
2. Selecione a data e Novo agendamento. Informe nome e horário; para semanal, marque Repetir semanalmente e confira primeira/última data.
3. Clique Salvar uma vez. O sucesso fecha o painel e atualiza as datas. Se houver falha temporária, mantenha o painel e clique Salvar novamente; a chave de retry permanece a mesma.
4. Para diagnóstico, a chamada deve ser `POST /api/operacao/agenda/agendamentos`, com 200 após autenticação/dados válidos. Confira a revisão em `http://localhost:3002/api/health`. Requests sem sessão devem retornar 401, nunca Rota não encontrada para esse endpoint.

Limites: os testes positivos de salvamento usam banco QA descartável; no endereço público DEV são feitos probes de acesso/registro e leitura de revisão, sem cadastrar em conta real. Teclado/notch nativos continuam sujeitos à validação em aparelho físico. Recarregar ou fechar a aba inteira é externo à navegação protegida e não persiste o rascunho em disco.
