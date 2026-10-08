# Matriz de reconciliação — PDV único CIA Marítima + Churrasquinho

Fotografia de origem aprovada: SHA-256 `2071d444df091fe85438278ca1e6d2329d4e2106679b23143f0e863b8769d16b`, 34 tabelas, 10.738 linhas, zero arestas cross-tenant. Execução final em 2026-10-08, código `9e86dc9daf6162fa8d5f92b10dd7911457157d13`, PostgreSQL QA descartável. Os estados `PASS` abaixo certificam a transformação dos dados restaurados; os limites pós-migração estão escritos como pendência, não inferidos.

| Domínio | Comparação exigida | Resultado do ensaio | Próximo gate / limite |
|---|---|---|---|
| Tenant, PDV, Trailer, agenda e ocorrência | ID, vínculo, estado, data e origem | PASS; CIA: 0 PDVs + 1 Trailer, 4 agendas/23 ocorrências; Churrasquinho: PDV existente preservado, 1 agenda/2 ocorrências | Não decidir unidades de outros tenants |
| Produtos, formato/volume, preços e cardápios | ID, unidade, preço e relação/override | PASS no catálogo; replay por escopo | Smoke autenticado pós-migração nos dois tenants pendente |
| Sessões e movimentos de caixa | ID, estado, PDV, valores e sessão | PASS; pausa/retomada/replay e dependências confirmadas | Fluxo de abrir/fechar autenticado na fotografia pendente |
| Pagamentos e recebimentos | ID e centavos; forma/origem; sessão explícita; sem duplicidade | PASS nos 605 pagamentos | Sem autorização para inferir sessão ausente por data/valor |
| Pagamentos classe A | 26 IDs e links de sessão | PASS; links exatos mantidos | — |
| Recebíveis classe B | 2 pagamentos, ID de recebível, principal/recibos/saldo | PASS; 5.200 centavos, identidade mantida e saldo reconciliado | — |
| Pagamentos classe C | 577 IDs aprovados, campos financeiros/contexto, duas FKs de sessão nulas e proveniência | PASS; 3.470.900 centavos; `CAIXA_NAO_COMPROVADA`; autorização antiga de 577 entradas e digest preservados | Não expandir/regerar autorização para novos registros |
| Comandas e itens | ID, tenant/PDV/ocorrência, estado, desconto/total, autor, timestamps, produto/volume/quantidade/preço e snapshots | PASS pela transformação comercial, recibos e replay | Operação autenticada sobre os tenants migrados pendente |
| Opcionais e snapshots | ID, vínculo, preço e conteúdo histórico | PASS pela transformação comercial e replay | — |
| Cozinha e histórico | ID de pedido/item, estado, histórico e relação | PASS; Churrasquinho preparou 431 registros; replay pós-comércio passou | Pedido independente e demais três decisões de ranking/consumo continuam sob decisão; não alterar nesta rodada |
| Estoque e ledger | Produto/PDV/unidade, saldo, movimentos e hash | PASS no escopo de migração/replay | Teste de operação de estoque autenticado na fotografia pendente |
| TAPs e montagens | ID, produto, número, data/estado, referências e conteúdo | PASS; 9 TAPs e 123 montagens; CIA 5/123, Churrasquinho 4/0 | Operação autenticada de montagem pendente |
| Clientes | ID e relações de histórico | PASS na transformação/replay comercial | API/portal autenticados sobre dados migrados pendentes |
| Auditoria (`TransacaoLog`) | IDs, relações e conteúdo preservados; confirmar dependências | Restore igual por valor escalar antes das transformações; nenhum migrador tem escritor desse modelo | Comparação rowwise pós-transformação não executada; acrescentar assert exata antes do corte |
| Estatísticas (`ClienteEstatisticas`) | IDs, chaves de cliente e contadores | Restore igual por valor escalar antes das transformações; nenhum migrador tem escritor desse modelo | Comparação rowwise pós-transformação não executada; acrescentar assert exata antes do corte |
| Permissões anteriores e novas concessões | Usuários/tenant, grants antes/depois, tentativas e revogação | Suíte sintética de permissões passou | Não houve comparação dos grants da fotografia nem revogação pós-migração; validar em ambos os tenants |
| Ranking histórico de Chope | Leitura por tenant, período e produto; comparar ordenação/valores ao legado | Não lido na fotografia restaurada | Fazer somente leitura dos rankings legados nos dois tenants; não definir métrica/reconhecimento retroativo |

## Resumo por tenant

| Tenant | Transformações | Contagem de comércio | TAPs / montagens | Resultado |
|---|---|---:|---:|---|
| CIA Marítima | negócio, catálogo, TAPs, sessões, financeiro, preparação/cozinha, comércio, replay financeiro e de cozinha | 1.549 em 62 lotes | 5 / 123 | PASS nas transformações |
| Churrasquinho do Thiago | mesmas fases; preserva PDV existente | 3.004 em 121 lotes; 431 preparações de cozinha | 4 / 0 | PASS nas transformações |

O resultado completo com tempos, status de retomada/replay e hash do snapshot está em [`pdv-unico-integrated-representative-evidence.json`](pdv-unico-integrated-representative-evidence.json). `PROD_ACCESS_USED=NO`; `DEV_SHARED_ACCESS=NO`. A aprovação das transformações não é aprovação do corte ou de PROD.
