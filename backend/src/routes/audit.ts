import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { emitAuditEvent } from '../lib/audit/emit-audit-event.js';
import {
  describeNavigation,
  describePageView,
  describeSearch,
  describeSelection,
  describeUiAction,
  describeUiActionResult,
  describeUiError,
  describeWebVital,
  withFunctionalScope,
} from '../lib/audit/describe.js';
import { verifySession } from '../lib/session.js';
import { verifyClienteSession } from '../lib/cliente-session.js';
import type { ClienteSessionPayload, PdvClienteSessionPayload } from '../types/cliente-session.js';
import { validCorrelationId } from '../lib/correlation-context.js';
import { verifyPdvClienteSession } from '../lib/pdv-client-session.js';
import {
  getTelemetryContextOrDefault,
  publicPortalKind,
  resolveTelemetryFromClienteSession,
  runWithTelemetryContext,
  type TelemetryContext,
} from '../lib/telemetry-context.js';

function safeHttpText(value: string): boolean {
  return !/[\u0000-\u001F\u007F]/.test(value);
}

const httpTelemetrySchema = z.object({
  method: z.string().min(1).max(10).refine(safeHttpText, 'Método inválido'),
  route: z.string().min(1).max(500).refine(safeHttpText, 'Rota inválida'),
  statusCode: z.number().int().min(100).max(599).optional(),
  durationMs: z.number().finite().min(0).max(300_000),
  outcome: z.enum(['success', 'client_error', 'server_error', 'network_error', 'aborted', 'timeout', 'invalid_response']),
  correlationId: z.string().refine(validCorrelationId, 'Correlation ID inválido'),
  requestId: z.string().min(1).max(200).refine(safeHttpText, 'Request ID inválido').optional(),
  interactionId: z.string().refine(validCorrelationId).optional(),
});

const vitalSchema = z.object({
  name: z.enum(['LCP', 'INP', 'CLS', 'TTFB', 'FCP']),
  value: z.number().finite().min(0).max(600_000),
  rating: z.enum(['good', 'needs-improvement', 'poor']).optional(),
});

const uiErrorSchema = z.object({
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  name: z.string().max(100).optional(),
});

const uiEventSchema = z.object({
  type: z.enum(['click', 'page_view', 'submit', 'error', 'http_request', 'search', 'web_vital', 'navigation']),
  page: z.string().min(1).max(500),
  route: z.string().max(300).optional(),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Sessão inválida').optional(),
  element: z.string().max(200).optional(),
  label: z.string().max(300).optional(),
  search: z.string().max(200).optional(),
  vitals: vitalSchema.optional(),
  error: uiErrorSchema.optional(),
  viewport: z.object({ w: z.number().int().min(0).max(20_000), h: z.number().int().min(0).max(20_000) }).optional(),
  timestamp: z.string().datetime().optional(),
  interactionId: z.string().refine(validCorrelationId).optional(),
  meta: z.record(z.unknown()).optional(),
  http: httpTelemetrySchema.optional(),
  context: z.record(z.unknown()).optional(),
  intent: z.record(z.unknown()).optional(),
});

const bodySchema = z.object({
  events: z.array(uiEventSchema).min(1).max(50),
});

type ClienteAuditSession = ClienteSessionPayload | PdvClienteSessionPayload;
type ClienteSessionKind = 'legacy' | 'pdv';

function safeUiPath(value: string): string {
  const path = value.trim().split(/[?#]/, 1)[0] ?? '';
  return path.startsWith('/') ? path : '/unknown';
}

const REDACTED = '[REDACTED]';

/** Card-like digit runs and long mixed tokens never leave the browser text intact. */
function redactSensitiveSequences(value: string): string {
  return value
    .replace(/[A-Za-z0-9_-]{32,}/g, (match) => (/\d/.test(match) && /[A-Za-z]/.test(match) ? REDACTED : match))
    .replace(/\d(?:[ .-]?\d){12,18}/g, REDACTED);
}

export function safeUiText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = redactSensitiveSequences(value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim());
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function safeMultilineText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = redactSensitiveSequences(value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim());
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function safeUiLabel(value: string | undefined): string | undefined {
  return safeUiText(value, 120);
}

function safeUserAgent(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 512) : undefined;
}

type AuditRouteDependencies = {
  verifyStaff(app: FastifyInstance, request: FastifyRequest): Promise<unknown>;
  verifyLegacyCliente(app: FastifyInstance, request: FastifyRequest): Promise<ClienteSessionPayload>;
  verifyPdvCliente(app: FastifyInstance, request: FastifyRequest): Promise<PdvClienteSessionPayload>;
  resolveClienteContext(request: FastifyRequest, session: ClienteAuditSession): Promise<TelemetryContext>;
  getStaffContext(): TelemetryContext;
  emit(event: Parameters<typeof emitAuditEvent>[0]): void;
};

const defaultDependencies: AuditRouteDependencies = {
  verifyStaff: verifySession,
  verifyLegacyCliente: verifyClienteSession,
  verifyPdvCliente: verifyPdvClienteSession,
  resolveClienteContext: resolveTelemetryFromClienteSession,
  getStaffContext: getTelemetryContextOrDefault,
  emit: emitAuditEvent,
};

export type AuditRouteTestOptions = { dependencies?: Partial<AuditRouteDependencies> };

const UI_ERROR_KINDS = new Set([
  'unhandledrejection',
  'network',
  'api_client',
  'api_server',
  'validation',
  'ui_bug',
  'unknown',
]);

function safeSemanticKey(value: unknown, max = 80): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim().toLowerCase();
  if (!cleaned || cleaned.length > max) return undefined;
  if (!/^[a-z][a-z0-9._-]{0,79}$/.test(cleaned)) return undefined;
  return cleaned;
}

/** Only telemetry keys produced by the client tracker are retained. */
export function safeUiMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  const releaseSha = meta.frontendReleaseSha;
  if (typeof releaseSha === 'string' && /^[a-f0-9]{7,40}$/i.test(releaseSha)) out.frontendReleaseSha = releaseSha;
  const tag = meta.tag;
  if (typeof tag === 'string' && /^[a-z][a-z0-9-]{0,31}$/i.test(tag)) out.tag = tag.toLowerCase();
  const source = meta.source;
  if (typeof source === 'string' && source.length <= 500 && !/[?@]/.test(source)) out.source = safeUiPath(source);
  const line = meta.line;
  if (typeof line === 'number' && Number.isInteger(line) && line > 0 && line <= 10_000_000) out.line = line;
  const kind = meta.kind;
  if (typeof kind === 'string' && UI_ERROR_KINDS.has(kind)) out.kind = kind;
  if (typeof meta.handled === 'boolean') out.handled = meta.handled;
  const feature = safeSemanticKey(meta.feature);
  if (feature) out.feature = feature;
  const operation = safeSemanticKey(meta.operation);
  if (operation) out.operation = operation;
  const scenario = safeSemanticKey(meta.scenario);
  if (scenario) out.scenario = scenario;
  const httpStatus = meta.httpStatus;
  if (typeof httpStatus === 'number' && Number.isInteger(httpStatus) && httpStatus >= 0 && httpStatus <= 599) {
    out.httpStatus = httpStatus;
  }
  const apiCode = typeof meta.apiCode === 'string' ? safeUiText(meta.apiCode, 120) : undefined;
  if (apiCode) out.apiCode = apiCode;
  const entityType = safeSemanticKey(meta.entityType, 40);
  if (entityType) out.entityType = entityType;
  const entityId = typeof meta.entityId === 'string' ? safeUiText(meta.entityId, 80) : undefined;
  if (entityId) out.entityId = entityId;
  if (meta.boundary === true) out.boundary = true;
  const componentStack =
    typeof meta.componentStack === 'string' ? safeMultilineText(meta.componentStack, 1500) : undefined;
  if (componentStack) out.componentStack = componentStack;
  if (typeof meta.correlationId === 'string' && validCorrelationId(meta.correlationId)) {
    out.correlationId = meta.correlationId;
  }
  if (typeof meta.requestId === 'string') {
    const requestId = safeUiText(meta.requestId, 200);
    if (requestId) out.requestId = requestId;
  }
  const sinceLastMs = meta.sinceLastMs;
  if (typeof sinceLastMs === 'number' && Number.isInteger(sinceLastMs) && sinceLastMs >= 0 && sinceLastMs <= 86_400_000) {
    out.sinceLastMs = sinceLastMs;
  }
  const option = typeof meta.option === 'string' ? safeUiText(meta.option, 80) : undefined;
  if (option) out.option = option;
  if (meta.actionOutcome === 'success' || meta.actionOutcome === 'failure') out.actionOutcome = meta.actionOutcome;
  const durationMs = meta.durationMs;
  if (typeof durationMs === 'number' && Number.isInteger(durationMs) && durationMs >= 0 && durationMs <= 600_000) {
    out.durationMs = durationMs;
  }
  return out;
}

const FUNCTIONAL_KEY = /^[a-z][a-zA-Z0-9]{0,39}$/;
/** Contact data and typed free text never belong in functional context. */
const FORBIDDEN_FUNCTIONAL_KEY =
  /senha|password|token|secret|cpf|cnpj|numerocartao|cardnumber|creditcard|cvv|cvc|telefone|phone|email|endereco|address|^observac|^motivo/i;
const MAX_FUNCTIONAL_KEYS = 30;
const MAX_INTENT_ITEMS = 30;
const MAX_ITEM_KEYS = 15;

type FunctionalPrimitive = string | number | boolean;

function safeFunctionalPrimitive(value: unknown, maxLength = 200): FunctionalPrimitive | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : undefined;
  if (typeof value === 'string') return safeUiText(value, maxLength);
  return undefined;
}

function safeFunctionalKey(key: string): boolean {
  return FUNCTIONAL_KEY.test(key) && !FORBIDDEN_FUNCTIONAL_KEY.test(key);
}

function safeFlatRecord(raw: unknown, maxKeys: number): Record<string, FunctionalPrimitive> {
  const out: Record<string, FunctionalPrimitive> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= maxKeys) break;
    if (!safeFunctionalKey(key)) continue;
    const safe = safeFunctionalPrimitive(value);
    if (safe !== undefined) out[key] = safe;
  }
  return out;
}

/** Where the operator was: comanda, mesa, cliente, totals (flat primitives only). */
export function safeFunctionalContext(raw: Record<string, unknown> | undefined): Record<string, FunctionalPrimitive> | undefined {
  const out = safeFlatRecord(raw, MAX_FUNCTIONAL_KEYS);
  if (typeof out.tela === 'string' && !/^[a-z][a-z0-9._-]{0,79}$/.test(out.tela)) delete out.tela;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** What the operator wanted: a PT summary plus primitives and flat item lists. */
export function safeFunctionalIntent(raw: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const summary = typeof raw.summary === 'string' ? safeUiText(raw.summary, 500) : undefined;
  if (!summary) return undefined;
  const out: Record<string, unknown> = { summary };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'summary' || !safeFunctionalKey(key)) continue;
    if (Object.keys(out).length > MAX_FUNCTIONAL_KEYS) break;
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_INTENT_ITEMS)
        .map((item) => safeFlatRecord(item, MAX_ITEM_KEYS))
        .filter((item) => Object.keys(item).length > 0);
      if (items.length > 0) out[key] = items;
      continue;
    }
    const safe = safeFunctionalPrimitive(value);
    if (safe !== undefined) out[key] = safe;
  }
  return out;
}

type UiEvent = z.infer<typeof uiEventSchema>;

function describeUiEvent(
  event: UiEvent,
  label: string,
  page: string,
  screen: string,
  option: string | undefined,
  functional: { intentSummary?: string; actionOutcome?: 'success' | 'failure' } = {},
): string {
  switch (event.type) {
    case 'page_view':
      return describePageView(page);
    case 'navigation':
      return describeNavigation(screen);
    case 'search':
      return describeSearch(safeUiText(event.search, 200) ?? label, screen);
    case 'web_vital':
      return event.vitals
        ? describeWebVital(event.vitals.name, event.vitals.value, event.vitals.rating, screen)
        : describeUiAction(label, page);
    case 'error':
      return describeUiError(screen, safeUiText(event.error?.message, 500) ?? label, functional.intentSummary);
    case 'submit':
      if (functional.intentSummary && functional.actionOutcome) {
        return describeUiActionResult(functional.intentSummary, screen, functional.actionOutcome);
      }
      return describeUiAction(label, page);
    default:
      return option && label.startsWith('select:')
        ? describeSelection(label.slice('select:'.length), option, page)
        : describeUiAction(label, page);
  }
}

export async function auditRoutes(app: FastifyInstance, options: AuditRouteTestOptions = {}) {
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  app.post('/events', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    const events = parsed.success ? parsed.data.events : [];
    const publicKinds = new Set(
      events
        .map((event) => publicPortalKind(event.page))
        .filter((kind): kind is ClienteSessionKind => kind !== undefined),
    );
    const customerSessions = new Map<ClienteSessionKind, ClienteAuditSession>();

    const validateCustomerSession = async (kind: ClienteSessionKind) => {
      try {
        const session = kind === 'pdv'
          ? await dependencies.verifyPdvCliente(app, request)
          : await dependencies.verifyLegacyCliente(app, request);
        customerSessions.set(kind, session);
        return true;
      } catch {
        return false;
      }
    };

    for (const kind of publicKinds) {
      if (!(await validateCustomerSession(kind))) {
        return reply.status(401).send({ error: 'Não autorizado' });
      }
    }

    let staff = false;
    const hasNonPublicEvents = events.some((event) => !publicPortalKind(event.page));
    if (publicKinds.size === 0 || hasNonPublicEvents) {
      try {
        await dependencies.verifyStaff(app, request);
        staff = true;
      } catch {
        if (publicKinds.size > 0) {
          return reply.status(401).send({ error: 'Não autorizado' });
        }
        if (publicKinds.size === 0 && customerSessions.size === 0) {
          if (!(await validateCustomerSession('legacy')) && !(await validateCustomerSession('pdv'))) {
            return reply.status(401).send({ error: 'Não autorizado' });
          }
        } else if (customerSessions.size === 0) {
          return reply.status(401).send({ error: 'Não autorizado' });
        }
      }
    }

    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0]?.message ?? 'Payload inválido' });
    }

    const userAgent = safeUserAgent(request.headers['user-agent']);

    for (const event of events) {
      const client = {
        ...(event.sessionId ? { sessionId: event.sessionId } : {}),
        ...(userAgent ? { userAgent } : {}),
      };
      const customerKind = publicPortalKind(event.page);
      const customerSession = customerKind
        ? customerSessions.get(customerKind)
        : !staff && customerSessions.size === 1
          ? customerSessions.values().next().value
          : undefined;
      if (!staff && !customerSession) {
        return reply.status(401).send({ error: 'Não autorizado' });
      }
      const context = customerSession
        ? await dependencies.resolveClienteContext(request, customerSession)
        : dependencies.getStaffContext();
      const source = customerSession ? 'cliente' : 'staff';
      const emit = (input: Parameters<typeof emitAuditEvent>[0]) =>
        runWithTelemetryContext(context, () => dependencies.emit(input));
      const functionalContext = safeFunctionalContext(event.context);
      const functionalIntent = safeFunctionalIntent(event.intent);
      const functionalScope = typeof functionalContext?.resumo === 'string' ? functionalContext.resumo : undefined;
      const functionalMetadata = {
        ...(functionalContext ? { context: functionalContext } : {}),
        ...(functionalIntent ? { intent: functionalIntent } : {}),
      };

      if (event.type === 'http_request' && event.http) {
        const outcome = event.http.outcome === 'success' ? 'success' : 'failure';
        const route = safeUiPath(event.http.route);
        emit({
          action: 'http.request.completed',
          message: withFunctionalScope(
            `Requisição frontend ${event.http.method} ${route}: ${event.http.outcome}`,
            functionalScope,
          ),
          outcome,
          http: {
            method: event.http.method,
            route,
            statusCode: event.http.statusCode,
          },
          correlationId: event.http.correlationId,
          requestId: event.http.requestId,
          interactionId: event.http.interactionId,
          client,
          metadata: {
            source,
            durationMs: event.http.durationMs,
            outcome: event.http.outcome,
            clientTimestamp: event.timestamp,
            identitySource: 'authenticated_batch_session',
            ...functionalMetadata,
          },
        });
        continue;
      }

      const label = safeUiLabel(event.label ?? event.element ?? event.type) ?? event.type;
      const page = safeUiPath(event.page);
      const route = event.route !== undefined && safeHttpText(event.route) ? safeUiPath(event.route) : undefined;
      const screen = route ?? page;
      const metadata = safeUiMetadata(event.meta);
      const option = typeof metadata.option === 'string' ? metadata.option : undefined;
      const searchTerm = event.type === 'search' ? safeUiText(event.search, 200) : undefined;
      const errorMessage = safeUiText(event.error?.message, 500);
      const correlationId =
        typeof metadata.correlationId === 'string' && validCorrelationId(metadata.correlationId)
          ? metadata.correlationId
          : undefined;
      const requestId = typeof metadata.requestId === 'string' ? metadata.requestId : undefined;
      const contextComandaId =
        typeof functionalContext?.comandaId === 'string' ? safeUiText(functionalContext.comandaId, 80) : undefined;
      const entityType =
        typeof metadata.entityType === 'string' ? metadata.entityType : contextComandaId ? 'comanda' : undefined;
      const entityId =
        typeof metadata.entityId === 'string'
          ? metadata.entityId
          : entityType === 'comanda'
            ? contextComandaId
            : undefined;
      const actionOutcome =
        metadata.actionOutcome === 'success' || metadata.actionOutcome === 'failure' ? metadata.actionOutcome : undefined;
      const intentSummary = typeof functionalIntent?.summary === 'string' ? functionalIntent.summary : undefined;
      const message = withFunctionalScope(
        describeUiEvent(event, label, page, screen, option, { intentSummary, actionOutcome }),
        functionalScope,
      );

      emit({
        action: `ui.${event.type}`,
        interactionId: event.interactionId,
        ...(correlationId ? { correlationId } : {}),
        ...(requestId ? { requestId } : {}),
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        message,
        outcome: event.type === 'error' || actionOutcome === 'failure' ? 'failure' : 'success',
        ui: {
          page,
          element: safeUiLabel(event.element),
          label,
          ...(route ? { route } : {}),
          ...(searchTerm ? { searchTerm } : {}),
          ...(event.viewport ? { viewport: `${event.viewport.w}x${event.viewport.h}` } : {}),
        },
        ...(event.type === 'web_vital' && event.vitals ? { vital: event.vitals } : {}),
        ...(event.type === 'error' && event.error
          ? {
            error: {
              ...(errorMessage ? { message: errorMessage } : {}),
              ...(event.error.stack ? { stackTrace: safeMultilineText(event.error.stack, 4000) } : {}),
              ...(event.error.name ? { type: safeUiText(event.error.name, 100) } : {}),
            },
          }
          : {}),
        client,
        metadata: {
          source,
          clientTimestamp: event.timestamp,
          identitySource: 'authenticated_batch_session',
          ...metadata,
          ...functionalMetadata,
        },
      });
    }

    return reply.status(204).send();
  });
}
