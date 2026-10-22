import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { initAuditTracker, trackPageView, setAuditIdentity } from '../lib/audit-tracker';
import { useAuth } from '../contexts/AuthContext';

export function AuditTracker() {
  const { pathname, search, key } = useLocation();
  const { usuario, cervejaria, isLoading } = useAuth();
  const lastTrackedLocationKey = useRef<string | null>(null);

  useEffect(() => {
    initAuditTracker();
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (usuario && !pathname.startsWith('/c/')) setAuditIdentity(usuario.id, cervejaria?.id ?? null);
    // React StrictMode may replay mount effects in the QA/development build.
    // A location key is unique per router navigation, so this suppresses only
    // a repeated effect for the same entry and preserves genuine revisits.
    const originKey = `${key}:${usuario?.id ?? 'anonymous'}:${cervejaria?.id ?? ''}`;
    if (lastTrackedLocationKey.current === originKey) return;
    lastTrackedLocationKey.current = originKey;
    trackPageView(`${pathname}${search}`);
  }, [key, pathname, search, isLoading, usuario?.id, cervejaria?.id]);

  return null;
}
