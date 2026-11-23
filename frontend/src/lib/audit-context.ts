/**
 * Functional context attached to every audit event (TAP-179 / TAP-188).
 *
 * `context` answers "where was the operator" (comanda, mesa, cliente, status,
 * totals, contact) and `intent` answers "what were they trying to do".
 * Secrets (senha/token), cartão e texto livre (observação/motivo) continuam
 * proibidos no backend; telefone, e-mail e documento do cliente são permitidos.
 */
export type AuditPrimitive = string | number | boolean;
export type AuditContext = Record<string, AuditPrimitive | null | undefined>;
export type AuditIntentItem = Record<string, AuditPrimitive | null | undefined>;
export type AuditIntent = {
  /** Human sentence in PT, e.g. "Incluir 2x Chopp Pilsen 300ml". */
  summary: string;
  [key: string]: AuditPrimitive | AuditIntentItem[] | null | undefined;
};

const MAX_ITEMS = 30;

type Entry = { token: symbol; context: AuditContext };
const stack: Entry[] = [];

function compactContext(context: AuditContext): Record<string, AuditPrimitive> {
  const out: Record<string, AuditPrimitive> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    out[key] = value;
  }
  return out;
}

/** Registers a screen context; returns the remover. Later pushes override earlier keys. */
export function pushAuditContext(context: AuditContext): () => void {
  const token = Symbol('audit-context');
  stack.push({ token, context });
  return () => {
    const index = stack.findIndex((entry) => entry.token === token);
    if (index >= 0) stack.splice(index, 1);
  };
}

export function currentAuditContext(): Record<string, AuditPrimitive> | undefined {
  if (stack.length === 0) return undefined;
  const merged = compactContext(Object.assign({}, ...stack.map((entry) => entry.context)));
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Test hook: drops every registered context. */
export function resetAuditContext(): void {
  stack.length = 0;
}

export function compactIntent(intent: AuditIntent | undefined): AuditIntent | undefined {
  if (!intent?.summary?.trim()) return undefined;
  const out: AuditIntent = { summary: intent.summary.trim() };
  for (const [key, value] of Object.entries(intent)) {
    if (key === 'summary' || value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      out[key] = value.slice(0, MAX_ITEMS).map((item) => compactContext(item));
    } else if (typeof value !== 'number' || Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

type ComandaAuditCliente = {
  id: string;
  nome: string;
  telefone?: string | null;
  email?: string | null;
  documento?: string | null;
};

type ComandaAuditSource = {
  id: string;
  numero?: number | null;
  tipo?: string | null;
  identificador?: string | null;
  status?: string | null;
  pontoVendaId?: string | null;
  subtotal?: number | null;
  desconto?: number | null;
  total?: number | null;
  valorEmAberto?: number | null;
  cliente?: ComandaAuditCliente | null;
  itensQtd?: number | null;
};

function digitsOnly(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const digits = value.replace(/\D/g, '');
  return digits || undefined;
}

function rotuloClienteAudit(cliente: ComandaAuditCliente | null | undefined): string | undefined {
  if (!cliente?.nome?.trim()) return undefined;
  const tel = digitsOnly(cliente.telefone);
  return tel ? `cliente ${cliente.nome} (tel ${tel})` : `cliente ${cliente.nome}`;
}

function rotuloAuditComanda(comanda: ComandaAuditSource): string {
  const numero = comanda.numero != null ? `Comanda #${comanda.numero}` : 'Comanda';
  const identificador = comanda.identificador?.trim();
  const local =
    comanda.tipo === 'MESA' && identificador
      ? `Mesa ${identificador}`
      : comanda.tipo === 'FICHA' && identificador
        ? `Ficha ${identificador}`
        : identificador || undefined;
  return [numero, local, rotuloClienteAudit(comanda.cliente)].filter(Boolean).join(' · ');
}

/** Standard comanda context so every screen reports the same keys. */
export function comandaAuditContext(comanda: ComandaAuditSource | null | undefined, comandaId?: string): AuditContext {
  if (!comanda) return comandaId ? { comandaId } : {};
  const telefone = digitsOnly(comanda.cliente?.telefone);
  const email = comanda.cliente?.email?.trim() || undefined;
  const documento = digitsOnly(comanda.cliente?.documento);
  return {
    resumo: rotuloAuditComanda(comanda),
    comandaId: comanda.id,
    comandaNumero: comanda.numero ?? undefined,
    comandaTipo: comanda.tipo ?? undefined,
    comandaIdentificador: comanda.identificador ?? undefined,
    comandaStatus: comanda.status ?? undefined,
    pontoVendaId: comanda.pontoVendaId ?? undefined,
    subtotal: comanda.subtotal ?? undefined,
    desconto: comanda.desconto ?? undefined,
    total: comanda.total ?? undefined,
    valorEmAberto: comanda.valorEmAberto ?? undefined,
    itensQtd: comanda.itensQtd ?? undefined,
    clienteId: comanda.cliente?.id,
    clienteNome: comanda.cliente?.nome,
    ...(telefone ? { clienteTelefone: telefone } : {}),
    ...(email ? { clienteEmail: email } : {}),
    ...(documento ? { clienteDocumento: documento } : {}),
  };
}

export function formatAuditMoney(value: number | null | undefined): string | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}
