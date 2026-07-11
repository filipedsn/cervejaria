import { useState } from 'react';
import { formatCurrency } from '../lib/api';
import type { EventoDashboardProduto } from '../types';
import { FORMATO_BEBIDA_LABELS, isBebidaChope } from '../types';

function formatProdutoDetalhe(item: EventoDashboardProduto): string {
  if (item.tipo === 'COMIDA') {
    return `${item.quantidade} un.`;
  }
  if (item.formato && !isBebidaChope({ tipo: item.tipo, formato: item.formato })) {
    return `${FORMATO_BEBIDA_LABELS[item.formato]} · ${item.quantidade} un.`;
  }
  return `${item.volumeMl}ml · ${item.quantidade} un.`;
}

interface PorProdutoSectionProps {
  aberto: EventoDashboardProduto[];
  fechado: EventoDashboardProduto[];
}

export function PorProdutoSection({ aberto, fechado }: PorProdutoSectionProps) {
  const [tab, setTab] = useState<'aberto' | 'fechado'>('fechado');
  const produtos = tab === 'aberto' ? aberto : fechado;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="section-label">Por produto</h3>
        <div className="segmented-control">
          <button
            type="button"
            onClick={() => setTab('aberto')}
            className={`segmented-control-btn ${
              tab === 'aberto' ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
            }`}
          >
            Aberto
          </button>
          <button
            type="button"
            onClick={() => setTab('fechado')}
            className={`segmented-control-btn ${
              tab === 'fechado' ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
            }`}
          >
            Fechado
          </button>
        </div>
      </div>

      <div className="card divide-y divide-line p-0 overflow-hidden">
        {produtos.length > 0 ? (
          produtos.map((item) => (
            <div
              key={`${item.produtoId}-${item.volumeMl}-${item.formato ?? ''}`}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-semibold truncate">{item.nome}</p>
                <p className="text-xs text-ink-faint">{formatProdutoDetalhe(item)}</p>
              </div>
              <p className="font-bold text-brand-600 shrink-0 tabular-nums">{formatCurrency(item.valor)}</p>
            </div>
          ))
        ) : (
          <p className="text-ink-faint text-center py-8 text-sm">
            {tab === 'aberto' ? 'Nenhum item em comandas abertas' : 'Nenhum item em comandas fechadas'}
          </p>
        )}
      </div>
    </section>
  );
}
