import { ApiError } from './api';
import { trackUiError } from './audit-tracker';

export type UserFacingErrorKind =
  | 'network'
  | 'api_client'
  | 'api_server'
  | 'validation'
  | 'ui_bug'
  | 'unknown';

export type UserFacingErrorEntity = {
  type?: string;
  id?: string;
};

export type ReportUserFacingErrorInput = {
  error: unknown;
  /** Stable feature key, e.g. operacao.comanda.detail */
  feature?: string;
  /** Stable operation verb, e.g. comanda.close */
  operation?: string;
  /** Override auto scenario code */
  scenario?: string;
  entity?: UserFacingErrorEntity;
  meta?: Record<string, unknown>;
  /** Defaults to true (treated in UI). Crashes/boundary pass false. */
  handled?: boolean;
  /** ui.label override; defaults to operation or feature or frontend_error */
  label?: string;
};

export type ClassifiedUserFacingError = {
  kind: UserFacingErrorKind;
  scenario: string;
  message: string;
  errorName?: string;
  stack?: string;
  httpStatus?: number;
  apiCode?: string;
  correlationId?: string;
  requestId?: string;
};

function apiCodeFromBody(body: Record<string, unknown> | undefined): string | undefined {
  if (!body) return undefined;
  const code = body.code;
  return typeof code === 'string' && code.trim() ? code.trim().slice(0, 120) : undefined;
}

/** Classifies a thrown value into semantic kind + scenario for Kibana. */
export function classifyUserFacingError(error: unknown): ClassifiedUserFacingError {
  if (error instanceof ApiError) {
    const apiCode = apiCodeFromBody(error.body);
    const httpStatus = error.status;
    const message = error.message || `Erro na requisição (${httpStatus || 0})`;

    if (httpStatus === 0) {
      return {
        kind: 'network',
        scenario: 'network_unreachable',
        message,
        errorName: error.name,
        stack: error.stack,
        httpStatus,
        apiCode,
        correlationId: error.correlationId,
        requestId: error.requestId,
      };
    }

    if (httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
      return {
        kind: 'api_server',
        scenario: 'server_unavailable',
        message,
        errorName: error.name,
        stack: error.stack,
        httpStatus,
        apiCode,
        correlationId: error.correlationId,
        requestId: error.requestId,
      };
    }

    if (httpStatus >= 500) {
      return {
        kind: 'api_server',
        scenario: apiCode ? `api_${apiCode.toLowerCase()}` : 'api_server_error',
        message,
        errorName: error.name,
        stack: error.stack,
        httpStatus,
        apiCode,
        correlationId: error.correlationId,
        requestId: error.requestId,
      };
    }

    if (httpStatus === 400 || httpStatus === 422 || apiCode) {
      return {
        kind: 'validation',
        scenario: apiCode ? `validation_${apiCode.toLowerCase()}` : 'validation_rejected',
        message,
        errorName: error.name,
        stack: error.stack,
        httpStatus,
        apiCode,
        correlationId: error.correlationId,
        requestId: error.requestId,
      };
    }

    if (httpStatus >= 400 && httpStatus < 500) {
      return {
        kind: 'api_client',
        scenario: httpStatus === 401 || httpStatus === 403 ? 'auth_rejected' : 'api_client_error',
        message,
        errorName: error.name,
        stack: error.stack,
        httpStatus,
        apiCode,
        correlationId: error.correlationId,
        requestId: error.requestId,
      };
    }
  }

  if (error instanceof Error) {
    const name = error.name;
    if (name === 'TypeError' || name === 'ReferenceError') {
      return {
        kind: 'ui_bug',
        scenario: 'ui_exception',
        message: error.message || name,
        errorName: name,
        stack: error.stack,
      };
    }
    if (name === 'AbortError') {
      return {
        kind: 'network',
        scenario: 'request_aborted',
        message: error.message || 'Requisição cancelada',
        errorName: name,
        stack: error.stack,
      };
    }
    if (name === 'TimeoutError') {
      return {
        kind: 'network',
        scenario: 'request_timeout',
        message: error.message || 'Tempo esgotado',
        errorName: name,
        stack: error.stack,
      };
    }
    return {
      kind: 'unknown',
      scenario: 'unknown_error',
      message: error.message || name || 'Erro desconhecido',
      errorName: name,
      stack: error.stack,
    };
  }

  return {
    kind: 'unknown',
    scenario: 'unknown_error',
    message: typeof error === 'string' && error.trim() ? error.trim() : 'Erro desconhecido',
  };
}

/**
 * Emits a semantic ui.error for any message shown to the user.
 * Prefer this over raw trackUiError for treated failures.
 */
export function reportUserFacingError(input: ReportUserFacingErrorInput): ClassifiedUserFacingError {
  const classified = classifyUserFacingError(input.error);
  const handled = input.handled !== false;
  const scenario = input.scenario ?? classified.scenario;
  const label = input.label ?? input.operation ?? input.feature ?? 'frontend_error';

  trackUiError(classified.message, classified.stack, {
    handled,
    kind: classified.kind,
    feature: input.feature,
    operation: input.operation,
    scenario,
    ...(classified.httpStatus != null ? { httpStatus: classified.httpStatus } : {}),
    ...(classified.apiCode ? { apiCode: classified.apiCode } : {}),
    ...(input.entity?.type ? { entityType: input.entity.type } : {}),
    ...(input.entity?.id ? { entityId: input.entity.id } : {}),
    ...(classified.correlationId ? { correlationId: classified.correlationId } : {}),
    ...(classified.requestId ? { requestId: classified.requestId } : {}),
    ...input.meta,
  }, classified.errorName, label);

  return { ...classified, scenario };
}

/** Report then set local React error state (non-React-Query call sites). */
export function reportAndSetError(
  setter: (message: string) => void,
  error: unknown,
  ctx: Omit<ReportUserFacingErrorInput, 'error'>,
  fallbackMessage = 'Não foi possível concluir a operação.',
): ClassifiedUserFacingError {
  const classified = reportUserFacingError({ ...ctx, error });
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error && error.message
        ? error.message
        : fallbackMessage;
  setter(message);
  return classified;
}
