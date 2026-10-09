import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { CozinhaPedidoCard } from '../../components/operacao/CozinhaPedidoCard';
import { CozinhaTvGrid } from '../../components/operacao/CozinhaTvGrid';
import { CancelarQuantidadeModal } from '../../components/operacao/CancelarQuantidadeModal';
import { Modal } from '../../components/Modal';
import { IconBell } from '../../components/NavIcons';
import { useAuth } from '../../contexts/AuthContext';
import { useOperacaoCozinha } from '../../hooks/useOperacaoCozinha';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { useCozinhaDisplaySettings } from '../../hooks/useCozinhaDisplaySettings';
import { linkWhatsAppPedidoPronto, navegarParaWhatsApp } from '../../lib/whatsapp';
import type { PedidoCozinha } from '../../lib/operacao';
import { ApiError } from '../../lib/api';

type ConfirmacaoCancelamento =
  | { tipo: 'solicitar-pedido'; pedido: PedidoCozinha }
  | { tipo: 'confirmar-pedido'; pedido: PedidoCozinha }
  | { tipo: 'cancelar-item'; pedido: PedidoCozinha; itemId: string; nome: string };

export function OperacaoCozinhaTvPage() {
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [erroCancelamentoAcao, setErroCancelamentoAcao] = useState('');
  const [erroStatus, setErroStatus] = useState<{ pedidoId: string; numero: number; mensagem: string } | null>(null);
  const [erroItemCancelamento, setErroItemCancelamento] = useState<{ itemId: string; mensagem: string } | null>(null);
  const [avisoSincronizacao, setAvisoSincronizacao] = useState('');
  const confirmingItems = useRef(new Set<string>());
  const [confirmacaoCancelamento, setConfirmacaoCancelamento] = useState<ConfirmacaoCancelamento | null>(null);
  const [itemParaCancelar, setItemParaCancelar] = useState<{
    comandaId: string;
    itemId: string;
    nome: string;
    quantidade: number;
  } | null>(null);
  const { cervejaria, canPermission } = useAuth();
  const podeAvancarPreparo = canPermission('kitchen.operate');
  const podeCancelarPedido = canPermission('kitchen.cancel') && canPermission('sale.refund');
  const podeConfirmarCancelamento = canPermission('kitchen.cancel') && canPermission('sale.refund');
  const podeCancelarItem = canPermission('command.item.cancel');
  const { contexto } = useOperacaoContexto();
  const { settings: displaySettings } = useCozinhaDisplaySettings();
  const avisoNaCozinha = contexto.whatsappPedidoProntoEnabled && contexto.whatsappPedidoProntoNaCozinha;
  const {
    naFila,
    pedidosNaFila,
    itensNaFila,
    aguardando,
    pedidosEmPreparo,
    emPreparo,
    pedidosProntos,
    prontos,
    alerta,
    mudarStatusDoPedido,
    pedidosComStatusPendente,
    pedidoComStatusPendente,
    removerItem,
    confirmarCancelamentoItem,
    isLoading,
    erroItemMutation,
    refetch,
  } = useOperacaoCozinha();

  const itemComErro = naFila.flatMap((pedido) => pedido.itens).find((item) => item.id === erroItemCancelamento?.itemId);

  const solicitarMudancaStatus = async (pedido: PedidoCozinha, status: PedidoCozinha['status'], onSuccess?: () => void) => {
    if (pedidoComStatusPendente(pedido.id)) return false;
    setErroStatus(null);
    try {
      const aplicada = await mudarStatusDoPedido({ id: pedido.id, status, expectedStatus: pedido.status });
      if (!aplicada) return false;
      onSuccess?.();
      return true;
    } catch (error) {
      await refetch();
      setErroStatus({ pedidoId: pedido.id, numero: pedido.numero, mensagem: error instanceof Error ? error.message : 'Falha ao atualizar este pedido.' });
      return false;
    }
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

  const syncFullscreen = useCallback(() => {
    setIsNativeFullscreen(Boolean(document.fullscreenElement));
  }, []);

  const confirmarCancelamento = () => {
    if (!confirmacaoCancelamento) return;
    setErroCancelamentoAcao('');
    const confirmacao = confirmacaoCancelamento;
    if (confirmacao.tipo === 'cancelar-item') {
      if (pedidoComStatusPendente(confirmacao.pedido.id)) return;
      removerItem.mutate(
        { comandaId: confirmacao.pedido.comanda.id, itemId: confirmacao.itemId },
        {
          onSuccess: () => setConfirmacaoCancelamento(null),
          onError: (error) => setErroCancelamentoAcao(error instanceof Error ? error.message : 'Não foi possível cancelar o item.'),
        },
      );
      return;
    }
    const status = confirmacao.tipo === 'solicitar-pedido' ? 'CANCELAMENTO_PENDENTE' : 'CANCELADO';
    void solicitarMudancaStatus(confirmacao.pedido, status, () => setConfirmacaoCancelamento(null));
  };

  const pedidoDaConfirmacao = confirmacaoCancelamento?.tipo === 'cancelar-item' ? null : confirmacaoCancelamento?.pedido;
  const cancelamentoPendente = Boolean(pedidoDaConfirmacao && pedidosComStatusPendente.has(pedidoDaConfirmacao.id)) || removerItem.isPending;
  const interacaoPendente = pedidosComStatusPendente.size > 0 || removerItem.isPending || confirmarCancelamentoItem.isPending || Boolean(confirmacaoCancelamento) || Boolean(itemParaCancelar);

  useEffect(() => {
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, [syncFullscreen]);

  const toggleFullscreen = useCallback(() => {
    const root = document.querySelector('.qt-cozinha-tv');
    if (!root) return;

    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void root.requestFullscreen?.();
    }
  }, []);

  if (isLoading) return <Loading fullScreen />;

  return (
    <div className="cozinha-tv-shell">
      <header className="cozinha-tv-header">
        <div className="min-w-0">
          <p className="cozinha-tv-eyebrow">Cozinha</p>
          <h1 className="cozinha-tv-title">{cervejaria?.nome ?? 'Pedidos'}</h1>
        </div>

        <div className="cozinha-tv-header-meta">
          <div className="cozinha-tv-stat">
            <span className="cozinha-tv-stat-value">{pedidosNaFila} | {itensNaFila}</span>
            <span className="cozinha-tv-stat-label">na fila</span>
          </div>
          <div className="cozinha-tv-stat cozinha-tv-stat--preparo">
            <span className="cozinha-tv-stat-value">{pedidosEmPreparo} | {emPreparo}</span>
            <span className="cozinha-tv-stat-label">em preparo</span>
          </div>
          <div className="cozinha-tv-stat cozinha-tv-stat--pronto">
            <span className="cozinha-tv-stat-value">{pedidosProntos} | {prontos}</span>
            <span className="cozinha-tv-stat-label">prontos</span>
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isNativeFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            title={isNativeFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            className="cozinha-tv-fullscreen"
          >
            {isNativeFullscreen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m12-6h4a2 2 0 0 1 2 2v4M9 21H5a2 2 0 0 1-2-2v-4m12 6h4a2 2 0 0 0 2-2v-4" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 9V5a1 1 0 0 1 1-1h4m11 5V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4m11-5v4a1 1 0 0 1-1 1h-4" strokeLinecap="round" />
              </svg>
            )}
          </button>
          {aguardando > 0 && (
            <div className="cozinha-tv-stat cozinha-tv-stat--alert">
              <span className="cozinha-tv-stat-value">{aguardando}</span>
              <span className="cozinha-tv-stat-label">novos</span>
            </div>
          )}
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
            className={`cozinha-tv-bell ${
              !alerta.ativo
                ? 'cozinha-tv-bell-off'
                : alerta.precisaLiberar
                  ? 'cozinha-tv-bell-warn'
                  : 'cozinha-tv-bell-on'
            }`}
          >
            <IconBell className="w-7 h-7" strokeWidth={alerta.ativo ? 2.25 : 1.75} />
          </button>
          <Link to="/operacao/cozinha" className="cozinha-tv-link-operacional">
            Modo operacional
          </Link>
        </div>
      </header>

      {alerta.precisaLiberar && (
        <p className="cozinha-tv-hint">Toque na campainha para liberar o som.</p>
      )}

      {erroStatus && <div role="alert" aria-live="assertive" className="fixed right-4 top-4 z-[100] max-w-sm rounded-xl border border-red-500/40 bg-surface px-4 py-3 text-sm font-semibold text-red-600 shadow-xl">Falha no pedido {erroStatus.numero}: {erroStatus.mensagem}</div>}
      {erroItemCancelamento && <div role="alert" aria-live="assertive" className="fixed right-4 top-4 z-[100] max-w-sm rounded-xl border border-red-500/40 bg-surface px-4 py-3 text-sm font-semibold text-red-600 shadow-xl">Falha ao confirmar cancelamento de {itemComErro?.nome ?? 'item'}: {erroItemCancelamento.mensagem}</div>}
      {avisoSincronizacao && <div role="status" aria-live="polite" className="fixed right-4 top-4 z-[100] max-w-sm rounded-xl border border-emerald-500/40 bg-surface px-4 py-3 text-sm font-semibold text-emerald-600 shadow-xl">{avisoSincronizacao}</div>}

      {naFila.length === 0 ? (
        <div className="cozinha-tv-empty">
          <EmptyState icon="👨‍🍳" title="Nenhum pedido na cozinha" />
        </div>
      ) : (
        <CozinhaTvGrid
          paused={interacaoPendente}
          profile={displaySettings.profile}
        >
          {naFila.map((pedido, indice) => (
            <CozinhaPedidoCard
              key={pedido.id}
              pedido={pedido}
              indice={indice}
              variant="tv"
              disabled={pedidosComStatusPendente.has(pedido.id) || removerItem.isPending || confirmarCancelamentoItem.isPending}
              onAvancar={podeAvancarPreparo ? (status) => void solicitarMudancaStatus(pedido, status) : undefined}
              onVoltar={podeAvancarPreparo ? (status) => void solicitarMudancaStatus(pedido, status) : undefined}
              podeCancelar={podeCancelarPedido}
              onCancelar={() => {
                if (pedidoComStatusPendente(pedido.id)) return;
                setConfirmacaoCancelamento({ tipo: 'solicitar-pedido', pedido });
              }}
              onConfirmarCancelamento={podeConfirmarCancelamento ? () => {
                if (pedidoComStatusPendente(pedido.id)) return;
                setConfirmacaoCancelamento({ tipo: 'confirmar-pedido', pedido });
              } : undefined}
              onCancelarItem={pedido.comanda.tipo === 'AVULSA' || !podeCancelarItem ? undefined : (itemId) => {
                if (pedidoComStatusPendente(pedido.id)) return;
                const item = pedido.itens.find((linha) => linha.id === itemId);
                if (!item) return;
                if (item.quantidade > 1) {
                  removerItem.reset();
                  setItemParaCancelar({ comandaId: pedido.comanda.id, itemId, nome: item.nome, quantidade: item.quantidade });
                } else {
                  setConfirmacaoCancelamento({ tipo: 'cancelar-item', pedido, itemId, nome: item.nome });
                }
              }}
              onConfirmarCancelamentoItem={podeConfirmarCancelamento ? (itemId) => {
                if (pedidoComStatusPendente(pedido.id)) return;
                void confirmarCancelamentoDoItem(pedido.id, itemId);
              } : undefined}
              onAvisarCliente={avisoNaCozinha ? () => {
                if (pedidoComStatusPendente(pedido.id)) return;
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
        </CozinhaTvGrid>
      )}
      <CancelarQuantidadeModal
        open={itemParaCancelar !== null}
        nomeItem={itemParaCancelar?.nome ?? ''}
        quantidadeDisponivel={itemParaCancelar?.quantidade ?? 0}
        disabled={removerItem.isPending}
        erro={erroItemMutation}
        onClose={() => setItemParaCancelar(null)}
        onConfirmar={(quantidade) => {
          if (!itemParaCancelar) return;
          removerItem.mutate({ ...itemParaCancelar, quantidade }, {
            onSuccess: () => setItemParaCancelar(null),
          });
        }}
      />
      <Modal
        open={confirmacaoCancelamento !== null}
        title={confirmacaoCancelamento?.tipo === 'solicitar-pedido'
          ? 'Solicitar cancelamento'
          : confirmacaoCancelamento?.tipo === 'confirmar-pedido'
            ? 'Confirmar cancelamento'
            : 'Cancelar item'}
        onClose={() => {
          if (!cancelamentoPendente) setConfirmacaoCancelamento(null);
        }}
        closeOnBackdrop={!cancelamentoPendente}
        footer={(
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              className="touch-btn-orange w-full min-h-12"
              disabled={cancelamentoPendente}
              onClick={() => setConfirmacaoCancelamento(null)}
            >
              Voltar
            </button>
            <button
              type="button"
              className="touch-btn-danger w-full min-h-12"
              disabled={cancelamentoPendente}
              onClick={confirmarCancelamento}
            >
              {cancelamentoPendente ? 'Processando...' : 'Confirmar'}
            </button>
          </div>
        )}
      >
        {confirmacaoCancelamento?.tipo === 'solicitar-pedido' && (
          <div className="space-y-3 text-sm text-ink">
            <p>Solicitar o cancelamento do pedido {confirmacaoCancelamento.pedido.numero}?</p>
            <ul className="rounded-xl bg-surface-lighter p-3 space-y-1">
              {confirmacaoCancelamento.pedido.itens.map((item) => (
                <li key={item.id}>{item.quantidade}× {item.nome}</li>
              ))}
            </ul>
            <p className="text-ink-muted">O pedido ficará destacado na cozinha até a confirmação do cancelamento.</p>
            {confirmacaoCancelamento.pedido.comanda.tipo === 'AVULSA' && (
              <p className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-3 text-orange-700 dark:text-orange-300">
                O valor dos itens será estornado no caixa. Se o pagamento foi por PIX ou cartão, devolva o valor ao cliente no meio de pagamento.
              </p>
            )}
          </div>
        )}
        {confirmacaoCancelamento?.tipo === 'confirmar-pedido' && (
          <p className="text-sm text-ink">Confirmar o cancelamento do pedido {confirmacaoCancelamento.pedido.numero} e removê-lo da fila da cozinha?</p>
        )}
        {confirmacaoCancelamento?.tipo === 'cancelar-item' && (
          <p className="text-sm text-ink">Cancelar 1× {confirmacaoCancelamento.nome}?</p>
        )}
        {erroCancelamentoAcao && <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm font-semibold text-red-500">{erroCancelamentoAcao}</p>}
      </Modal>
    </div>
  );
}
