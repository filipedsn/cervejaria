import { useEffect } from 'react';
import { pushAuditContext, type AuditContext } from '../lib/audit-context';

/** Declares the functional context of the current screen for every audit event it emits. */
export function useAuditContext(context: AuditContext | null | undefined): void {
  const key = context ? JSON.stringify(context) : '';
  useEffect(() => {
    if (!key) return undefined;
    return pushAuditContext(JSON.parse(key) as AuditContext);
  }, [key]);
}
