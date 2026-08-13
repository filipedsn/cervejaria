import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Cervejaria } from '../types';
import { ToggleAtivo } from './ToggleAtivo';

export function ConfigCardapioPanel() {
  const { cervejaria, updateCervejaria } = useAuth();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  if (!cervejaria) return null;

  const ativo = cervejaria.usaCardapio ?? false;

  async function alternar() {
    setLoading(true);
    setErro('');
    try {
      const atualizado = await api.patch<Cervejaria>('/api/cervejaria/operacao', {
        usaCardapio: !ativo,
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
          <p className="text-base font-semibold text-ink">Cardápio com preços por evento</p>
          <p className="text-sm text-ink-muted mt-1 leading-relaxed">
            Ligado: templates de cardápio, montagem no evento e preços do template quando vinculado.
            Desligado: modo tradicional — só catálogo e preços do cadastro de produtos.
          </p>
        </div>
        <ToggleAtivo
          ativo={ativo}
          loading={loading}
          labelAtivo="Desativar cardápio por evento"
          labelInativo="Ativar cardápio por evento"
          onToggle={alternar}
        />
      </div>
      {erro && <div className="alert-error text-sm">{erro}</div>}
    </div>
  );
}
