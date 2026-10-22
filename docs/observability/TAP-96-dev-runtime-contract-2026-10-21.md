# TAP-96 — contrato de runtime e provas DEV

Este documento descreve o candidato e os ensaios reproduzíveis. A aceitação do
runtime publicado é registrada separadamente em `artifacts/tap96/<run>/proof.json`
e no relatório operacional da execução. CI ou prova isolada não certificam PROD.

## Contrato

- `npm start` e o launcher PROD candidato carregam `backend/scripts/otel-sdk.mjs`.
  O preload lê o ambiente antes do SDK, fixa serviço, ambiente, namespace e release,
  rejeita SDK desabilitado herdado e habilita explicitamente o envio de Pino EDOT.
  Os launchers limpam configuração OTEL herdada antes de carregar o arquivo oficial.
- DEV: `quiver-tap-api-dev`, `development`, `dev`; PROD candidato:
  `quiver-tap-api`, `production`, `prd`. A instância é opaca; detectores de host,
  processo, SO, container e cloud permanecem excluídos.
- Auditoria tem um único transporte autoritativo, a Logs API. Pino exporta logs
  técnicos reais. O antigo provider técnico separado usa agora o SDK comum,
  evitando deriva de resource e flush independente.
- A sanitização ocorre antes de ambos os transportes. Há limite seguro de
  profundidade/tamanho, preservação de códigos técnicos e allowlist de metadados.
  Payloads comerciais e corpos HTTP completos não são exportados. O fallback de
  recuperação de senha sem SMTP não imprime destinatário ou link secreto.
- Transações externas publicam sucesso somente depois do commit; rollback descarta
  callbacks. Chamadas a `registrarTransacao` nas rotas são aguardadas. O registro
  SQL existente continua sendo o registro persistido; não foi criada uma outbox.
- Spans de banco contêm modelo/operação, tenant e resultado, sem SQL ou bindings.
  Delegates executados dentro de transações também usam a instrumentação.
- A fila UI tem teto global de 200 eventos, TTL de 15 minutos, cinco tentativas,
  backoff e uma requisição em voo. Logout, troca de usuário/empresa e troca de
  comanda no portal invalidam a geração anterior. O servidor verifica a origem
  contra a sessão autenticada. IDs estáveis permitem identificar retries; não há
  promessa de exactly-once ou durabilidade após fechar o navegador.
- Ocorrência informada pelo cliente, recebimento do servidor e ingestão são relógios
  separados. Cliente com skew futuro >1 minuto ou atraso >15 minutos é sinalizado;
  seu relógio não substitui o relógio do servidor.
- Poller drena páginas limitadas de eventos ainda não reconhecidos no ES, sem usar
  timestamp para excluir eventos tardios. Falha de entrega não é reconhecida como
  sucesso; dedup é persistido antes do ACK no ES, que é aguardado. Fetch, Telegram
  e SMTP têm timeout. A semântica é pelo menos uma tentativa, não exactly-once.
- SIGINT/SIGTERM e parada DEV por capability local drenam HTTP, desconectam banco e
  encerram o SDK com prazo de 10 segundos. O token DEV é por processo, fora do
  pacote/Git, e o endpoint não existe em produção. Candidatos históricos continuam
  validáveis para rollback pelo contrato de startup de seu próprio package.json.

## Ensaios executados

As regressões foram confrontadas com `11a794bd`, o DEV ativo na abertura do trabalho.
Foram reproduzidos: identidade herdada, Pino sem opt-in, sanitização profunda e
direta, sucesso antes de commit, eventos tardios do poller, erros de polling
suprimidos, atribuição UI A→B, timestamp ignorado e métrica de pagamento sem tenant.
Também foi reproduzida emissão de link de recuperação de senha no stdout sem SMTP.

O gate de SDK usa HTTP OTLP local e verifica separadamente Pino info/warn/error,
auditoria única, traces, métricas de runtime e negócio, resource e canários de
privacidade. Outra prova inicia a API real, solicita sua parada e verifica flush
dos três providers antes da saída. Nenhuma prova usa endpoint PROD.

`npm run ci` inclui esses contratos, regressões UI e o antigo gate indispensável
`realtime-security-qa` em PostgreSQL descartável. Os 11 cenários RT-03 e RT-13–22
exercitam o mesmo código das verificações anteriores do Actions. Actions continua
desligado. O atestado válido para entrega deve ser gerado após o commit final.

O teste amplo opcional do frontend já falha em `operacao-comanda.test.ts:25`: espera
`outros`, enquanto a implementação não alterada retorna `bebidas`. Não foi alterado
o contrato de classificação comercial para corrigir um teste fora deste escopo.
O build oficial, os novos testes UI e os demais gates continuam obrigatórios.

## Infraestrutura temporária e evidências

Collector Contrib 0.130.1 e ES 8.17.0, com rede/portas/armazenamento próprios:

| Ensaio | Resultado | Evidência |
|---|---|---|
| Dois instrumentos, mesmas dimensões e timestamp, lotes separados | Baseline: 1 documento; corrigido: 2 | `docs/evidence/tap96-dev-2026-10-21/collision-*.json` |
| Quarentena e precedência do payload | Baseline desviava para `prd` isolado; corrigido indexa em `quarantine` | `backend/scripts/tap96-quarantine-proof.mjs` |
| Downstream parado e interrupção abrupta da ponte | 10 lotes persistidos; 30 registros pesquisáveis após restart | `queue-recovered.json` |
| Fila artificial de 2 lotes | 2 aceitos; 5 recusados com HTTP 503; contadores enqueue/refused = 5 | `saturation.json` |
| ES realmente indisponível | 10 registros retidos e recuperados; todos com `event.ingested` | `es-outage-recovered.json` |

Os arquivos JSON da tabela ficam no mesmo diretório de evidências. Não representam
um backup nem uma restauração de dados de observabilidade compartilhados.

A dimensão `quiver.metric.name` contorna a colisão TSDB reproduzida no ES 8.17.0.
A [documentação primária do exporter](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.130.0/exporter/elasticsearchexporter/README.md#known-issues)
descreve a limitação do hash de nomes nessa versão do ES. A preferência do SDK é
delta, exigida para histogramas nesse exporter. Não houve reclassificação de séries
históricas ou desconhecidas para DEV/PROD.

`tap96-dev-bridge.yml` é uma ponte DEV temporária para o Collector já existente:
namespace diferente de `dev` é recusado pelo fence; métricas recebem a dimensão por
instrumento; fila própria de 100 requisições, body máximo de 2 MiB, retry, FS e
telemetria interna. Container: 256 MiB/1 CPU; memory limiter: 192 MiB. Isso não é
quota física de volume nem garantia de durabilidade no Collector compartilhado.

O candidato compartilhado não foi aplicado. Seu limite de container é 512 MiB e o
memory limiter, 384 MiB, acima dos 233,1 MiB observados no Collector atual. Antes
de uma janela futura, são necessários owner 10001:10001 no volume, pipeline ES
`quiver-observability-ingested`, capacidade/filas/alertas e plano de retorno.
ES compartilhado e Collector conservaram seus startedAt de 19/10 e restart count 0.

## Piloto de retenção já aplicado

Policy e template `quiver-tap-metrics-dev-45d`, exclusivamente para futuras gerações
de `metrics-generic.otel-dev`: rollover 7d/30 GB e delete 45d após rollover.
Priority 121, mesma composição do `metrics-otel@template` v7 e mesmos mappings.
Simulação e pós-verificação administrativa passaram. Os dois backings atuais
continuam na policy `metrics`, geração 2; nenhum rollover forçado ou associação
retroativa foi executado. PROD, infra e logs mantiveram suas policies anteriores.

Preflight: 610 primários ativos, 85 réplicas não alocadas, limite 1.000/node.
O piloto representa aproximadamente oito gerações futuras não vazias em 52 dias;
com uma réplica por índice, orçamento de até 16 cópias adicionais, sujeito a volume
e outros emissores. Não é garantia de capacidade global. A expiração real só pode
ser verificada após gerações naturais e passagem do prazo; ainda não foi observada.
Detalhes em `docs/evidence/tap96-dev-2026-10-21/retention-summary.json`.

## Publicação e prova oficial

Executar a partir desta branch, preservando o checkout principal:

```powershell
$env:QUIVER_DEV_PROJECT_ROOT = 'C:\Users\Papai\Documents\Desenvolvimento\Cervejaria'
$env:QUIVER_DEV_OTEL_ENDPOINT = 'http://127.0.0.1:14418'
.\scripts\observability\start-tap96-dev-bridge.ps1
$sha = git rev-parse HEAD
.\scripts\dev\prepare-dev-release.ps1 -ExpectedReleaseSha $sha
# Em processo elevado; FromSha deve ser relido imediatamente antes do swap.
.\scripts\dev\swap-dev-release.ps1 -FromSha $ativo -ToSha $sha
node --import ./scripts/node24-tsx-host.mjs --import ./backend/node_modules/tsx/dist/loader.mjs ./backend/scripts/tap96-official-dev-proof.mjs $env:QUIVER_DEV_PROJECT_ROOT $sha
```

O commit deve estar enviado, o CI verde e o atestado correspondente ao mesmo SHA.
A nova release deve conter o DEV pré-existente `11a794bd` e qualquer entrega mais
recente observada antes do swap. O script de prova cria duas empresas sintéticas
com senhas aleatórias, autentica, testa Pino/rollback, persiste comanda/pagamento,
valida isolamento e carrega o frontend compilado. Não imprime credenciais.

Após publicar, consultar os destinos compartilhados DEV por SHA, tenants e
correlation IDs; reconciliar os registros SQL e verificar canários ausentes,
rollback sem sucesso, logs técnicos, traces, métricas e zero documentos do SHA
nos destinos PROD. Não desligar a ponte enquanto o manifesto DEV a referenciar.

## Limites externos preservados

TAP-96 permanece In Progress até os gates operacionais obrigatórios. Nenhum
Collector/poller/ES compartilhado ou API PROD foi reiniciado. Permanecem externos:
rollout compartilhado de fila/quarentena/ingest clock/monitores; fonte segura e
ativação operacional do poller com controle de backlog; dois avisos Telegram pelo
fluxo existente e confirmação humana; evidência de acesso mínimo/rede; fronteira
Cloudflare específica para país. Geolocalização permanece desligada. Backup de
observabilidade segue adiado e não é gate desta entrega. Nenhum novo WI foi criado.
