import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Cervejaria } from '../types';
import { ToggleAtivo } from './ToggleAtivo';

export function ConfigKpisComandaPanel() {
  const { cervejaria, updateCervejaria } = useAuth();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  if (!cervejaria) return null;

  const exibir = cervejaria.exibirKpisComanda ?? true;

  async function alternar() {
    setLoading(true);
    setErro('');
    try {
      const atualizado = await api.patch<Cervejaria>('/api/cervejaria/operacao', {
        exibirKpisComanda: !exibir,
      });
      updateCervejaria(atualizado);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível salvar a preferência');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-ink">KPIs na tela de comandas</p>
          <p className="text-sm text-ink-muted mt-1 leading-relaxed">
            Exibe os 6 cards de resumo (comandas abertas/fechadas, vendas avulsas, receita e valores em
            aberto/fechado) na cervejaria e no quiosque.
          </p>
        </div>
        <ToggleAtivo
          ativo={exibir}
          loading={loading}
          labelAtivo="Ocultar KPIs na comanda"
          labelInativo="Exibir KPIs na comanda"
          onToggle={alternar}
        />
      </div>
      {erro && <div className="alert-error text-sm">{erro}</div>}
    </div>
  );
}
