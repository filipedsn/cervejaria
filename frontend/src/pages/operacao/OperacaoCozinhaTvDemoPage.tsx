import { CozinhaPedidoCard } from '../../components/quiosque/CozinhaPedidoCard';
import type { PedidoCozinha } from '../../lib/quiosque';

const fixedNow = '2026-09-24T21:00:00.000Z';
const pedidos: PedidoCozinha[] = [
  { id: 'demo-1', numero: 42, status: 'RECEBIDO', observacao: 'Sem cebola, por favor.', createdAt: '2026-09-24T20:53:00.000Z', statusDesde: '2026-09-24T20:53:00.000Z', entregueEm: fixedNow, comanda: { id: 'comanda-1', tipo: 'MESA', identificador: '12' }, itens: [{ id: 'item-1', nome: 'Burger artesanal', quantidade: 2, precoUnit: 28 }] },
  { id: 'demo-2', numero: 43, status: 'EM_PREPARO', observacao: null, createdAt: '2026-09-24T20:48:00.000Z', statusDesde: '2026-09-24T20:54:00.000Z', entregueEm: fixedNow, comanda: { id: 'comanda-2', tipo: 'FICHA', identificador: '108' }, itens: [{ id: 'item-2', nome: 'Porção de fritas', quantidade: 1, precoUnit: 24 }, { id: 'item-3', nome: 'Coxinha de frango', quantidade: 2, precoUnit: 9 }] },
  { id: 'demo-3', numero: 44, status: 'PRONTO', observacao: 'Molho à parte.', createdAt: '2026-09-24T20:43:00.000Z', statusDesde: '2026-09-24T20:57:00.000Z', entregueEm: fixedNow, comanda: { id: 'comanda-3', tipo: 'APELIDO', identificador: 'Marina' }, itens: [{ id: 'item-4', nome: 'Pastel de queijo', quantidade: 3, precoUnit: 10 }] },
  { id: 'demo-4', numero: 45, status: 'EM_PREPARO', observacao: null, createdAt: '2026-09-24T20:50:00.000Z', statusDesde: '2026-09-24T20:56:00.000Z', entregueEm: fixedNow, comanda: { id: 'comanda-4', tipo: 'MESA', identificador: '7' }, itens: [{ id: 'item-5', nome: 'Escondidinho de carne seca', quantidade: 1, precoUnit: 32 }] },
];

export function QuiosqueCozinhaTvDemoPage() {
  return <div className="cozinha-tv-shell" aria-label="Simulação da tela de cozinha">
    <header className="cozinha-tv-header">
      <div><p className="cozinha-tv-eyebrow">Cozinha · Simulação</p><h1 className="cozinha-tv-title">Tap Quiver Eventos</h1></div>
      <div className="cozinha-tv-header-meta">
        <div className="cozinha-tv-stat"><span className="cozinha-tv-stat-value">{pedidos.length}</span><span className="cozinha-tv-stat-label">na fila</span></div>
        <div className="cozinha-tv-stat cozinha-tv-stat--alert"><span className="cozinha-tv-stat-value">1</span><span className="cozinha-tv-stat-label">novo</span></div>
        <span className="cozinha-tv-demo-badge">Dados fictícios</span>
      </div>
    </header>
    <div className="cozinha-tv-grid">{pedidos.map((pedido, indice) => <CozinhaPedidoCard key={pedido.id} pedido={pedido} indice={indice} variant="tv" disabled onAvancar={() => undefined} onVoltar={() => undefined} />)}</div>
  </div>;
}
