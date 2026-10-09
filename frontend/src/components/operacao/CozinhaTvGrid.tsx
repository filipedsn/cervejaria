import { Children, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  autoAdvance?: boolean;
  intervalMs?: number;
  paused?: boolean;
  profile?: 'automatico' | 'ampliada' | 'mais-pedidos';
  operational?: boolean;
  countLabel?: string;
}

/** Paginador visual: mede os cartões no tamanho real disponível e nunca corta a fila. */
export function CozinhaTvGrid({ children, autoAdvance = true, intervalMs = 15_000, paused = false, profile = 'automatico', operational = false, countLabel = 'na fila atual' }: Props) {
  const cards = useMemo(() => Children.toArray(children), [children]);
  const shellRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [pageCards, setPageCards] = useState<string[][]>([]);
  const [page, setPage] = useState(0);
  const [interaction, setInteraction] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [visibleTab, setVisibleTab] = useState(() => !document.hidden);
  const interactionRef = useRef(false);
  const interactionTimer = useRef<number | null>(null);
  const ids = cards.map((card, index) => (card as React.ReactElement).key?.toString().replace(/^\.?\$?/, '') ?? String(index));
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const measure = useCallback(() => {
    if (paused || interactionRef.current || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    const grid = gridRef.current;
    const hidden = measureRef.current;
    if (!grid || !hidden) return;
    const width = grid.clientWidth;
    const height = grid.clientHeight;
    if (!width || !height) return;
    hidden.style.width = `${width}px`;
    const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length);
    hidden.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    const nodes = Array.from(hidden.querySelectorAll<HTMLElement>(':scope > article'));
    const currentIds = idsRef.current;
    if (nodes.length !== currentIds.length) return;
    const rowGap = Number.parseFloat(getComputedStyle(grid).rowGap) || 0;
    const rows: Array<{ ids: string[]; height: number }> = [];
    for (let i = 0; i < nodes.length; i += columns) {
      const row = nodes.slice(i, i + columns);
      rows.push({ ids: currentIds.slice(i, i + columns), height: Math.max(...row.map((node) => node.getBoundingClientRect().height)) });
    }
    const pages: string[][] = [];
    let current: string[] = [];
    let used = 0;
    for (const row of rows) {
      const next = row.height + (current.length ? rowGap : 0);
      if (current.length && used + next > height) {
        pages.push(current);
        current = [];
        used = 0;
      }
      current.push(...row.ids);
      used += row.height + (current.length > row.ids.length ? rowGap : 0);
    }
    if (current.length) pages.push(current);
    setPageCards((old) => JSON.stringify(old) === JSON.stringify(pages) ? old : pages);
  }, [paused]);

  useEffect(() => {
    const observer = new ResizeObserver(measure);
    if (gridRef.current) observer.observe(gridRef.current);
    if (measureRef.current) observer.observe(measureRef.current);
    measure();
    return () => observer.disconnect();
  }, [measure, cards]);

  useEffect(() => {
    const hidden = measureRef.current;
    if (!hidden) return;
    const observer = new ResizeObserver(measure);
    hidden.querySelectorAll('.cozinha-tv-card').forEach((card) => observer.observe(card));
    measure();
    return () => observer.disconnect();
  }, [measure, cards]);

  const activePage = Math.min(page, Math.max(0, pageCards.length - 1));
  useEffect(() => { if (page !== activePage) setPage(activePage); }, [page, activePage]);
  const visible = useMemo(() => {
    const allowed = new Set(pageCards[activePage] ?? ids);
    return cards.filter((_, index) => allowed.has(ids[index]!));
  }, [cards, ids.join('|'), pageCards, activePage]);

  const holdDuringInteraction = () => {
    interactionRef.current = true;
    setInteraction(true);
    if (interactionTimer.current !== null) window.clearTimeout(interactionTimer.current);
  };
  const releaseAfterInteraction = () => {
    if (interactionTimer.current !== null) window.clearTimeout(interactionTimer.current);
    interactionTimer.current = window.setTimeout(() => {
      interactionRef.current = false;
      setInteraction(false);
      measure();
    }, 350);
  };

  useEffect(() => { if (!paused && !interactionRef.current) measure(); }, [paused, measure]);

  useEffect(() => {
    const visibility = () => setVisibleTab(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  useEffect(() => {
    const observer = new MutationObserver(() => setDialogOpen(Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'))));
    observer.observe(document.body, { childList: true, subtree: true });
    setDialogOpen(Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')));
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (visibleTab) measure(); }, [visibleTab, measure]);
  useEffect(() => { if (!dialogOpen) measure(); }, [dialogOpen, measure]);
  useEffect(() => {
    if (!autoAdvance || paused || interaction || dialogOpen || !visibleTab || pageCards.length < 2) return;
    const timer = window.setInterval(() => setPage((current) => (current + 1) % pageCards.length), intervalMs);
    return () => window.clearInterval(timer);
  }, [autoAdvance, intervalMs, paused, interaction, dialogOpen, visibleTab, pageCards.length]);

  return (
    <div ref={shellRef} className={`cozinha-tv-pager ${operational ? 'cozinha-tv-pager-operacional' : ''} cozinha-tv-profile-${profile}`} onPointerDownCapture={holdDuringInteraction} onPointerUpCapture={releaseAfterInteraction} onPointerCancelCapture={releaseAfterInteraction} onFocusCapture={holdDuringInteraction} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) releaseAfterInteraction(); }}>
      <div ref={measureRef} className="cozinha-tv-measure" aria-hidden="true" inert>{cards}</div>
      <div ref={gridRef} className="cozinha-tv-grid">{visible}</div>
      <nav className="cozinha-tv-pager-bar" aria-label="Paginação dos pedidos">
        <button type="button" className="cozinha-tv-page-button" disabled={activePage <= 0} onClick={() => setPage((n) => Math.max(0, n - 1))}>Anterior</button>
        <p aria-live="polite">Página {activePage + 1} de {Math.max(1, pageCards.length)} · {cards.length} pedidos <span>{countLabel}</span></p>
        <button type="button" className="cozinha-tv-page-button" disabled={activePage >= pageCards.length - 1} onClick={() => setPage((n) => Math.min(pageCards.length - 1, n + 1))}>Próxima</button>
      </nav>
    </div>
  );
}
