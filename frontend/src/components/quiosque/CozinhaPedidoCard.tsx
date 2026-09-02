import { PedidoElapsedTimer } from '../PedidoElapsedTimer';
import { rotuloComanda, type PedidoCozinha, type StatusPedido } from '../../lib/quiosque';

export const AVANCO_COZINHA: Partial<Record<StatusPedido, { status: StatusPedido; label: string }>> = {
  RECEBIDO: { status: 'EM_PREPARO', label: 'Iniciar' },
  EM_PREPARO: { status: 'PRONTO', label: 'Pronto' },
  PRONTO: { status: 'ENTREGUE', label: 'Entregue' },
};

export const VOLTA_COZINHA: Partial<Record<StatusPedido, StatusPedido>> = {
  EM_PREPARO: 'RECEBIDO',
  PRONTO: 'EM_PREPARO',
  ENTREGUE: 'PRONTO',
};

const STATUS_CANCELAVEIS: StatusPedido[] = ['RECEBIDO', 'EM_PREPARO'];

const BADGE: Record<string, { classe: string; label: string; tvClasse: string }> = {
  RECEBIDO: { classe: 'badge-open', label: 'Na fila', tvClasse: 'cozinha-tv-card--recebido' },
  EM_PREPARO: { classe: 'badge-warning', label: 'Preparando', tvClasse: 'cozinha-tv-card--preparo' },
  PRONTO: { classe: 'badge-live', label: 'Pronto', tvClasse: 'cozinha-tv-card--pronto' },
  ENTREGUE: { classe: 'badge-inactive', label: 'Entregue', tvClasse: 'cozinha-tv-card--entregue' },
};

interface Props {
  pedido: PedidoCozinha;
  indice?: number;
  mostrarFila?: boolean;
  variant?: 'operacional' | 'tv';
  disabled?: boolean;
  onAvancar: (status: StatusPedido) => void;
  onVoltar?: (status: StatusPedido) => void;
  podeCancelar?: boolean;
  onCancelar?: () => void;
}

export function CozinhaPedidoCard({
  pedido,
  indice,
  mostrarFila = true,
  variant = 'operacional',
  disabled,
  onAvancar,
  onVoltar,
  podeCancelar = false,
  onCancelar,
}: Props) {
  const avanco = AVANCO_COZINHA[pedido.status];
  const volta = VOLTA_COZINHA[pedido.status];
  const badge = BADGE[pedido.status];
  const timerStartedAt = pedido.entregueEm ? pedido.createdAt : (pedido.statusDesde ?? pedido.createdAt);

  if (variant === 'tv') {
    return (
      <article className={`cozinha-tv-card ${badge.tvClasse}`}>
        <div className="cozinha-tv-card-header">
          <div className="min-w-0">
            {mostrarFila && indice != null && (
              <p className="cozinha-tv-card-pos">#{indice + 1}</p>
            )}
            <p className="cozinha-tv-card-comanda">{rotuloComanda(pedido.comanda)}</p>
            <p className="cozinha-tv-card-senha">Senha {pedido.numero}</p>
          </div>
          <span className="cozinha-tv-card-badge">{badge.label}</span>
        </div>

        <div className="cozinha-tv-card-timer-wrap">
          <PedidoElapsedTimer
            startedAt={timerStartedAt}
            stoppedAt={pedido.entregueEm}
            className="cozinha-tv-card-timer"
            ariaLabel={
              pedido.entregueEm ? 'Tempo total até a entrega' : `Tempo em ${badge.label.toLowerCase()}`
            }
          />
        </div>

        <ul className="cozinha-tv-card-itens">
          {pedido.itens.map((item) => (
            <li key={item.id}>
              <span className="cozinha-tv-card-qtd">{item.quantidade}×</span>
              <span className="cozinha-tv-card-nome">{item.nome}</span>
            </li>
          ))}
        </ul>

        {pedido.observacao && <p className="cozinha-tv-card-obs">Obs: {pedido.observacao}</p>}

        <div className="cozinha-tv-card-actions">
          {avanco && (
            <button
              type="button"
              className="cozinha-tv-card-btn cozinha-tv-card-btn-primary"
              disabled={disabled}
              data-audit="quiosque-cozinha-avancar"
              onClick={() => onAvancar(avanco.status)}
            >
              {avanco.label}
            </button>
          )}
          {volta && onVoltar && (
            <button
              type="button"
              className="cozinha-tv-card-btn cozinha-tv-card-btn-ghost"
              disabled={disabled}
              onClick={() => onVoltar(volta)}
            >
              Voltar
            </button>
          )}
        </div>
      </article>
    );
  }

  return (
    <article
      className={`card-touch !p-3 space-y-2 ${pedido.status === 'RECEBIDO' ? 'pedido-card-alert' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {mostrarFila && indice != null && (
            <span className="text-xs font-bold uppercase tracking-wide text-brand-600 shrink-0">
              #{indice + 1}
            </span>
          )}
          <p className="text-xl font-bold truncate">{rotuloComanda(pedido.comanda)}</p>
        </div>
        <span className={`${badge.classe} shrink-0`}>{badge.label}</span>
      </div>

      <div className="flex items-baseline gap-2">
        <PedidoElapsedTimer
          startedAt={timerStartedAt}
          stoppedAt={pedido.entregueEm}
          className="text-2xl font-mono font-bold tabular-nums text-orange leading-none"
          ariaLabel={
            pedido.entregueEm ? 'Tempo total até a entrega' : `Tempo em ${badge.label.toLowerCase()}`
          }
        />
        <span className="text-xs text-ink-muted">senha {pedido.numero}</span>
      </div>

      <ul className="text-base space-y-0.5">
        {pedido.itens.map((item) => (
          <li key={item.id}>
            {item.quantidade}× {item.nome}
          </li>
        ))}
      </ul>

      {pedido.observacao && <p className="text-xs text-ink-muted">Obs: {pedido.observacao}</p>}

      <div className="flex flex-wrap gap-2">
        {avanco && (
          <button
            type="button"
            className="touch-btn-primary flex-1 touch-btn-sm"
            disabled={disabled}
            onClick={() => onAvancar(avanco.status)}
          >
            {avanco.status === 'EM_PREPARO' ? 'Iniciar preparo' : avanco.label}
          </button>
        )}
        {volta && onVoltar && (
          <button
            type="button"
            className="touch-btn-ghost"
            disabled={disabled}
            onClick={() => onVoltar(volta)}
          >
            Voltar
          </button>
        )}
        {podeCancelar && STATUS_CANCELAVEIS.includes(pedido.status) && onCancelar && (
          <button
            type="button"
            className="touch-btn-danger touch-btn-sm"
            disabled={disabled}
            data-audit="quiosque-cozinha-cancelar"
            onClick={onCancelar}
          >
            Cancelar pedido
          </button>
        )}
      </div>
    </article>
  );
}
