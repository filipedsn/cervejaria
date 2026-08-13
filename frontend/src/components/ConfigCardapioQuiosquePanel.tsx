import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { ToggleAtivo } from './ToggleAtivo';
import { useQuiosqueContexto } from '../hooks/useQuiosqueContexto';

export function ConfigCardapioQuiosquePanel() {
  const { contexto } = useQuiosqueContexto();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  if (!contexto.ativo) return null;

  const ativo = contexto.usaCardapio ?? false;

  async function alternar() {
    setLoading(true);
    setErro('');
    try {
      await api.patch('/api/quiosque/config', { usaCardapio: !ativo });
      await queryClient.invalidateQueries({ queryKey: ['quiosque-contexto'] });
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
          <p className="text-base font-semibold text-ink">Cardápio com preços por turno</p>
          <p className="text-sm text-ink-muted mt-1 leading-relaxed">
            Ligado: templates de cardápio, montagem na abertura do caixa e preços do template quando
            vinculado. Desligado: modo tradicional — catálogo do quiosque com preços do cadastro.
          </p>
        </div>
        <ToggleAtivo
          ativo={ativo}
          loading={loading}
          labelAtivo="Desativar cardápio por turno"
          labelInativo="Ativar cardápio por turno"
          onToggle={alternar}
        />
      </div>
      {erro && <div className="alert-error text-sm">{erro}</div>}
    </div>
  );
}
