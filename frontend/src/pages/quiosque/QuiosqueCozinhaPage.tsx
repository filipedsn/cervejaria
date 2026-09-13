import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/Modal';
import { CozinhaPedidoCard } from '../../components/quiosque/CozinhaPedidoCard';
import { IconBell } from '../../components/NavIcons';
import { useAuth } from '../../contexts/AuthContext';
import { useQuiosqueCozinha } from '../../hooks/useQuiosqueCozinha';
import { rotuloComanda, type PedidoCozinha } from '../../lib/quiosque';

export function QuiosqueCozinhaPage() {
  const [verEntregues, setVerEntregues] = useState(false);
  const [erroLocal, setErroLocal] = useState('');
  const [sucessoLocal, setSucessoLocal] = useState('');
  const [pedidoParaCancelar, setPedidoParaCancelar] = useState<PedidoCozinha | null>(null);
  const { isDono } = useAuth();

  const { naFila, entregues, alerta, mudarStatus, isLoading, erroMutation } = useQuiosqueCozinha();

  if (isLoading) return <Loading />;

  const lista = verEntregues ? entregues : naFila;
  const erro = erroLocal || erroMutation;

  const confirmarCancelamento = () => {
    if (!pedidoParaCancelar || mudarStatus.isPending) return;
    setErroLocal('');
    setSucessoLocal('');
    mudarStatus.mutate(
      { id: pedidoParaCancelar.id, status: 'CANCELADO' },
      {
        onSuccess: () => {
          setPedidoParaCancelar(null);
          setSucessoLocal('Pedido cancelado e removido da fila.');
        },
        onError: (error) => {
          setErroLocal(error instanceof Error ? error.message : 'Não foi possível cancelar o pedido');
        },
      },
    );
  };

  return (
    <div className="space-y-3 pb-2">
      <div className="flex items-center gap-2">
        <nav className="segmented-control flex-1" aria-label="Filtro da cozinha">
          <button
            type="button"
            onClick={() => setVerEntregues(false)}
            className={`segmented-control-btn ${!verEntregues ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
          >
            Na fila{naFila.length > 0 ? ` (${naFila.length})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setVerEntregues(true)}
            className={`segmented-control-btn ${verEntregues ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
          >
            Entregues hoje
          </button>
        </nav>
        <Link
          to="/quiosque/cozinha/tv"
          className="touch-btn-secondary touch-btn-sm shrink-0 hidden sm:inline-flex"
        >
          Modo TV
        </Link>
        <button
          type="button"
          onClick={() => void alerta.alternar()}
          aria-pressed={alerta.ativo}
          aria-label={
            !alerta.ativo
              ? 'Ativar som de novos pedidos'
              : alerta.precisaLiberar
                ? 'Liberar som de novos pedidos'
                : 'Desativar som de novos pedidos'
          }
          className={`icon-btn ${
            !alerta.ativo
              ? 'bg-surface border border-line text-ink-muted'
              : alerta.precisaLiberar
                ? 'alert-warn-btn'
                : 'alert-active-btn'
          }`}
        >
          <IconBell className="w-6 h-6" strokeWidth={alerta.ativo ? 2.25 : 1.75} />
        </button>
      </div>

      <Link to="/quiosque/cozinha/tv" className="touch-btn-secondary touch-btn-sm w-full sm:hidden">
        Abrir modo TV (telão)
      </Link>

      {alerta.precisaLiberar && (
        <p className="text-xs text-ink-muted">
          Toque na campainha para liberar o som depois que a tela dormiu.
        </p>
      )}

      {erro && <div className="alert-error">{erro}</div>}
      {sucessoLocal && <div className="alert-success">{sucessoLocal}</div>}

      {lista.length === 0 && (
        <EmptyState
          icon="👨‍🍳"
          title={verEntregues ? 'Nada entregue hoje ainda' : 'Nenhum pedido na cozinha'}
        />
      )}

      {lista.map((pedido, indice) => (
        <CozinhaPedidoCard
          key={pedido.id}
          pedido={pedido}
          indice={indice}
          mostrarFila={!verEntregues}
          disabled={mudarStatus.isPending}
          onAvancar={(status) => {
            setErroLocal('');
            setSucessoLocal('');
            mudarStatus.mutate(
              { id: pedido.id, status },
              { onError: () => setErroLocal('Não foi possível atualizar o pedido') },
            );
          }}
          onVoltar={(status) => {
            setErroLocal('');
            setSucessoLocal('');
            mudarStatus.mutate(
              { id: pedido.id, status },
              { onError: () => setErroLocal('Não foi possível atualizar o pedido') },
            );
          }}
          podeCancelar={isDono}
          onCancelar={() => {
            setErroLocal('');
            setSucessoLocal('');
            setPedidoParaCancelar(pedido);
          }}
        />
      ))}

      <Modal
        open={pedidoParaCancelar !== null}
        onClose={() => {
          if (!mudarStatus.isPending) setPedidoParaCancelar(null);
        }}
        closeOnBackdrop={!mudarStatus.isPending}
        title="Cancelar pedido da cozinha"
        footer={
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              className="touch-btn-orange w-full min-h-14"
              disabled={mudarStatus.isPending}
              onClick={() => setPedidoParaCancelar(null)}
            >
              Voltar
            </button>
            <button
              type="button"
              className="touch-btn-danger w-full min-h-14"
              disabled={mudarStatus.isPending}
              data-audit="quiosque-cozinha-confirmar-cancelamento"
              onClick={confirmarCancelamento}
            >
              {mudarStatus.isPending ? 'Cancelando...' : 'Cancelar pedido'}
            </button>
          </div>
        }
      >
        {pedidoParaCancelar && (
          <div className="space-y-3">
            <p>
              Você está cancelando o pedido da {rotuloComanda(pedidoParaCancelar.comanda)} (senha{' '}
              {pedidoParaCancelar.numero}), atualmente em{' '}
              {pedidoParaCancelar.status === 'RECEBIDO' ? 'fila' : 'preparo'}.
            </p>
            <ul className="rounded-xl bg-surface-lighter p-3 text-sm space-y-1">
              {pedidoParaCancelar.itens.map((item) => (
                <li key={item.id}>
                  {item.quantidade}× {item.nome}
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink-muted">
              Os itens cancelados deixam de compor o total da comanda aberta e o pedido sai da fila.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
