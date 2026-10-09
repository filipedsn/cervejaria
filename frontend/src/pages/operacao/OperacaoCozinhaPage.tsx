import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/Modal';
import { CozinhaPedidoCard } from '../../components/operacao/CozinhaPedidoCard';
import { CozinhaTvGrid } from '../../components/operacao/CozinhaTvGrid';
import { IconBell, IconTv } from '../../components/NavIcons';
import { useAuth } from '../../contexts/AuthContext';
import { useOperacaoCozinha } from '../../hooks/useOperacaoCozinha';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { linkWhatsAppPedidoPronto, navegarParaWhatsApp } from '../../lib/whatsapp';
import { rotuloComanda, type PedidoCozinha } from '../../lib/operacao';
import { ApiError } from '../../lib/api';

export function OperacaoCozinhaPage() {
  const [verEntregues, setVerEntregues] = useState(false);
  const [erroLocal, setErroLocal] = useState('');
  const [erroPedidoCancelamento, setErroPedidoCancelamento] = useState<{ pedidoId: string; mensagem: string } | null>(null);
  const [erroItemCancelamento, setErroItemCancelamento] = useState<{ itemId: string; mensagem: string } | null>(null);
  const [avisoSincronizacao, setAvisoSincronizacao] = useState('');
  const [pedidoParaCancelar, setPedidoParaCancelar] = useState<PedidoCozinha | null>(null);
  const confirmingItems = useRef(new Set<string>());
  const { cervejaria, canPermission } = useAuth();
  const podeAvancarPreparo = canPermission('kitchen.operate');
  const podeCancelarPedido = canPermission('kitchen.cancel') && canPermission('sale.refund');
  const podeConfirmarCancelamento = canPermission('kitchen.cancel') && canPermission('sale.refund');
  const { contexto } = useOperacaoContexto();
  const avisoNaCozinha = contexto.whatsappPedidoProntoEnabled && contexto.whatsappPedidoProntoNaCozinha;

  const { naFila, entregues, alerta, mudarStatus, confirmarCancelamentoItem, isLoading, erroMutation, refetch } = useOperacaoCozinha();

  if (isLoading) return <Loading />;

  const lista = verEntregues ? entregues : naFila;
  const cancelamentoStatus = mudarStatus.variables?.status === 'CANCELAMENTO_PENDENTE' || mudarStatus.variables?.status === 'CANCELADO';
  const erro = erroLocal || (!cancelamentoStatus ? erroMutation : null);
  const itemComErro = naFila.flatMap((pedido) => pedido.itens).find((item) => item.id === erroItemCancelamento?.itemId);
  const pedidoComErro = naFila.find((pedido) => pedido.id === erroPedidoCancelamento?.pedidoId);

  const confirmarCancelamento = () => {
    if (!pedidoParaCancelar || mudarStatus.isPending) return;
    setErroPedidoCancelamento(null);
    mudarStatus.mutate(
      { id: pedidoParaCancelar.id, status: 'CANCELAMENTO_PENDENTE' },
      {
        onSuccess: () => setPedidoParaCancelar(null),
        onError: (error) => setErroPedidoCancelamento({ pedidoId: pedidoParaCancelar.id, mensagem: error instanceof Error ? error.message : 'Não foi possível solicitar o cancelamento.' }),
      },
    );
  };

  const confirmarCancelamentoDoItem = async (pedidoId: string, itemId: string) => {
    if (confirmingItems.current.has(itemId)) return;
    confirmingItems.current.add(itemId);
    setErroItemCancelamento(null);
    setAvisoSincronizacao('');
    try {
      await confirmarCancelamentoItem.mutateAsync({ pedidoId, itemId });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.message === 'Este item não possui cancelamento pendente') {
        const atualizado = await refetch();
        const item = atualizado.data?.find((pedido) => pedido.id === pedidoId)?.itens.find((linha) => linha.id === itemId);
        if (!item?.cancelamentoPendente) {
          setAvisoSincronizacao('O cancelamento já foi confirmado em outra sessão. A fila foi sincronizada.');
          return;
        }
      }
      setErroItemCancelamento({ itemId, mensagem: error instanceof Error ? error.message : 'Não foi possível confirmar o cancelamento.' });
    } finally {
      confirmingItems.current.delete(itemId);
    }
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
      {erroPedidoCancelamento && pedidoParaCancelar?.id !== erroPedidoCancelamento.pedidoId && <div role="alert" aria-live="assertive" className="fixed right-4 top-4 z-[100] max-w-sm rounded-xl border border-red-500/40 bg-surface px-4 py-3 text-sm font-semibold text-red-600 shadow-xl">Falha ao cancelar o pedido {pedidoComErro?.numero ?? ''}: {erroPedidoCancelamento.mensagem}</div>}
      {erroItemCancelamento && <div role="alert" aria-live="assertive" className="fixed right-4 top-4 z-[100] max-w-sm rounded-xl border border-red-500/40 bg-surface px-4 py-3 text-sm font-semibold text-red-600 shadow-xl">Falha ao confirmar cancelamento de {itemComErro?.nome ?? 'item'}: {erroItemCancelamento.mensagem}</div>}
      {avisoSincronizacao && <div role="status" aria-live="polite" className="fixed right-4 top-4 z-[100] max-w-sm rounded-xl border border-emerald-500/40 bg-surface px-4 py-3 text-sm font-semibold text-emerald-600 shadow-xl">{avisoSincronizacao}</div>}
      {!podeAvancarPreparo && <p className="rounded-lg border border-line bg-surface-lighter px-3 py-2 text-sm text-ink-muted">Você pode consultar a fila, mas precisa da permissão “Avançar preparo e entrega” para alterar pedidos.</p>}

      {lista.length === 0 && (
        <EmptyState
          icon="👨‍🍳"
          title={verEntregues ? 'Nada entregue hoje ainda' : 'Nenhum pedido na cozinha'}
        />
      )}

      {lista.length > 0 && <CozinhaTvGrid operational countLabel={verEntregues ? 'no filtro: entregues hoje' : 'no filtro: na fila'} paused={mudarStatus.isPending || confirmarCancelamentoItem.isPending || Boolean(pedidoParaCancelar)}>
      {lista.map((pedido, indice) => (
        <CozinhaPedidoCard
          key={pedido.id}
          pedido={pedido}
          indice={indice}
          mostrarFila={!verEntregues}
          disabled={mudarStatus.isPending || confirmarCancelamentoItem.isPending}
          onAvancar={podeAvancarPreparo ? (status) => {
            setErroLocal('');
            setErroPedidoCancelamento(null);
            mudarStatus.mutate(
              { id: pedido.id, status },
              { onError: () => setErroLocal('Não foi possível atualizar o pedido') },
            );
          } : undefined}
          onVoltar={podeAvancarPreparo ? (status) => {
            setErroLocal('');
            setErroPedidoCancelamento(null);
            mudarStatus.mutate(
              { id: pedido.id, status },
              { onError: () => setErroLocal('Não foi possível atualizar o pedido') },
            );
          } : undefined}
          podeCancelar={podeCancelarPedido}
          onCancelar={() => {
            setErroLocal('');
            setErroPedidoCancelamento(null);
            setPedidoParaCancelar(pedido);
          }}
          onConfirmarCancelamento={podeCancelarPedido ? () => {
            setErroLocal('');
            setErroPedidoCancelamento(null);
            mudarStatus.mutate(
              { id: pedido.id, status: 'CANCELADO' },
              {
                onError: (error) => setErroPedidoCancelamento({ pedidoId: pedido.id, mensagem: error instanceof Error ? error.message : 'Não foi possível confirmar o cancelamento.' }),
              },
            );
          } : undefined}
          onConfirmarCancelamentoItem={podeConfirmarCancelamento ? (itemId) => {
            setErroLocal('');
            void confirmarCancelamentoDoItem(pedido.id, itemId);
          } : undefined}
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
      </CozinhaTvGrid>}

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
            {erroPedidoCancelamento?.pedidoId === pedidoParaCancelar.id && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm font-semibold text-red-500">{erroPedidoCancelamento.mensagem}</p>}
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
            {pedidoParaCancelar.comanda.tipo === 'AVULSA' && (
              <p className="text-sm text-orange-500">
                A venda avulsa já foi paga: o valor cancelado será estornado no caixa. Se o pagamento foi por PIX ou cartão, devolva o valor ao cliente também no meio de pagamento.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
