import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export type CozinhaPerfilVisual = 'automatico' | 'ampliada' | 'mais-pedidos';
export interface CozinhaDisplaySettings { profile: CozinhaPerfilVisual; intervalMs: number }
const DEFAULT: CozinhaDisplaySettings = { profile: 'automatico', intervalMs: 15_000 };
const INTERVALS = [5_000, 10_000, 15_000, 20_000, 30_000] as const;

function deviceId() {
  const key = 'qt:cozinha:device-id';
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}

export function useCozinhaDisplaySettings() {
  const { cervejaria, usuario } = useAuth();
  const key = cervejaria && usuario ? `qt:cozinha:visual:${cervejaria.id}:${usuario.id}:${deviceId()}` : null;
  const [settings, setSettings] = useState(DEFAULT);
  useEffect(() => {
    if (!key) return;
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<CozinhaDisplaySettings> | null;
      if (!value) { setSettings(DEFAULT); return; }
      setSettings({
        profile: ['automatico', 'ampliada', 'mais-pedidos'].includes(value.profile ?? '') ? value.profile as CozinhaPerfilVisual : DEFAULT.profile,
        intervalMs: INTERVALS.includes(value.intervalMs as (typeof INTERVALS)[number]) ? value.intervalMs! : DEFAULT.intervalMs,
      });
    } catch { setSettings(DEFAULT); }
  }, [key]);
  const update = (patch: Partial<CozinhaDisplaySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (key) localStorage.setItem(key, JSON.stringify(next));
  };
  return { settings, update, intervals: INTERVALS };
}
