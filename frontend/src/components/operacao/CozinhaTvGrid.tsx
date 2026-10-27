import { Children, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { PedidoCozinha, StatusPedido } from '../../lib/operacao';
import {
  clampMaxColunasPorLinha,
  COZINHA_MAX_COLUNAS_DEFAULT,
} from '../../hooks/useCozinhaDisplaySettings';

/** Kept for CozinhaPedidoCard typing; the grid no longer splits tall orders into pages. */
export interface CozinhaPedidoFragmento {
  itemIndexes: number[];
  part: number;
  total: number;
  isFirst: boolean;
  isLast: boolean;
}

interface CozinhaCardLayoutProps {
  pedido: PedidoCozinha;
  fragment?: CozinhaPedidoFragmento;
  disabled?: boolean;
  onAvancar?: (status: StatusPedido) => void;
  onVoltar?: (status: StatusPedido) => void;
  onCancelar?: () => void;
  onConfirmarCancelamento?: () => void;
  onCancelarItem?: (itemId: string) => void;
  onConfirmarCancelamentoItem?: (itemId: string) => void;
  onAvisarCliente?: () => void;
}

interface Props {
  children: ReactNode;
  paused?: boolean;
  profile?: 'automatico' | 'ampliada' | 'mais-pedidos';
  operational?: boolean;
  countLabel?: string;
  /** Força o layout tablet (slots por capacidade) no PC — ex.: ?tablet=1 na demo/QA. */
  forceTabletLayout?: boolean;
  /** Teto de colunas; a grade usa min(maxColumns, o que cabe na largura). */
  maxColumns?: number;
}

type CardElement = ReactElement<CozinhaCardLayoutProps>;

/** Continuous CSS grid with manual vertical scroll; preserves scrollTop while interacting. */
export function CozinhaTvGrid({
  children,
  paused = false,
  profile = 'automatico',
  operational = false,
  countLabel = 'na fila atual',
  forceTabletLayout = false,
  maxColumns = COZINHA_MAX_COLUNAS_DEFAULT,
}: Props) {
  const columnCap = clampMaxColunasPorLinha(maxColumns);
  const cards = useMemo(() => Children.toArray(children).filter(isValidElement) as CardElement[], [children]);
  const shellRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const interactionRef = useRef(false);
  const interactionTimer = useRef<number | null>(null);
  const [interaction, setInteraction] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [visibleTab, setVisibleTab] = useState(() => !document.hidden);
  const [tabletColumns, setTabletColumns] = useState<number | null>(null);

  const frozen = paused || interaction || dialogOpen || !visibleTab;
  const cardsByTabletColumn = useMemo(() => {
    if (tabletColumns === null) return null;
    const columns = Array.from({ length: tabletColumns }, () => [] as CardElement[]);
    cards.forEach((card, index) => columns[index % tabletColumns].push(card));
    return columns;
  }, [cards, tabletColumns]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const updateTabletColumns = () => {
      const tabletLandscape = window.matchMedia(
        '(orientation: landscape) and (min-width: 700px) and (max-width: 1366px), (orientation: landscape) and (min-width: 700px) and (pointer: coarse)',
      ).matches;
      const useTabletLayout = forceTabletLayout || tabletLandscape;
      if (operational || !useTabletLayout) {
        grid.style.removeProperty('--cozinha-grid-columns');
        delete grid.dataset.kitchenColumns;
        delete grid.dataset.forceTabletLayout;
        setTabletColumns(null);
        return;
      }
      if (!cards.length) {
        grid.style.removeProperty('--cozinha-grid-columns');
        delete grid.dataset.kitchenColumns;
        delete grid.dataset.forceTabletLayout;
        setTabletColumns(null);
        return;
      }

      const styles = window.getComputedStyle(grid);
      const minCardLength = styles.getPropertyValue('--cozinha-card-min').trim();
      const minCardValue = Number.parseFloat(minCardLength);
      const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const gridFontSize = Number.parseFloat(styles.fontSize) || rootFontSize;
      const minCardWidth = minCardLength.endsWith('rem')
        ? minCardValue * rootFontSize
        : minCardLength.endsWith('em')
          ? minCardValue * gridFontSize
          : minCardValue;
      const gap = Number.parseFloat(styles.columnGap) || 0;
      const availableWidth = grid.clientWidth;
      const columnsThatFit = Math.max(1, Math.floor((availableWidth + gap) / (minCardWidth + gap)));
      // Slot count = min(configured ceiling, viewport capacity) — never cards.length,
      // so a lone card keeps a tablet-sized column instead of stretching full-bleed.
      const columns = Math.min(columnCap, columnsThatFit);

      grid.style.setProperty('--cozinha-grid-columns', String(columns));
      grid.dataset.kitchenColumns = String(columns);
      grid.dataset.maxColumns = String(columnCap);
      if (forceTabletLayout) grid.dataset.forceTabletLayout = '1';
      else delete grid.dataset.forceTabletLayout;
      setTabletColumns((current) => (current === columns ? current : columns));
    };

    const observer = new ResizeObserver(updateTabletColumns);
    observer.observe(grid);
    updateTabletColumns();
    return () => {
      observer.disconnect();
      grid.style.removeProperty('--cozinha-grid-columns');
      delete grid.dataset.kitchenColumns;
      delete grid.dataset.maxColumns;
      delete grid.dataset.forceTabletLayout;
    };
  }, [cards.length, operational, forceTabletLayout, columnCap]);

  const releaseInteraction = useCallback((immediate = false) => {
    if (interactionTimer.current !== null) window.clearTimeout(interactionTimer.current);
    if (immediate) {
      interactionRef.current = false;
      setInteraction(false);
      return;
    }
    interactionTimer.current = window.setTimeout(() => {
      interactionRef.current = false;
      setInteraction(false);
    }, 250);
  }, []);

  const holdInteraction = useCallback(() => {
    interactionRef.current = true;
    setInteraction(true);
    if (interactionTimer.current !== null) window.clearTimeout(interactionTimer.current);
  }, []);

  useEffect(() => {
    const onPointerEnd = () => releaseInteraction();
    const onWindowBlur = () => releaseInteraction(true);
    const onVisibility = () => {
      setVisibleTab(!document.hidden);
      if (document.hidden) releaseInteraction(true);
    };
    document.addEventListener('pointerup', onPointerEnd, true);
    document.addEventListener('pointercancel', onPointerEnd, true);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('pointerup', onPointerEnd, true);
      document.removeEventListener('pointercancel', onPointerEnd, true);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      if (interactionTimer.current !== null) window.clearTimeout(interactionTimer.current);
    };
  }, [releaseInteraction]);

  useEffect(() => {
    const observer = new MutationObserver(() => setDialogOpen(Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'))));
    observer.observe(document.body, { childList: true, subtree: true });
    setDialogOpen(Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onScroll = () => {
      scrollTopRef.current = grid.scrollTop;
    };
    grid.addEventListener('scroll', onScroll, { passive: true });
    return () => grid.removeEventListener('scroll', onScroll);
  }, []);

  // Restore scroll position after React re-renders while the queue is frozen (touch/dialog/paused).
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || !frozen) return;
    if (Math.abs(grid.scrollTop - scrollTopRef.current) > 1) {
      grid.scrollTop = scrollTopRef.current;
    }
  }, [cards, frozen, profile]);

  return (
    <div
      ref={shellRef}
      className={`cozinha-tv-pager ${operational ? 'cozinha-tv-pager-operacional' : ''} cozinha-tv-profile-${profile}`}
      onPointerDownCapture={holdInteraction}
      onFocusCapture={holdInteraction}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) releaseInteraction();
      }}
      onLostPointerCapture={() => releaseInteraction(true)}
    >
      <div
        ref={gridRef}
        className={`cozinha-tv-grid${cardsByTabletColumn ? ' cozinha-tv-grid-columns' : ''}`}
      >
        {cardsByTabletColumn
          ? cardsByTabletColumn.map((column, index) => (
              <div className="cozinha-tv-grid-column" key={`column-${index + 1}`}>
                {column}
              </div>
            ))
          : cards}
      </div>
      <nav className="cozinha-tv-pager-bar" aria-label="Fila da cozinha">
        <p aria-live="polite">{cards.length} pedidos <span>{countLabel}</span></p>
      </nav>
    </div>
  );
}
