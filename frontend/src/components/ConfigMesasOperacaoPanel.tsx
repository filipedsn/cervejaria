import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useOperacaoContexto } from '../hooks/useOperacaoContexto';

export function ConfigMesasOperacaoPanel() {
  const { contexto } = useOperacaoContexto();
  const queryClient = useQueryClient();
  const [quantidade, setQuantidade] = useState('0');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (contexto.ativo) setQuantidade(String(contexto.quantidadeMesas));
  }, [contexto]);

  if (!contexto.ativo) return null;

  async function salvar() {
    const quantidadeMesas = Number(quantidade);
    if (!Number.isInteger(quantidadeMesas) || quantidadeMesas < 0 || quantidadeMesas > 500) {
      setErro('Informe uma quantidade inteira entre 0 e 500.');
      return;
    }
    setLoading(true);
    setErro('');
    try {
      await api.patch('/api/operacao/config', { quantidadeMesas });
      await queryClient.invalidateQueries({ queryKey: ['operacao-contexto'] });
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível salvar as mesas');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface px-4 py-4">
      <div>
        <p className="text-base font-semibold text-ink">Mesas físicas</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Informe quantas mesas existem. A tela de comandas manterá Mesa 1 até Mesa N sempre visíveis, como Livre ou Ocupada.
        </p>
      </div>
      <div className="flex items-end gap-3">
        <label className="min-w-0 flex-1">
          <span className="label">Quantidade de mesas</span>
          <input
            className="input"
            type="number"
            min="0"
            max="500"
            inputMode="numeric"
            value={quantidade}
            onChange={(event) => setQuantidade(event.target.value)}
          />
        </label>
        <button type="button" className="touch-btn-primary touch-btn-sm shrink-0" onClick={salvar} disabled={loading}>
          {loading ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
      {erro && <div className="alert-error text-sm">{erro}</div>}
    </div>
  );
}
