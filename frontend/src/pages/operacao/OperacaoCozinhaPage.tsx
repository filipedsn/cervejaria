import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/Modal';
import { CozinhaPedidoCard } from '../../components/operacao/CozinhaPedidoCard';
import { IconBell, IconTv } from '../../components/NavIcons';
import { useAuth } from '../../contexts/AuthContext';
import { useOperacaoCozinha } from '../../hooks/useOperacaoCozinha';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { linkWhatsAppPedidoPronto, navegarParaWhatsApp } from '../../lib/whatsapp';
import { rotuloComanda, type PedidoCozinha } from '../../lib/operacao';

export function OperacaoCozinhaPage() {
  const [verEntregues, setVerEntregues] = useState(false);
  const [erroLocal, setErroLocal] = useState('');
  const [sucessoLocal, setSucessoLocal] = useState('');
  const [pedidoParaCancelar, setPedidoParaCancelar] = useState<PedidoCozinha | null>(null);
  const { isDono, cervejaria } = useAuth();
  const { contexto } = useOperacaoContexto();
  const avisoNaCozinha = contexto.whatsappPedidoProntoEnabled && contexto.whatsappPedidoProntoNaCozinha;

  const { naFila, entregues, alerta, mudarStatus, confirmarCancelamentoItem, isLoading, erroMutation, erroConfirmarCancelamentoItem } = useOperacaoCozinha();

  if (isLoading) return <Loading />;

  const lista = verEntregues ? entregues : naFila;
  const erro = erroLocal || erroMutation || erroConfirmarCancelamentoItem;

  const confirmarCancelamento = () => {
    if (!pedidoParaCancelar || mudarStatus.isPending) return;
    setErroLocal('');
    setSucessoLocal('');
    mudarStatus.mutate(
      { id: pedidoParaCancelar.id, status: 'CANCELAMENTO_PENDENTE' },
      {
        onSuccess: () => {
          setPedidoParaCancelar(null);
          setSucessoLocal('Cancelamento solicitado. O pedido permanecerá destacado até a confirmação da cozinha.');
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
          to="/operacao/cozinha/tv"
          className="icon-btn !h-11 !w-11 !min-h-11 !min-w-11 !p-0 rounded-xl bg-orange-600 text-white shadow-md shadow-orange-950/25 transition-colors hover:bg-orange-500"
          aria-label="Abrir modo TV (telão)"
          title="Abrir modo TV (telão)"
        >
          <IconTv className="w-5 h-5" />
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
          disabled={mudarStatus.isPending || confirmarCancelamentoItem.isPending}
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
          onConfirmarCancelamento={() => {
            setErroLocal('');
            setSucessoLocal('');
            mudarStatus.mutate(
              { id: pedido.id, status: 'CANCELADO' },
              {
                onSuccess: () => setSucessoLocal('Cancelamento confirmado e pedido removido da fila.'),
                onError: () => setErroLocal('Não foi possível confirmar o cancelamento.'),
              },
            );
          }}
          onConfirmarCancelamentoItem={(itemId) => {
            setErroLocal('');
            confirmarCancelamentoItem.mutate(
              { pedidoId: pedido.id, itemId },
              { onError: () => setErroLocal('Não foi possível confirmar o cancelamento do item.') },
            );
          }}
          onAvisarCliente={avisoNaCozinha ? () => {
            const cliente = pedido.comanda.cliente;
            if (!cliente?.telefone) return;
            const url = linkWhatsAppPedidoPronto({
              telefone: cliente.telefone,
              clienteNome: cliente.nome,
              numeroPedido: pedido.numero,
              nomeEmpresa: cervejaria?.nome ?? 'nossa empresa',
            });
            if (url) navegarParaWhatsApp(url);
          } : undefined}
        />
      ))}

      <Modal
        open={pedidoParaCancelar !== null}
        onClose={() => {
          if (!mudarStatus.isPending) setPedidoParaCancelar(null);
        }}
        closeOnBackdrop={!mudarStatus.isPending}
        title="Solicitar cancelamento do pedido"
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
              data-audit="operacao-cozinha-confirmar-cancelamento"
              onClick={confirmarCancelamento}
            >
              {mudarStatus.isPending ? 'Solicitando...' : 'Solicitar cancelamento'}
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
              O pedido será retirado do total e o estoque será ajustado. Ele continuará destacado na cozinha até alguém confirmar o cancelamento.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
