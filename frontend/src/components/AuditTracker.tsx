import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { initAuditTracker, trackPageView } from '../lib/audit-tracker';

export function AuditTracker() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    initAuditTracker();
  }, []);

  useEffect(() => {
    trackPageView(`${pathname}${search}`);
  }, [pathname, search]);

  return null;
}
