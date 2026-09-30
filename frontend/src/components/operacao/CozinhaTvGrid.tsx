import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function CozinhaTvGrid({ children }: { children: ReactNode }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const atualizarSpan = (card: Element) => {
      const estilos = getComputedStyle(grid);
      const alturaLinha = Number.parseFloat(estilos.gridAutoRows);
      if (!Number.isFinite(alturaLinha) || alturaLinha > 2) {
        (card as HTMLElement).style.gridRowEnd = 'auto';
        return;
      }

      const intervalo = Number.parseFloat(estilos.rowGap) || 0;
      const alturaCard = card.getBoundingClientRect().height;
      const linhas = Math.max(1, Math.ceil((alturaCard + intervalo) / (alturaLinha + intervalo)));
      (card as HTMLElement).style.gridRowEnd = `span ${linhas}`;
    };

    const atualizarLayout = () => {
      const estilos = getComputedStyle(grid);
      const colunas = Math.max(1, estilos.gridTemplateColumns.trim().split(/\s+/).length);
      Array.from(grid.children).forEach((card, indice) => {
        const elemento = card as HTMLElement;
        const coluna = String((indice % colunas) + 1);
        if (elemento.style.gridColumn !== coluna) elemento.style.gridColumn = coluna;
        atualizarSpan(card);
      });
    };

    const observer = new ResizeObserver((entries) => {
      entries.forEach(({ target }) => atualizarSpan(target));
    });
    const gridObserver = new ResizeObserver(atualizarLayout);
    gridObserver.observe(grid);

    Array.from(grid.children).forEach((card) => {
      observer.observe(card);
    });
    atualizarLayout();

    return () => {
      observer.disconnect();
      gridObserver.disconnect();
    };
  }, [children]);

  return <div ref={gridRef} className="cozinha-tv-grid">{children}</div>;
}
