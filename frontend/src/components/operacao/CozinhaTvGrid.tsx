import { Children, cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { PedidoCozinha } from '../../lib/operacao';

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
  measurement?: boolean;
  measurementKind?: 'full' | 'item';
  measurementId?: string;
  measurementItemIndex?: number;
  layoutStyle?: CSSProperties;
}

interface Props {
  children: ReactNode;
  paused?: boolean;
  profile?: 'automatico' | 'ampliada' | 'mais-pedidos';
  operational?: boolean;
  countLabel?: string;
}

type CardElement = ReactElement<CozinhaCardLayoutProps>;
interface UnidadeMedida {
  orderId: string;
  key: string;
  fragment: CozinhaPedidoFragmento;
  height: number;
}
interface FragmentoMedido extends UnidadeMedida {
  column: number;
  left: number;
  top: number;
  width: number;
}

function fragmentoCompleto(pedido: PedidoCozinha): CozinhaPedidoFragmento {
  return {
    itemIndexes: pedido.itens.map((_, index) => index),
    part: 1,
    total: 1,
    isFirst: true,
    isLast: true,
  };
}

/** Pagina pedidos e continuacoes usando a geometria fixa do viewport do dispositivo. */
export function CozinhaTvGrid({ children, paused = false, profile = 'automatico', operational = false, countLabel = 'na fila atual' }: Props) {
  const cards = useMemo(() => Children.toArray(children).filter(isValidElement) as CardElement[], [children]);
  const ids = useMemo(() => cards.map((card) => card.props.pedido.id), [cards]);
  const shellRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const cardSnapshotRef = useRef(cards);
  const frozenIdsRef = useRef<string[] | null>(null);
  const measurementRef = useRef<() => void>(() => undefined);
  const interactionRef = useRef(false);
  const interactionTimer = useRef<number | null>(null);
  const [pages, setPages] = useState<FragmentoMedido[][]>([]);
  const [page, setPage] = useState(0);
  const [interaction, setInteraction] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [visibleTab, setVisibleTab] = useState(() => !document.hidden);
  const [splitIds, setSplitIds] = useState<string[]>([]);

  const frozen = paused || interaction || dialogOpen || !visibleTab;
  if (frozen && frozenIdsRef.current === null) frozenIdsRef.current = ids;
  if (!frozen) frozenIdsRef.current = null;
  const stableCards = frozen && frozenIdsRef.current
    ? cardSnapshotRef.current.filter((card) => frozenIdsRef.current?.includes(card.props.pedido.id))
    : cards;

  const measure = useCallback(() => {
    if (paused || interactionRef.current || document.hidden || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    const grid = gridRef.current;
    const hidden = measureRef.current;
    if (!grid || !hidden) return;
    const width = grid.clientWidth;
    const height = grid.clientHeight;
    if (!width || !height) return;
    if (hidden.style.width !== `${width}px`) hidden.style.width = `${width}px`;

    // auto-fill reserves the same tracks on every page, including a final row with one card.
    const tracks = getComputedStyle(hidden).gridTemplateColumns.trim();
    const columns = Math.max(1, tracks === 'none' ? 1 : tracks.split(/\s+/).length);
    const measurementStyle = getComputedStyle(hidden);
    const rowGap = Number.parseFloat(measurementStyle.rowGap) || 0;
    const columnGap = Number.parseFloat(measurementStyle.columnGap) || 0;
    const columnWidth = (width - columnGap * (columns - 1)) / columns;
    const byId = new Map(cards.map((card) => [card.props.pedido.id, card]));
    const measured = new Map<string, { full: HTMLElement; items: HTMLElement[] }>();
    const needsItemMeasurements: string[] = [];
    for (const card of cards) {
      const id = card.props.pedido.id;
      const full = hidden.querySelector<HTMLElement>(`[data-kitchen-measure-kind="full"][data-kitchen-order-id="${CSS.escape(id)}"]`);
      if (!full) return;
      const fullHeight = full.getBoundingClientRect().height;
      const needsSplit = fullHeight > height && card.props.pedido.itens.length > 1;
      if (needsSplit && !splitIds.includes(id)) needsItemMeasurements.push(id);
      const items = splitIds.includes(id)
        ? card.props.pedido.itens.map((_, index) => hidden.querySelector<HTMLElement>(`[data-kitchen-measure-kind="item"][data-kitchen-order-id="${CSS.escape(id)}"][data-kitchen-item-index="${index}"]`)).filter((node): node is HTMLElement => Boolean(node))
        : [];
      if (splitIds.includes(id) && items.length !== card.props.pedido.itens.length) return;
      measured.set(id, { full, items });
    }
    if (needsItemMeasurements.length) {
      setSplitIds((current) => [...new Set([...current, ...needsItemMeasurements])]);
      return;
    }

    const units: UnidadeMedida[] = [];
    for (const [orderId, measurement] of measured) {
      const card = byId.get(orderId);
      if (!card) continue;
      const pedido = card.props.pedido;
      const fullHeight = measurement.full.getBoundingClientRect().height;
      if (fullHeight <= height || pedido.itens.length <= 1 || !splitIds.includes(orderId)) {
        units.push({ orderId, key: `${orderId}:all`, fragment: fragmentoCompleto(pedido), height: fullHeight });
        continue;
      }
      // An unusually tall order becomes a sequence of visual continuation cards. Each real
      // item appears once, and only the final fragment receives order-level actions.
      measurement.items.forEach((node, itemIndex) => {
        const total = measurement.items.length;
        units.push({
          orderId,
          key: `${orderId}:item:${itemIndex}`,
          fragment: { itemIndexes: [itemIndex], part: itemIndex + 1, total, isFirst: itemIndex === 0, isLast: itemIndex === total - 1 },
          height: node.getBoundingClientRect().height,
        });
      });
    }

    const nextPages: FragmentoMedido[][] = [];
    let pageUnits: FragmentoMedido[] = [];
    let columnHeights = Array<number>(columns).fill(0);
    let columnHasCards = Array<boolean>(columns).fill(false);
    const placeInColumn = (unit: UnidadeMedida, column: number) => {
      const top = columnHeights[column]! + (columnHasCards[column] ? rowGap : 0);
      pageUnits.push({ ...unit, column, left: column * (columnWidth + columnGap), top, width: columnWidth });
      columnHeights[column] = top + unit.height;
      columnHasCards[column] = true;
    };
    for (const unit of units) {
      const fittingColumns = columnHeights
        .map((usedHeight, column) => ({ column, usedHeight, top: usedHeight + (columnHasCards[column] ? rowGap : 0) }))
        .filter((candidate) => candidate.top + unit.height <= height)
        .sort((a, b) => a.usedHeight - b.usedHeight || a.column - b.column);
      if (fittingColumns.length === 0 && pageUnits.length > 0) {
        nextPages.push(pageUnits);
        pageUnits = [];
        columnHeights = Array<number>(columns).fill(0);
        columnHasCards = Array<boolean>(columns).fill(false);
      }
      const availableColumn = columnHeights
        .map((usedHeight, column) => ({ column, usedHeight }))
        .sort((a, b) => a.usedHeight - b.usedHeight || a.column - b.column)[0]?.column ?? 0;
      placeInColumn(unit, availableColumn);
    }
    if (pageUnits.length > 0) nextPages.push(pageUnits);
    setPages((current) => JSON.stringify(current) === JSON.stringify(nextPages) ? current : nextPages);
  }, [cards, paused, splitIds]);
  measurementRef.current = measure;

  useEffect(() => {
    if (!frozen) cardSnapshotRef.current = cards;
  }, [cards, frozen]);

  useEffect(() => {
    const scheduleMeasure = () => measurementRef.current();
    const observer = new ResizeObserver(scheduleMeasure);
    if (gridRef.current) observer.observe(gridRef.current);
    if (shellRef.current) observer.observe(shellRef.current);
    measureRef.current?.querySelectorAll<HTMLElement>('[data-kitchen-measure-kind]').forEach((node) => observer.observe(node));
    window.addEventListener('resize', scheduleMeasure);
    document.addEventListener('fullscreenchange', scheduleMeasure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      document.removeEventListener('fullscreenchange', scheduleMeasure);
    };
  }, [cards, measure, profile]);

  const activePage = Math.min(page, Math.max(0, pages.length - 1));
  useEffect(() => { if (page !== activePage) setPage(activePage); }, [page, activePage]);
  const currentUnits = pages[activePage] ?? [];
  const stableById = new Map(stableCards.map((card) => [card.props.pedido.id, card]));
  const visible = currentUnits.map((unit) => {
    const card = stableById.get(unit.orderId);
    if (!card) return null;
    return cloneElement(card, {
      key: unit.key,
      fragment: unit.fragment,
      measurement: false,
      measurementKind: undefined,
      measurementId: undefined,
      layoutStyle: { position: 'absolute', left: unit.left, top: unit.top, width: unit.width },
    });
  });

  const releaseInteraction = useCallback((immediate = false) => {
    if (interactionTimer.current !== null) window.clearTimeout(interactionTimer.current);
    if (immediate) {
      interactionRef.current = false;
      setInteraction(false);
      measurementRef.current();
      return;
    }
    interactionTimer.current = window.setTimeout(() => {
      interactionRef.current = false;
      setInteraction(false);
      measurementRef.current();
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
      const visible = !document.hidden;
      setVisibleTab(visible);
      if (!visible) releaseInteraction(true);
      else measurementRef.current();
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
    if (!paused && !interaction && !dialogOpen && visibleTab) measure();
  }, [paused, interaction, dialogOpen, visibleTab, measure]);

  const fullMeasurementCards = cards.flatMap((card) => {
    const pedido = card.props.pedido;
    const complete = fragmentoCompleto(pedido);
    const full = cloneElement(card, {
      key: `${pedido.id}:measure:full`,
      fragment: complete,
      measurement: true,
      measurementKind: 'full' as const,
      measurementId: pedido.id,
    });
    const itemCards = splitIds.includes(pedido.id) ? pedido.itens.map((_, itemIndex) => cloneElement(card, {
      key: `${pedido.id}:measure:item:${itemIndex}`,
      fragment: { itemIndexes: [itemIndex], part: itemIndex + 1, total: pedido.itens.length, isFirst: itemIndex === 0, isLast: itemIndex === pedido.itens.length - 1 },
      measurement: true,
      measurementKind: 'item' as const,
      measurementId: pedido.id,
      measurementItemIndex: itemIndex,
    })) : [];
    return [full, ...itemCards];
  });

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
      <div ref={measureRef} className="cozinha-tv-measure" aria-hidden="true" inert>{fullMeasurementCards}</div>
      <div ref={gridRef} className="cozinha-tv-grid">{visible}</div>
      <nav className="cozinha-tv-pager-bar" aria-label="Paginação dos pedidos">
        {pages.length > 1 && <button type="button" className="cozinha-tv-page-button" disabled={activePage <= 0} onClick={() => setPage((n) => Math.max(0, n - 1))}>Anterior</button>}
        <p aria-live="polite">Página {activePage + 1} de {Math.max(1, pages.length)} · {cards.length} pedidos <span>{countLabel}</span></p>
        {pages.length > 1 && <button type="button" className="cozinha-tv-page-button" disabled={activePage >= pages.length - 1} onClick={() => setPage((n) => Math.min(pages.length - 1, n + 1))}>Próxima</button>}
      </nav>
    </div>
  );
}
