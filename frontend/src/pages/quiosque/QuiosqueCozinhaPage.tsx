import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { CozinhaPedidoCard } from '../../components/quiosque/CozinhaPedidoCard';
import { IconBell } from '../../components/NavIcons';
import { useQuiosqueCozinha } from '../../hooks/useQuiosqueCozinha';

export function QuiosqueCozinhaPage() {
  const [verEntregues, setVerEntregues] = useState(false);
  const [erroLocal, setErroLocal] = useState('');

  const { naFila, entregues, alerta, mudarStatus, isLoading, erroMutation } = useQuiosqueCozinha();

  if (isLoading) return <Loading />;

  const lista = verEntregues ? entregues : naFila;
  const erro = erroLocal || erroMutation;

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
            mudarStatus.mutate(
              { id: pedido.id, status },
              { onError: () => setErroLocal('Não foi possível atualizar o pedido') },
            );
          }}
          onVoltar={(status) => {
            setErroLocal('');
            mudarStatus.mutate(
              { id: pedido.id, status },
              { onError: () => setErroLocal('Não foi possível atualizar o pedido') },
            );
          }}
        />
      ))}
    </div>
  );
}
