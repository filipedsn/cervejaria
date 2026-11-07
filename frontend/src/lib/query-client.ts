import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { reportUserFacingError } from './report-user-facing-error';

type ErrorAuditMeta = {
  /** Force audit for query failures that would otherwise stay silent. */
  reportError?: boolean;
  feature?: string;
  operation?: string;
  scenario?: string;
  entityType?: string;
  entityId?: string;
};

function readErrorMeta(meta: unknown): ErrorAuditMeta {
  if (!meta || typeof meta !== 'object') return {};
  return meta as ErrorAuditMeta;
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
    onError: (error, _variables, _context, mutation) => {
      const meta = readErrorMeta(mutation.meta);
      reportFromReactQuery(error, 'mutation', meta);
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
