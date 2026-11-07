import { MutationCache, QueryCache, QueryClient, type Mutation } from '@tanstack/react-query';
import { ApiError } from './api';
import { reportUserFacingError } from './report-user-facing-error';
import { trackAction } from './audit-tracker';
import { currentAuditContext, type AuditIntent, type AuditPrimitive } from './audit-context';

export type ErrorAuditMeta = {
  /** Force audit for query failures that would otherwise stay silent. */
  reportError?: boolean;
  feature?: string;
  operation?: string;
  scenario?: string;
  entityType?: string;
  entityId?: string;
  /** Builds "what the operator wanted" from the mutation variables. */
  intent?: (variables: unknown) => AuditIntent | undefined;
};

/** Typed helper so pages can declare intent with their own variables type. */
export function auditMutationMeta<TVariables>(
  meta: Omit<ErrorAuditMeta, 'intent'> & { intent?: (variables: TVariables) => AuditIntent | undefined },
): Record<string, unknown> {
  return meta as Record<string, unknown>;
}

type MutationSnapshot = { context?: Record<string, AuditPrimitive>; startedAt: number };
const snapshots = new WeakMap<Mutation<unknown, unknown, unknown>, MutationSnapshot>();

function readErrorMeta(meta: unknown): ErrorAuditMeta {
  if (!meta || typeof meta !== 'object') return {};
  return meta as ErrorAuditMeta;
}

function buildIntent(meta: ErrorAuditMeta, variables: unknown): AuditIntent | undefined {
  if (!meta.intent) return undefined;
  try {
    return meta.intent(variables);
  } catch {
    return undefined;
  }
}

function shouldReportQueryError(error: unknown, meta: ErrorAuditMeta): boolean {
  if (meta.reportError) return true;
  if (error instanceof ApiError) {
    if (error.status === 0) return true;
    if (error.status >= 500) return true;
  }
  return false;
}

function reportFromReactQuery(
  error: unknown,
  scope: 'mutation' | 'query',
  meta: ErrorAuditMeta,
  extras: { intent?: AuditIntent; context?: Record<string, AuditPrimitive> } = {},
): void {
  reportUserFacingError({
    error,
    handled: true,
    feature: meta.feature,
    operation: meta.operation ?? (scope === 'mutation' ? 'mutation' : 'query'),
    scenario: meta.scenario,
    entity:
      meta.entityType || meta.entityId
        ? { type: meta.entityType, id: meta.entityId }
        : undefined,
    meta: { source: `react_query.${scope}` },
    intent: extras.intent,
    context: extras.context,
  });
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const meta = readErrorMeta(query.meta);
      if (!shouldReportQueryError(error, meta)) return;
      reportFromReactQuery(error, 'query', meta);
    },
  }),
  mutationCache: new MutationCache({
    onMutate: (_variables, mutation) => {
      snapshots.set(mutation, { context: currentAuditContext(), startedAt: Date.now() });
    },
    onSuccess: (_data, variables, _context, mutation) => {
      const meta = readErrorMeta(mutation.meta);
      const snapshot = snapshots.get(mutation);
      snapshots.delete(mutation);
      if (!meta.operation) return;
      trackAction({
        operation: meta.operation,
        feature: meta.feature,
        outcome: 'success',
        entityType: meta.entityType,
        entityId: meta.entityId,
        durationMs: snapshot ? Date.now() - snapshot.startedAt : undefined,
        intent: buildIntent(meta, variables),
        context: snapshot?.context,
      });
    },
    onError: (error, variables, _context, mutation) => {
      const meta = readErrorMeta(mutation.meta);
      const snapshot = snapshots.get(mutation);
      snapshots.delete(mutation);
      reportFromReactQuery(error, 'mutation', meta, {
        intent: buildIntent(meta, variables),
        context: snapshot?.context,
      });
    },
  }),
  defaultOptions: {
    queries: { staleTime: 5000, retry: 2 },
  },
});

/** Prevent cached tenant data from crossing an authentication boundary. */
export function clearSessionQueryCache() {
  queryClient.clear();
}
