import { useMemo } from 'react';
import { CozinhaPedidoCard } from '../../components/operacao/CozinhaPedidoCard';
import { CozinhaTvGrid } from '../../components/operacao/CozinhaTvGrid';
import type { PedidoCozinha, StatusPedido, TipoComanda } from '../../lib/operacao';

const DEMO_COUNT = 30;
const fixedNow = new Date().toISOString();

const PRODUTOS = [
  'Burger artesanal',
  'Porção de fritas',
  'Coxinha de frango',
  'Pastel de queijo',
  'Escondidinho de carne seca',
  'Isca de peixe',
  'Batata rústica',
  'Costela BBQ',
  'Onion rings',
  'Hot dog da casa',
  'Nachos com cheddar',
  'Picanha na chapa',
];

const OBSERVACOES = [
  'Sem cebola, por favor.',
  'Molho à parte.',
  'Bem passado.',
  'Sem pimenta.',
  null,
  null,
  'Entregar na bancada azul.',
  null,
];

const STATUS_CICLO: StatusPedido[] = ['RECEBIDO', 'EM_PREPARO', 'PRONTO', 'EM_PREPARO', 'RECEBIDO'];
const TIPOS: TipoComanda[] = ['MESA', 'FICHA', 'APELIDO', 'MESA'];

const TABLET_ITEM_COUNTS = [1, 2, 4, 3] as const;

function buildDemoPedidos(count: number, tabletFixture = false): PedidoCozinha[] {
  return Array.from({ length: count }, (_, index) => {
    const numero = 100 + index;
    const status = tabletFixture ? (index === 1 ? 'EM_PREPARO' : 'RECEBIDO') : STATUS_CICLO[index % STATUS_CICLO.length]!;
    const tipo = TIPOS[index % TIPOS.length]!;
    const itemCount = tabletFixture ? TABLET_ITEM_COUNTS[index % TABLET_ITEM_COUNTS.length]! : (index % 4) + 1;
    const minutosAtras = count - index;
    const createdAt = new Date(Date.parse(fixedNow) - minutosAtras * 60_000).toISOString();
    const statusDesde = new Date(Date.parse(createdAt) + 90_000).toISOString();
    const identificador =
      tipo === 'MESA' ? String((index % 20) + 1)
        : tipo === 'FICHA' ? String(200 + index)
          : ['Marina', 'João', 'Ana', 'Pedro', 'Lucia'][index % 5]!;

    return {
      id: `demo-${index + 1}`,
      numero,
      status,
      observacao: tabletFixture && index === 2 ? 'Sem cebola. Molho à parte. Preparar os acompanhamentos juntos.' : OBSERVACOES[index % OBSERVACOES.length] ?? null,
      createdAt,
      statusDesde,
      entregueEm: null,
      comanda: {
        id: `comanda-demo-${index + 1}`,
        tipo,
        identificador,
        numero: tipo === 'FICHA' ? 200 + index : undefined,
      },
      itens: Array.from({ length: itemCount }, (_, itemIndex) => ({
        id: `item-demo-${index + 1}-${itemIndex + 1}`,
        nome: PRODUTOS[(index + itemIndex) % PRODUTOS.length]!,
        quantidade: (itemIndex % 3) + 1,
        precoUnit: 12 + ((index + itemIndex) % 8) * 3,
        observacao: itemIndex === 0 && index % 5 === 0 ? 'Observação do item: sem molho.' : null,
        opcionais: itemIndex === 0 && (tabletFixture || index % 3 === 0)
          ? [{ id: `opt-${index + 1}`, nome: 'Queijo extra', precoAdicional: 4, quantidade: 1 }]
          : undefined,
        paraViagem: index % 7 === 0 && itemIndex === 0,
      })),
    };
  });
}

export function OperacaoCozinhaTvDemoPage({
  tabletFixture = false,
  pedidoCount,
}: {
  tabletFixture?: boolean;
  /** Override da quantidade de pedidos fictícios (ex.: ?pedidos=1 para validar slot no PC). */
  pedidoCount?: number;
}) {
  const count = Math.max(1, Math.min(DEMO_COUNT, pedidoCount ?? (tabletFixture ? 4 : DEMO_COUNT)));
  const pedidos = useMemo(() => buildDemoPedidos(count, tabletFixture), [count, tabletFixture]);
  const naFila = pedidos.filter((p) => p.status === 'RECEBIDO');
  const emPreparo = pedidos.filter((p) => p.status === 'EM_PREPARO');
  const prontos = pedidos.filter((p) => p.status === 'PRONTO');
  const itensNaFila = naFila.reduce((n, p) => n + p.itens.reduce((s, i) => s + i.quantidade, 0), 0);
  const itensPreparo = emPreparo.reduce((n, p) => n + p.itens.reduce((s, i) => s + i.quantidade, 0), 0);
  const itensProntos = prontos.reduce((n, p) => n + p.itens.reduce((s, i) => s + i.quantidade, 0), 0);

  return (
    <div className="cozinha-tv-shell" aria-label="Simulação da tela de cozinha">
      <header className="cozinha-tv-header">
        <div>
          <p className="cozinha-tv-eyebrow">Cozinha · Simulação</p>
          <h1 className="cozinha-tv-title">Tap Quiver Eventos</h1>
        </div>
        <div className="cozinha-tv-header-meta">
          <div className="cozinha-tv-stat">
            <span className="cozinha-tv-stat-value">{naFila.length} | {itensNaFila}</span>
            <span className="cozinha-tv-stat-label">na fila</span>
          </div>
          <div className="cozinha-tv-stat cozinha-tv-stat--preparo">
            <span className="cozinha-tv-stat-value">{emPreparo.length} | {itensPreparo}</span>
            <span className="cozinha-tv-stat-label">em preparo</span>
          </div>
          <div className="cozinha-tv-stat cozinha-tv-stat--pronto">
            <span className="cozinha-tv-stat-value">{prontos.length} | {itensProntos}</span>
            <span className="cozinha-tv-stat-label">prontos</span>
          </div>
          <div className="cozinha-tv-stat cozinha-tv-stat--alert">
            <span className="cozinha-tv-stat-value">{naFila.length}</span>
            <span className="cozinha-tv-stat-label">novos</span>
          </div>
          <span className="cozinha-tv-demo-badge">{pedidos.length} pedidos fictícios{tabletFixture ? ' · tablet' : ''}</span>
        </div>
      </header>
      <CozinhaTvGrid countLabel="na simulação" forceTabletLayout={tabletFixture}>
        {pedidos.map((pedido, indice) => (
          <CozinhaPedidoCard
            key={pedido.id}
            pedido={pedido}
            indice={indice}
            variant="tv"
            disabled
            onAvancar={() => undefined}
            onVoltar={() => undefined}
          />
        ))}
      </CozinhaTvGrid>
    </div>
  );
}
