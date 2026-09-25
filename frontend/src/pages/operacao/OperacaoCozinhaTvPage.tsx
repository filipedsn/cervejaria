import { Link } from 'react-router-dom';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { CozinhaPedidoCard } from '../../components/quiosque/CozinhaPedidoCard';
import { IconBell } from '../../components/NavIcons';
import { useAuth } from '../../contexts/AuthContext';
import { useQuiosqueCozinha } from '../../hooks/useQuiosqueCozinha';

export function QuiosqueCozinhaTvPage() {
  const { cervejaria } = useAuth();
  const { naFila, aguardando, alerta, mudarStatus, isLoading, erroMutation } = useQuiosqueCozinha();

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
            <span className="cozinha-tv-stat-value">{naFila.length}</span>
            <span className="cozinha-tv-stat-label">na fila</span>
          </div>
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
          <Link to="/quiosque/cozinha" className="cozinha-tv-link-operacional">
            Modo operacional
          </Link>
        </div>
      </header>

      {alerta.precisaLiberar && (
        <p className="cozinha-tv-hint">Toque na campainha para liberar o som.</p>
      )}

      {erroMutation && <div className="cozinha-tv-erro">{erroMutation}</div>}

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
              disabled={mudarStatus.isPending}
              onAvancar={(status) => mudarStatus.mutate({ id: pedido.id, status })}
              onVoltar={(status) => mudarStatus.mutate({ id: pedido.id, status })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
