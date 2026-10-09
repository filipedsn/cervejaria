import { PedidoElapsedTimer } from '../PedidoElapsedTimer';
import { IconShoppingBag, IconTrash, IconWhatsApp } from '../NavIcons';
import { rotuloComanda, type PedidoCozinha, type StatusPedido } from '../../lib/operacao';
import type { CozinhaPedidoFragmento } from './CozinhaTvGrid';
import type { CSSProperties } from 'react';

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
  CANCELAMENTO_PENDENTE: { classe: 'badge-warning', label: 'Cancelamento solicitado', tvClasse: 'cozinha-tv-card--cancelamento' },
  CANCELADO: { classe: 'badge-inactive', label: 'Cancelado', tvClasse: 'cozinha-tv-card--cancelamento' },
};

interface Props {
  pedido: PedidoCozinha;
  fragment?: CozinhaPedidoFragmento;
  measurement?: boolean;
  measurementKind?: 'full' | 'item';
  measurementId?: string;
  measurementItemIndex?: number;
  layoutStyle?: CSSProperties;
  indice?: number;
  mostrarFila?: boolean;
  variant?: 'operacional' | 'tv';
  disabled?: boolean;
  onAvancar?: (status: StatusPedido) => void;
  onVoltar?: (status: StatusPedido) => void;
  podeCancelar?: boolean;
  onCancelar?: () => void;
  onConfirmarCancelamento?: () => void;
  onCancelarItem?: (itemId: string) => void;
  onConfirmarCancelamentoItem?: (itemId: string) => void;
  onAvisarCliente?: () => void;
}

export function CozinhaPedidoCard({
  pedido,
  fragment,
  measurement = false,
  measurementKind,
  measurementId,
  measurementItemIndex,
  layoutStyle,
  indice,
  mostrarFila = true,
  variant = 'operacional',
  disabled,
  onAvancar,
  onVoltar,
  podeCancelar = false,
  onCancelar,
  onConfirmarCancelamento,
  onCancelarItem,
  onConfirmarCancelamentoItem,
  onAvisarCliente,
}: Props) {
  const avanco = AVANCO_COZINHA[pedido.status];
  const volta = VOLTA_COZINHA[pedido.status];
  const badge = BADGE[pedido.status];
  const timerStartedAt = pedido.entregueEm ? pedido.createdAt : (pedido.statusDesde ?? pedido.createdAt);
  const itemIndexes = fragment?.itemIndexes ?? pedido.itens.map((_, index) => index);
  const itensVisiveis = itemIndexes.map((index) => pedido.itens[index]).filter((item): item is PedidoCozinha['itens'][number] => Boolean(item));
  const quantidadeItens = itensVisiveis.reduce((total, item) => total + item.quantidade, 0);
  const fragmento: CozinhaPedidoFragmento = fragment ?? { itemIndexes, part: 1, total: 1, isFirst: true, isLast: true };
  const rotuloFragmento = fragmento.total > 1
    ? fragmento.isFirst
      ? `Pedido ${pedido.numero} — parte ${fragmento.part}/${fragmento.total}`
      : `Pedido ${pedido.numero} — continuação ${fragmento.part}/${fragmento.total}`
    : null;
  const measurementAttrs = measurement ? {
    'data-kitchen-measure-kind': measurementKind,
    'data-kitchen-order-id': measurementId,
    ...(measurementKind === 'item' ? { 'data-kitchen-item-index': measurementItemIndex } : {}),
  } : {};

  if (variant === 'tv') {
    return (
      <article {...measurementAttrs} style={layoutStyle} className={'cozinha-tv-card ' + badge.tvClasse}>
        {rotuloFragmento && <p className="cozinha-tv-card-continuation">{rotuloFragmento}</p>}
        <div className="cozinha-tv-card-header">
          <div className="min-w-0">
            <div className="cozinha-tv-card-position-row">
              {mostrarFila && indice != null && fragmento.isFirst && (
                <p className="cozinha-tv-card-pos">#{indice + 1}</p>
              )}
              <div className="cozinha-tv-card-timer-wrap">
                {measurement ? <span className="cozinha-tv-card-timer">00:00</span> : <PedidoElapsedTimer
                  startedAt={timerStartedAt}
                  stoppedAt={pedido.entregueEm}
                  className="cozinha-tv-card-timer"
                  ariaLabel={
                    pedido.entregueEm ? 'Tempo total até a entrega' : 'Tempo em ' + badge.label.toLowerCase()
                  }
                />}
              </div>
            </div>
            <p className="cozinha-tv-card-comanda">{rotuloComanda(pedido.comanda)}</p>
          </div>
          <div className="cozinha-tv-card-header-badges">
            <span className="cozinha-tv-card-badge">{badge.label}</span>
            <p className="cozinha-tv-card-senha">Senha {pedido.numero}</p>
          </div>
        </div>

        <div className="cozinha-tv-card-meta">
          <span className="cozinha-tv-card-created">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            {new Date(pedido.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="cozinha-tv-card-count">
            {quantidadeItens} {quantidadeItens === 1 ? 'item' : 'itens'}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
          </span>
        </div>

        <ul className="cozinha-tv-card-itens">
          {itensVisiveis.map((item) => (
            <li key={item.id} data-kitchen-item-id={item.id} className={item.cancelamentoPendente ? 'cozinha-tv-card-item--cancelamento' : ''}>
              <div className="cozinha-tv-card-item-heading">
              <span className="cozinha-tv-card-qtd">{item.quantidade}×</span>
              <span className="cozinha-tv-card-nome">{item.nome}</span>
                {item.paraViagem && <span className="cozinha-tv-card-item-travel" title="Para viagem" aria-label="Para viagem"><IconShoppingBag className="h-5 w-5" /></span>}
                {item.cancelamentoPendente && pedido.status !== 'CANCELAMENTO_PENDENTE' && onConfirmarCancelamentoItem ? (
                  <button type="button" className="cozinha-tv-card-btn cozinha-tv-card-btn-danger" disabled={disabled || measurement} onClick={() => onConfirmarCancelamentoItem(item.id)}>
                    Confirmar cancelamento
                  </button>
                ) : onCancelarItem && (
                  <button
                    type="button"
                    className="cozinha-tv-card-item-cancel"
                    disabled={disabled || measurement}
                    aria-label={`Cancelar ${item.nome}`}
                    onClick={() => onCancelarItem(item.id)}
                  >
                    <IconTrash className="w-4 h-4" />
                  </button>
                )}
              </div>
                {item.opcionais?.length ? <small className="cozinha-tv-card-item-details cozinha-tv-card-item-options"><strong>Opcionais:</strong><span>{item.opcionais.map((o) => (o.quantidade > 1 ? o.quantidade + '× ' : '') + o.nome).join(', ')}</span></small> : null}
                {item.observacao ? <small className="cozinha-tv-card-item-details cozinha-tv-card-item-observation"><strong>Observação:</strong><span>{item.observacao}</span></small> : null}
            </li>
          ))}
        </ul>

        {fragmento.isFirst && pedido.observacao && <p className="cozinha-tv-card-obs"><strong>Observação do pedido:</strong> {pedido.observacao}</p>}

        {fragmento.isLast && <div className="cozinha-tv-card-actions">
          {pedido.status === 'PRONTO' && onAvisarCliente && pedido.comanda.cliente?.telefone && (
            <button type="button" className="cozinha-tv-card-btn cozinha-tv-card-btn-whatsapp" disabled={disabled || measurement} onClick={onAvisarCliente}>
              <IconWhatsApp className="h-7 w-7" /> Avisar
            </button>
          )}
          {pedido.status === 'CANCELAMENTO_PENDENTE' && onConfirmarCancelamento && (
            <button type="button" className="cozinha-tv-card-btn cozinha-tv-card-btn-danger" disabled={disabled || measurement} onClick={onConfirmarCancelamento}>
              Confirmar cancelamento
            </button>
          )}
          {avanco && onAvancar && (
            <button
              type="button"
              className="cozinha-tv-card-btn cozinha-tv-card-btn-primary"
              disabled={disabled || measurement}
              data-audit="operacao-cozinha-avancar"
              onClick={() => onAvancar(avanco.status)}
            >
              {avanco.label}
            </button>
          )}
          {volta && onVoltar && (
            <button
              type="button"
              className="cozinha-tv-card-btn cozinha-tv-card-btn-ghost"
              disabled={disabled || measurement}
              onClick={() => onVoltar(volta)}
            >
              Voltar
            </button>
          )}
          {podeCancelar && STATUS_CANCELAVEIS.includes(pedido.status) && onCancelar && (
            <button
              type="button"
              className="cozinha-tv-card-btn cozinha-tv-card-btn-danger cozinha-tv-card-btn-icon"
              disabled={disabled || measurement}
              data-audit="operacao-cozinha-cancelar"
              aria-label="Cancelar pedido"
              title="Cancelar pedido"
              onClick={onCancelar}
            >
              <IconTrash className="w-5 h-5" />
            </button>
          )}
        </div>}
      </article>
    );
  }

  return (
    <article
      {...measurementAttrs}
      style={layoutStyle}
      className={`card-touch !p-3 space-y-2 ${pedido.status === 'RECEBIDO' ? 'pedido-card-alert' : ''} ${pedido.status === 'CANCELAMENTO_PENDENTE' ? 'border-2 !border-orange-500 bg-orange-950/20' : ''}`}
    >
      {rotuloFragmento && <p className="cozinha-tv-card-continuation">{rotuloFragmento}</p>}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {mostrarFila && indice != null && fragmento.isFirst && (
            <span className="text-xs font-bold uppercase tracking-wide text-brand-600 shrink-0">
              #{indice + 1}
            </span>
          )}
          <p className="text-xl font-bold truncate">{rotuloComanda(pedido.comanda)}</p>
        </div>
        <span className={`${badge.classe} shrink-0`}>{badge.label}</span>
      </div>

      <div className="flex items-baseline gap-2">
        {measurement ? <span className="text-2xl font-mono font-bold tabular-nums text-orange leading-none">00:00</span> : <PedidoElapsedTimer
          startedAt={timerStartedAt}
          stoppedAt={pedido.entregueEm}
          className="text-2xl font-mono font-bold tabular-nums text-orange leading-none"
          ariaLabel={
            pedido.entregueEm ? 'Tempo total até a entrega' : 'Tempo em ' + badge.label.toLowerCase()
          }
        />}
        <span className="text-xs text-ink-muted">senha {pedido.numero}</span>
      </div>

      <ul className="text-base space-y-0.5">
        {itensVisiveis.map((item) => (
          <li key={item.id} data-kitchen-item-id={item.id} className={item.cancelamentoPendente ? 'rounded-lg border border-orange-500/70 bg-orange-950/20 p-2' : ''}>
            <div className="flex items-center gap-2">
              {item.quantidade}× {item.nome}
              {item.paraViagem && <span className="ml-2 inline-flex text-amber-300" title="Para viagem" aria-label="Para viagem"><IconShoppingBag className="h-4 w-4" /></span>}
              {item.cancelamentoPendente && <span className="ml-auto text-xs font-semibold text-orange-400">Cancelamento solicitado</span>}
            </div>
            {item.cancelamentoPendente && pedido.status !== 'CANCELAMENTO_PENDENTE' && onConfirmarCancelamentoItem && (
              <button type="button" className="touch-btn-orange touch-btn-sm mt-2" disabled={disabled || measurement} onClick={() => onConfirmarCancelamentoItem(item.id)}>
                Confirmar cancelamento
              </button>
            )}
            {item.opcionais?.length ? <small className="block text-xs text-ink-muted">Opcionais: {item.opcionais.map((o) => (o.quantidade > 1 ? o.quantidade + '× ' : '') + o.nome).join(', ')}</small> : null}
            {item.observacao ? <small className="block text-xs text-ink-muted">Obs: {item.observacao}</small> : null}
            {item.paraViagem && <small className="block text-amber-300">Para viagem</small>}
          </li>
        ))}
      </ul>

      {fragmento.isFirst && pedido.observacao && <p className="cozinha-tv-card-obs"><strong>Observação do pedido:</strong> {pedido.observacao}</p>}

      {fragmento.isLast && <div className="flex flex-wrap gap-2">
        {pedido.status === 'PRONTO' && onAvisarCliente && pedido.comanda.cliente?.telefone && (
          <button type="button" className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50" disabled={disabled || measurement} onClick={onAvisarCliente}>
            <IconWhatsApp className="h-7 w-7" /> Avisar
          </button>
        )}
        {pedido.status === 'CANCELAMENTO_PENDENTE' && onConfirmarCancelamento && (
          <button type="button" className="touch-btn-danger flex-1 touch-btn-sm" disabled={disabled || measurement} onClick={onConfirmarCancelamento}>
            Confirmar cancelamento
          </button>
        )}
        {avanco && onAvancar && (
          <button
            type="button"
            className="touch-btn-primary flex-1 touch-btn-sm"
            disabled={disabled || measurement}
            onClick={() => onAvancar(avanco.status)}
          >
            {avanco.status === 'EM_PREPARO' ? 'Iniciar preparo' : avanco.label}
          </button>
        )}
        {volta && onVoltar && (
          <button
            type="button"
            className="touch-btn-ghost"
            disabled={disabled || measurement}
            onClick={() => onVoltar(volta)}
          >
            Voltar
          </button>
        )}
        {podeCancelar && STATUS_CANCELAVEIS.includes(pedido.status) && onCancelar && (
          <button
            type="button"
            className="touch-btn-danger touch-btn-sm"
            disabled={disabled || measurement}
            data-audit="operacao-cozinha-cancelar"
            onClick={onCancelar}
          >
            Cancelar pedido
          </button>
        )}
      </div>}
    </article>
  );
}
