import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export type CozinhaPerfilVisual = 'automatico' | 'ampliada' | 'mais-pedidos';
export interface CozinhaDisplaySettings { profile: CozinhaPerfilVisual }
const DEFAULT: CozinhaDisplaySettings = { profile: 'automatico' };

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
      const next = {
        profile: ['automatico', 'ampliada', 'mais-pedidos'].includes(value.profile ?? '') ? value.profile as CozinhaPerfilVisual : DEFAULT.profile,
      };
      setSettings(next);
      // Canonicalize old device preferences so removed timers cannot be restored later.
      localStorage.setItem(key, JSON.stringify(next));
    } catch { setSettings(DEFAULT); }
  }, [key]);
  const update = (patch: Partial<CozinhaDisplaySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (key) localStorage.setItem(key, JSON.stringify({ profile: next.profile }));
  };
  return { settings, update };
}
