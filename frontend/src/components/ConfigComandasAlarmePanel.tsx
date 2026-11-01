import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Cervejaria } from '../types';
import { ToggleAtivo } from './ToggleAtivo';

const INTERVALO_MIN = 5;
const INTERVALO_MAX = 120;
const INTERVALO_PADRAO = 10;

export function ConfigComandasAlarmePanel() {
  const { cervejaria, updateCervejaria } = useAuth();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  if (!cervejaria) return null;

  const ativo = cervejaria.comandasAlarmeAtivo ?? true;
  const intervalo = cervejaria.comandasAlarmeIntervaloSegundos ?? INTERVALO_PADRAO;

  async function salvar(patch: Partial<Pick<Cervejaria, 'comandasAlarmeAtivo' | 'comandasAlarmeIntervaloSegundos'>>) {
    setLoading(true);
    setErro('');
    try {
      const atualizado = await api.patch<Cervejaria>('/api/cervejaria/operacao', patch);
      updateCervejaria(atualizado);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível salvar a preferência');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-surface px-4 py-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-ink">Alarme na tela de comandas</p>
            <p className="text-sm text-ink-muted mt-1 leading-relaxed">
              Enquanto houver pedido para Servir ou solicitação de pagamento, os aparelhos com a tela de
              comandas aberta repetem o som de alerta.
            </p>
          </div>
          <ToggleAtivo
            ativo={ativo}
            loading={loading}
            labelAtivo="Desligar alarme da tela de comandas"
            labelInativo="Ligar alarme da tela de comandas"
            onToggle={() => void salvar({ comandasAlarmeAtivo: !ativo })}
          />
        </div>
        <label className="block max-w-xs">
          <span className="text-sm font-medium text-ink">Intervalo entre alertas (segundos)</span>
          <input
            type="number"
            min={INTERVALO_MIN}
            max={INTERVALO_MAX}
            step={1}
            disabled={loading || !ativo}
            defaultValue={intervalo}
            key={intervalo}
            className="mt-1 w-full rounded-lg border border-line bg-surface-lighter px-3 py-2 text-sm tabular-nums disabled:opacity-50"
            onBlur={(event) => {
              const raw = Number(event.target.value);
              if (!Number.isFinite(raw)) {
                event.target.value = String(intervalo);
                return;
              }
              const clamped = Math.min(INTERVALO_MAX, Math.max(INTERVALO_MIN, Math.round(raw)));
              event.target.value = String(clamped);
              if (clamped === intervalo) return;
              void salvar({ comandasAlarmeIntervaloSegundos: clamped });
            }}
          />
          <span className="mt-1 block text-xs text-ink-muted">
            Padrão {INTERVALO_PADRAO}s · permitido de {INTERVALO_MIN} a {INTERVALO_MAX}s
          </span>
        </label>
      </div>
      {erro && <div className="alert-error text-sm">{erro}</div>}
    </div>
  );
}
