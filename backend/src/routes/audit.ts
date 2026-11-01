import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { emitAuditEvent } from '../lib/audit/emit-audit-event.js';
import {
  describeNavigation,
  describePageView,
  describeSearch,
  describeSelection,
  describeUiAction,
  describeUiError,
  describeWebVital,
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

/** Only telemetry keys produced by the client tracker are retained. */
function safeUiMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> {
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
  if (kind === 'unhandledrejection') out.kind = kind;
  const sinceLastMs = meta.sinceLastMs;
  if (typeof sinceLastMs === 'number' && Number.isInteger(sinceLastMs) && sinceLastMs >= 0 && sinceLastMs <= 86_400_000) {
    out.sinceLastMs = sinceLastMs;
  }
  const option = typeof meta.option === 'string' ? safeUiText(meta.option, 80) : undefined;
  if (option) out.option = option;
  return out;
}

type UiEvent = z.infer<typeof uiEventSchema>;

function describeUiEvent(event: UiEvent, label: string, page: string, screen: string, option: string | undefined): string {
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
      return describeUiError(screen, safeUiText(event.error?.message, 500) ?? label);
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

      if (event.type === 'http_request' && event.http) {
        const outcome = event.http.outcome === 'success' ? 'success' : 'failure';
        const route = safeUiPath(event.http.route);
        emit({
          action: 'http.request.completed',
          message: `Requisição frontend ${event.http.method} ${route}: ${event.http.outcome}`,
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

      emit({
        action: `ui.${event.type}`,
        interactionId: event.interactionId,
        message: describeUiEvent(event, label, page, screen, option),
        outcome: event.type === 'error' ? 'failure' : 'success',
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
        },
      });
    }

    return reply.status(204).send();
  });
}
