import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { CozinhaPedidoCard } from '../../components/operacao/CozinhaPedidoCard';
import { IconBell } from '../../components/NavIcons';
import { useAuth } from '../../contexts/AuthContext';
import { useOperacaoCozinha } from '../../hooks/useOperacaoCozinha';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { linkWhatsAppPedidoPronto, navegarParaWhatsApp } from '../../lib/whatsapp';

export function OperacaoCozinhaTvPage() {
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
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
        <div className="cozinha-tv-grid">
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
                if (window.confirm(`Cancelar o pedido ${pedido.numero}?`)) {
                  mudarStatus.mutate({ id: pedido.id, status: 'CANCELAMENTO_PENDENTE' });
                }
              }}
              onConfirmarCancelamento={() => {
                if (window.confirm(`Confirmar o cancelamento do pedido ${pedido.numero}?`)) {
                  mudarStatus.mutate({ id: pedido.id, status: 'CANCELADO' });
                }
              }}
              onCancelarItem={(itemId) => {
                const item = pedido.itens.find((linha) => linha.id === itemId);
                if (!item) return;
                if (window.confirm(`Cancelar ${item.quantidade}x ${item.nome}?`)) {
                  removerItem.mutate({ comandaId: pedido.comanda.id, itemId });
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
        </div>
      )}
    </div>
  );
}
