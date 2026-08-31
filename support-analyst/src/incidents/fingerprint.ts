import { createHash } from 'node:crypto';
import type { IncidentClass, NormalizedEvent } from '../types.js';

export function normalizeIncidentRoute(route: string | undefined): string | undefined {
  if (!route) return undefined;
  const pathname = route.split('?')[0]?.trim().replace(/\/{2,}/g, '/');
  if (!pathname) return undefined;
  return pathname
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, ':id')
    .replace(/\/[0-9]+(?=\/|$)/g, '/:id')
    .replace(/\/[a-f0-9]{16,}(?=\/|$)/gi, '/:id');
}

export function isTenantSpecific(incidentClass: IncidentClass): boolean {
  return incidentClass === 'AUTHORIZATION_DENIED';
}

export function fingerprintCanonical(event: NormalizedEvent, incidentClass: IncidentClass): string {
  const signature = event.db?.category ?? event.eventType ?? event.action ?? 'signal:unknown';
  const routeOrAction = normalizeIncidentRoute(event.http?.route) ?? event.action ?? 'route:unknown';
  const tenant = isTenantSpecific(incidentClass) && event.tenantId ? `tenant:${event.tenantId}` : 'tenant:shared';
  return ['v1', `class:${incidentClass}`, `signature:${signature}`, `route:${routeOrAction}`, `service:${event.service ?? 'service:unknown'}`, `release:${event.releaseSha ?? 'release:unknown'}`, tenant].join('|');
}

export function fingerprintFor(event: NormalizedEvent, incidentClass: IncidentClass): string {
  return `ifp1:${createHash('sha256').update(fingerprintCanonical(event, incidentClass)).digest('hex')}`;
}

export function incidentIdFor(fingerprint: string, firstSeen: string): string {
  return `inc1:${createHash('sha256').update(`${fingerprint}|${firstSeen}`).digest('hex')}`;
}
