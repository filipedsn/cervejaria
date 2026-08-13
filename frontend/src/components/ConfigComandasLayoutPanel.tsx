import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Cervejaria } from '../types';
import { ToggleAtivo } from './ToggleAtivo';

export function ConfigComandasLayoutPanel() {
  const { cervejaria, updateCervejaria } = useAuth();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  if (!cervejaria) return null;

  const colunaUnica = cervejaria.comandasColunaUnica ?? true;

  async function alternar() {
    setLoading(true);
    setErro('');
    try {
      const atualizado = await api.patch<Cervejaria>('/api/cervejaria/operacao', {
        comandasColunaUnica: !colunaUnica,
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
          <p className="text-base font-semibold text-ink">Lista de comandas em coluna única</p>
          <p className="text-sm text-ink-muted mt-1 leading-relaxed">
            Comandas abertas e fechadas em uma coluna (ligado) ou em duas colunas lado a lado (desligado).
          </p>
        </div>
        <ToggleAtivo
          ativo={colunaUnica}
          loading={loading}
          labelAtivo="Usar duas colunas na lista"
          labelInativo="Usar coluna única na lista"
          onToggle={alternar}
        />
      </div>
      {erro && <div className="alert-error text-sm">{erro}</div>}
    </div>
  );
}
