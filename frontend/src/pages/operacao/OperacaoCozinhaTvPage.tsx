import { useCallback, useEffect, useState } from 'react';
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
import { linkWhatsAppPedidoPronto, navegarParaWhatsApp } from '../../lib/whatsapp';
import type { PedidoCozinha } from '../../lib/operacao';

type ConfirmacaoCancelamento =
  | { tipo: 'solicitar-pedido'; pedido: PedidoCozinha }
  | { tipo: 'confirmar-pedido'; pedido: PedidoCozinha }
  | { tipo: 'cancelar-item'; pedido: PedidoCozinha; itemId: string; nome: string };

export function OperacaoCozinhaTvPage() {
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [confirmacaoCancelamento, setConfirmacaoCancelamento] = useState<ConfirmacaoCancelamento | null>(null);
  const [itemParaCancelar, setItemParaCancelar] = useState<{
    comandaId: string;
    itemId: string;
    nome: string;
    quantidade: number;
  } | null>(null);
  const { cervejaria, isDono } = useAuth();
  const { contexto } = useOperacaoContexto();
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
    mudarStatus,
    removerItem,
    confirmarCancelamentoItem,
    isLoading,
    erroMutation,
    erroItemMutation,
    erroConfirmarCancelamentoItem,
  } = useOperacaoCozinha();

  const syncFullscreen = useCallback(() => {
    setIsNativeFullscreen(Boolean(document.fullscreenElement));
  }, []);

  const confirmarCancelamento = () => {
    if (!confirmacaoCancelamento) return;
    const confirmacao = confirmacaoCancelamento;
    if (confirmacao.tipo === 'solicitar-pedido') {
      mudarStatus.mutate(
        { id: confirmacao.pedido.id, status: 'CANCELAMENTO_PENDENTE' },
        { onSuccess: () => setConfirmacaoCancelamento(null) },
      );
      return;
    }
    if (confirmacao.tipo === 'confirmar-pedido') {
      mudarStatus.mutate(
        { id: confirmacao.pedido.id, status: 'CANCELADO' },
        { onSuccess: () => setConfirmacaoCancelamento(null) },
      );
      return;
    }
    removerItem.mutate(
      { comandaId: confirmacao.pedido.comanda.id, itemId: confirmacao.itemId },
      { onSuccess: () => setConfirmacaoCancelamento(null) },
    );
  };

  const cancelamentoPendente = mudarStatus.isPending || removerItem.isPending;

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

      {(erroMutation || erroItemMutation || erroConfirmarCancelamentoItem) && (
        <div className="cozinha-tv-erro">{erroMutation || erroItemMutation || erroConfirmarCancelamentoItem}</div>
      )}

      {naFila.length === 0 ? (
        <div className="cozinha-tv-empty">
          <EmptyState icon="👨‍🍳" title="Nenhum pedido na cozinha" />
        </div>
      ) : (
        <CozinhaTvGrid>
          {naFila.map((pedido, indice) => (
            <CozinhaPedidoCard
              key={pedido.id}
              pedido={pedido}
              indice={indice}
              variant="tv"
              disabled={mudarStatus.isPending || removerItem.isPending || confirmarCancelamentoItem.isPending}
              onAvancar={(status) => mudarStatus.mutate({ id: pedido.id, status })}
              onVoltar={(status) => mudarStatus.mutate({ id: pedido.id, status })}
              podeCancelar={isDono}
              onCancelar={() => {
                setConfirmacaoCancelamento({ tipo: 'solicitar-pedido', pedido });
              }}
              onConfirmarCancelamento={() => {
                setConfirmacaoCancelamento({ tipo: 'confirmar-pedido', pedido });
              }}
              onCancelarItem={pedido.comanda.tipo === 'AVULSA' ? undefined : (itemId) => {
                const item = pedido.itens.find((linha) => linha.id === itemId);
                if (!item) return;
                if (item.quantidade > 1) {
                  removerItem.reset();
                  setItemParaCancelar({ comandaId: pedido.comanda.id, itemId, nome: item.nome, quantidade: item.quantidade });
                } else {
                  setConfirmacaoCancelamento({ tipo: 'cancelar-item', pedido, itemId, nome: item.nome });
                }
              }}
              onConfirmarCancelamentoItem={(itemId) => confirmarCancelamentoItem.mutate({ pedidoId: pedido.id, itemId })}
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
      </Modal>
    </div>
  );
}
