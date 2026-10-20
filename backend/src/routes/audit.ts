import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { emitAuditEvent } from '../lib/audit/emit-audit-event.js';
import { describePageView, describeUiAction } from '../lib/audit/describe.js';
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
  outcome: z.enum(['success', 'client_error', 'server_error', 'network_error', 'aborted', 'timeout']),
  correlationId: z.string().refine(validCorrelationId, 'Correlation ID inválido'),
  requestId: z.string().min(1).max(200).refine(safeHttpText, 'Request ID inválido').optional(),
});

const uiEventSchema = z.object({
  type: z.enum(['click', 'page_view', 'submit', 'error', 'http_request']),
  page: z.string().min(1).max(500),
  element: z.string().max(200).optional(),
  label: z.string().max(300).optional(),
  timestamp: z.string().datetime().optional(),
  meta: z.record(z.unknown()).optional(),
  http: httpTelemetrySchema.optional(),
});

const bodySchema = z.object({
  events: z.array(uiEventSchema).min(1).max(50),
});

type ClienteAuditSession = ClienteSessionPayload | PdvClienteSessionPayload;
type ClienteSessionKind = 'legacy' | 'pdv';

const SAFE_UI_ACTION_LABELS = new Set([
  'comanda-abrir', 'comanda-cancelar', 'comanda-fechar',
  'error-boundary-reload', 'frontend_error',
  'operacao-caixa-abrir', 'operacao-caixa-corrigir', 'operacao-caixa-encerrar-administrativamente',
  'operacao-caixa-fechar', 'operacao-caixa-fechar-confirmar', 'operacao-caixa-sangria',
  'operacao-caixa-suprimento', 'operacao-comanda-cancelar', 'operacao-comanda-fechar',
  'operacao-confirmar-pagamento', 'operacao-cozinha-avancar', 'operacao-cozinha-cancelar',
  'operacao-cozinha-confirmar-cancelamento', 'operacao-estoque-ajustar', 'operacao-estoque-ajuste-confirmar',
  'operacao-estoque-busca', 'operacao-estoque-minimo', 'operacao-estoque-minimo-confirmar',
  'operacao-estoque-repor', 'operacao-estoque-repor-confirmar', 'operacao-estoque-saida',
  'operacao-estoque-saida-confirmar', 'venda-avulsa-pagar',
]);

function safeUiPath(value: string): string {
  const path = value.trim().split(/[?#]/, 1)[0] ?? '';
  return path.startsWith('/') ? path : '/unknown';
}

function safeUiLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return SAFE_UI_ACTION_LABELS.has(value) ? value : 'unclassified-action';
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
  return out;
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

    for (const event of events) {
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
          metadata: {
            source,
            durationMs: event.http.durationMs,
            outcome: event.http.outcome,
          },
        });
        continue;
      }

      const label = safeUiLabel(event.label ?? event.element ?? event.type) ?? 'unclassified-action';
      const page = safeUiPath(event.page);
      const message =
        event.type === 'page_view'
          ? describePageView(page)
          : event.type === 'error'
            ? `Erro na interface: ${label}`
            : describeUiAction(label, page);

      emit({
        action: `ui.${event.type}`,
        message,
        outcome: event.type === 'error' ? 'failure' : 'success',
        ui: {
          page,
          element: safeUiLabel(event.element),
          label,
        },
        metadata: {
          source,
          ...safeUiMetadata(event.meta),
        },
      });
    }

    return reply.status(204).send();
  });
}
