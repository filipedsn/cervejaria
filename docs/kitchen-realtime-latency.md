# Medição de sincronização visível da cozinha

## Escopo e método

QA focado em PostgreSQL descartável tmpfs, aplicação Fastify e Socket.IO reais, duas sessões independentes e tela TV executada em Chromium/Playwright. A sessão A alterou dados pelas rotas reais; a sessão B abriu `/operacao/cozinha/tv` e acompanhou o navegador. Nenhum banco DEV/PROD, pedido de cliente ou dado pessoal foi usado.

Viewport fixo: `1280×800` (Chromium headless). Para evitar o falso positivo do ensaio anterior, o harness consulta cartões somente por `.cozinha-tv-grid [data-kitchen-order-id]`. Cada cartão precisa ter bounding box não nulo, estilo visível e interseção positiva com o retângulo da grade. A cópia `.cozinha-tv-measure` nunca conta como prova. Para entrega/cancelamento, o harness registra o primeiro snapshot da grade em que o cartão desaparece.

Todos os marcos de evento Socket.IO, GET, parse de dados e DOM foram lidos com `performance.now()` da sessão B; não subtraí relógios de máquinas diferentes. O marco de ação é registrado imediatamente antes de despachar a chamada pela sessão A. Essa medida ação→evento inclui o custo de orquestração do Playwright entre contextos e deve ser lida como um limite superior aproximado, enquanto evento→GET→DOM usa o relógio do navegador que exibe a cozinha.

A sessão B manteve pedidos na página atual. O cenário cobriu criação de pedido para cozinha, inclusão de item, início do preparo, conclusão do preparo, entrega, solicitação e confirmação de cancelamento, além de queda/retomada do transporte e reentrada na sala do tenant. As operações ocorreram somente na base descartável.

## Amostras observadas

SHA da aplicação executada no ensaio registrado: `debc20f0e0c531ce467678560c9edd192c4768cc`; base integrada da entrega: `472f828d08c869668904991a4d43dcec09f39b98`. Um ensaio por ação no Chromium local; os números não são percentis de produção.

| Ação | Ação→evento (ms) | Evento→GET (ms) | GET→resposta (ms) | Resposta→dados (ms) | Dados→DOM/remoção (ms) | Total (ms) | GETs | Evidência visível |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Criação de pedido | 99,7 | 0,7 | 28,2 | 0,4 | 21,5 | 150,5 | 1 | Cartão e observação; caixa 303×220 px intersectando a grade. |
| Inclusão de item | 50,6 | 0,4 | 26,0 | 0,5 | 23,1 | 100,6 | 1 | Novo cartão da comanda, observação visível; caixa 303×220 px. |
| Início de preparo | 51,1 | 0,5 | 30,1 | 1,2 | 15,2 | 98,1 | 1 | Selo `PREPARANDO` no cartão alvo. |
| Conclusão do preparo | 41,9 | 0,2 | 24,2 | 0,4 | 21,8 | 88,5 | 1 | Selo `PRONTO` e ação `Entregue`. |
| Entrega | 43,7 | 0,5 | 24,1 | 1,6 | 16,0 | 85,9 | 1 | Cartão removido da grade visível. |
| Solicitação de cancelamento | 49,5 | 0,4 | 24,9 | 0,6 | 11,9 | 87,3 | 1 | Selo `CANCELAMENTO SOLICITADO` no cartão. |
| Confirmação de cancelamento | 43,9 | 0,4 | 24,6 | 0,2 | 11,9 | 81,0 | 1 | Cartão removido da grade visível. |

Reconexão: o navegador voltou à sala `cervejaria:<tenant-qa>:cozinha`, recebeu o evento de conexão, executou exatamente 1 refetch e manteve a página 1 válida. Na amostra: conexão→refetch parseado `30,1 ms`, dados→dois frames de pintura `34,6 ms`; recuperação total desde a interrupção medida no cliente `1.261,5 ms`, incluindo `1.196,8 ms` de retomada do transporte Socket.IO.

O ensaio separado do transporte repetiu 12 transições no socket real: 12/12 eventos entregues sem esperar o polling de 20 s. Request até resposta depois do commit/emissão: p50 `45,05 ms`, p95 `123,57 ms`. Emissão do servidor até recebimento no socket da cozinha: p50 `1,35 ms`, p95 `17,03 ms`. O evento chegou antes da resposta HTTP nas 12 amostras (p50 relativo `-0,79 ms`).

## Diagnóstico

A falha anterior era do harness: a consulta ampla de DOM encontrava a cópia oculta que a grade usa para medir os cartões e a tratava como cartão exibido. Ao limitar a prova à grade visível e exigir interseção geométrica, conteúdo atualizado ou remoção, a sincronização completa foi medida. Nesta amostra local não apareceu atraso em refetch, renderização ou reorganização que justifique uma alteração operacional; as ações comuns tiveram atualizações visíveis entre `81` e `151 ms`, com apenas uma consulta por evento. Não houve correção de lógica da aplicação nem aumento do polling.

Os números são uma amostra de QA local com um pedido-alvo por ação e Chromium headless. Não representam latência de rede Wi‑Fi, tablet físico, carga concorrente ou percentis de produção. A reconexão inclui o atraso configurado do Socket.IO e foi medida uma vez.

## Diagnóstico leve para tablet em DEV

Para observar uma sessão real sem tocar em pedidos e sem registrar conteúdo, execute este trecho no console remoto do navegador enquanto a cozinha estiver aberta. Ele anota apenas tempos, quantidade de cartões e dimensões da grade/cartões; não lê nomes, textos ou IDs. Use `relatorio()` ao fim e `parar()` para encerrar a observação.

```js
(() => {
  const grid = document.querySelector('.cozinha-tv-grid');
  if (!grid) throw new Error('Grade visível da cozinha não encontrada');
  const registros = [];
  const inicio = performance.now();
  const fetchOriginal = window.fetch;
  window.fetch = async (...args) => {
    const url = String(args[0] instanceof Request ? args[0].url : args[0]);
    const cozinha = url.includes('/api/operacao/cozinha');
    const t0 = performance.now();
    if (cozinha) registros.push({ tipo: 'GET início', ms: t0 - inicio });
    const response = await fetchOriginal(...args);
    if (cozinha) {
      const t1 = performance.now();
      registros.push({ tipo: 'GET resposta', ms: t1 - inicio, status: response.status });
      response.clone().json().then((dados) => registros.push({
        tipo: 'dados parseados', ms: performance.now() - inicio,
        pedidos: Array.isArray(dados) ? dados.length : null,
      }));
    }
    return response;
  };
  const observar = () => requestAnimationFrame(() => {
    const g = grid.getBoundingClientRect();
    const cartoes = [...grid.querySelectorAll('[data-kitchen-order-id]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { largura: Math.round(r.width), altura: Math.round(r.height), intersectaGrade: r.right > g.left && r.left < g.right && r.bottom > g.top && r.top < g.bottom };
    });
    registros.push({ tipo: 'grade pintada', ms: performance.now() - inicio, grade: { largura: Math.round(g.width), altura: Math.round(g.height) }, cartoes: cartoes.length, cartoesVisiveis: cartoes.filter((x) => x.intersectaGrade).length });
  });
  const observer = new MutationObserver(observar);
  observer.observe(grid, { subtree: true, childList: true, characterData: true, attributes: true });
  return {
    relatorio: () => registros.slice(),
    parar: () => { observer.disconnect(); window.fetch = fetchOriginal; },
  };
})()
```

Esse diagnóstico não intercepta o frame Socket.IO; para correlação detalhada em DEV, use o painel Network/WS do DevTools e compare o horário do frame com os registros do console. Não use o ensaio com pedidos reais para forçar alterações de status.

Reprodução automatizada: `node backend/scripts/run-kitchen-realtime-latency-disposable-qa.mjs`. O runner cria o PostgreSQL temporário em tmpfs e o remove ao terminar.


