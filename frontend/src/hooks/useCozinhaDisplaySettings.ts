import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export type CozinhaPerfilVisual = 'automatico' | 'ampliada' | 'mais-pedidos';
export const COZINHA_MAX_COLUNAS_MIN = 2;
export const COZINHA_MAX_COLUNAS_MAX = 6;
export const COZINHA_MAX_COLUNAS_DEFAULT = 6;

export interface CozinhaDisplaySettings {
  profile: CozinhaPerfilVisual;
  /** Teto de pedidos por linha no layout tablet; a grade usa min(teto, o que cabe). */
  maxColunasPorLinha: number;
}

const DEFAULT: CozinhaDisplaySettings = {
  profile: 'automatico',
  maxColunasPorLinha: COZINHA_MAX_COLUNAS_DEFAULT,
};

function deviceId() {
  const key = 'qt:cozinha:device-id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export function clampMaxColunasPorLinha(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return COZINHA_MAX_COLUNAS_DEFAULT;
  return Math.min(COZINHA_MAX_COLUNAS_MAX, Math.max(COZINHA_MAX_COLUNAS_MIN, Math.round(n)));
}

export function useCozinhaDisplaySettings() {
  const { cervejaria, usuario } = useAuth();
  const key = cervejaria && usuario ? `qt:cozinha:visual:${cervejaria.id}:${usuario.id}:${deviceId()}` : null;
  const [settings, setSettings] = useState(DEFAULT);
  useEffect(() => {
    if (!key) return;
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<CozinhaDisplaySettings> | null;
      if (!value) {
        setSettings(DEFAULT);
        return;
      }
      const next: CozinhaDisplaySettings = {
        profile: ['automatico', 'ampliada', 'mais-pedidos'].includes(value.profile ?? '')
          ? (value.profile as CozinhaPerfilVisual)
          : DEFAULT.profile,
        maxColunasPorLinha: clampMaxColunasPorLinha(value.maxColunasPorLinha),
      };
      setSettings(next);
      // Canonicalize old device preferences so removed timers cannot be restored later.
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setSettings(DEFAULT);
    }
  }, [key]);
  const update = (patch: Partial<CozinhaDisplaySettings>) => {
    const next: CozinhaDisplaySettings = {
      profile: patch.profile ?? settings.profile,
      maxColunasPorLinha: clampMaxColunasPorLinha(
        patch.maxColunasPorLinha !== undefined ? patch.maxColunasPorLinha : settings.maxColunasPorLinha,
      ),
    };
    setSettings(next);
    if (key) localStorage.setItem(key, JSON.stringify(next));
  };
  return { settings, update };
}
