import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { initAuditTracker, trackPageView } from '../lib/audit-tracker';

export function AuditTracker() {
  const { pathname, search, key } = useLocation();
  const lastTrackedLocationKey = useRef<string | null>(null);

  useEffect(() => {
    initAuditTracker();
  }, []);

  useEffect(() => {
    // React StrictMode may replay mount effects in the QA/development build.
    // A location key is unique per router navigation, so this suppresses only
    // a repeated effect for the same entry and preserves genuine revisits.
    if (lastTrackedLocationKey.current === key) return;
    lastTrackedLocationKey.current = key;
    trackPageView(`${pathname}${search}`);
  }, [key, pathname, search]);

  return null;
}
