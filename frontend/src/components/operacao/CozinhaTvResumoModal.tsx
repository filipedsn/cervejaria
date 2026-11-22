import { Modal } from '../Modal';
import {
  agruparPedidosCozinhaPorStatus,
  type PedidoCozinha,
  type StatusPedido,
} from '../../lib/operacao';

const CLASSE_SECAO: Partial<Record<StatusPedido, string>> = {
  RECEBIDO: 'cozinha-tv-resumo-secao--fila',
  EM_PREPARO: 'cozinha-tv-resumo-secao--preparo',
  PRONTO: 'cozinha-tv-resumo-secao--pronto',
  CANCELAMENTO_PENDENTE: 'cozinha-tv-resumo-secao--cancelamento',
};

interface Props {
  open: boolean;
  onClose: () => void;
  pedidos: PedidoCozinha[];
}

export function CozinhaTvResumoModal({ open, onClose, pedidos }: Props) {
  const secoes = agruparPedidosCozinhaPorStatus(pedidos);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Resumo da fila"
      wide
      footer={(
        <button type="button" className="touch-btn-orange w-full min-h-12" onClick={onClose}>
          Fechar
        </button>
      )}
    >
      {secoes.length === 0 ? (
        <p className="cozinha-tv-resumo-vazio">Nenhum pedido na fila.</p>
      ) : (
        <div className="cozinha-tv-resumo">
          {secoes.map((secao) => (
            <section
              key={secao.status}
              className={`cozinha-tv-resumo-secao ${CLASSE_SECAO[secao.status] ?? ''}`}
            >
              <header className="cozinha-tv-resumo-secao-header">
                <h3 className="cozinha-tv-resumo-secao-title">{secao.label}</h3>
                <span className="cozinha-tv-resumo-secao-count">
                  {secao.totalItens} {secao.totalItens === 1 ? 'item' : 'itens'}
                </span>
              </header>
              <ul className="cozinha-tv-resumo-itens">
                {secao.produtos.map((produto) => (
                  <li key={produto.nome}>
                    {produto.quantidade}× {produto.nome}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
