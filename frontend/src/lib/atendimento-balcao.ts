import { playAlertaAgora } from './pedido-alert';

const PREF_KEY = 'quiver:balcao-alerta';
const PENDING_KEY = 'quiver:balcao-pendentes';

export type AtendimentoBalcaoEvento = {
  comandaId: string;
  pedidoIds: string[];
  clienteNome: string | null;
  comandaNumero: number | null;
  comandaIdentificador: string | null;
  itens: Array<{
    nome: string;
    quantidade: number;
    volumeMl: number | null;
  }>;
};

const listeners = new Set<() => void>();
const avisados = new Set<string>();

function notify() {
  for (const listener of listeners) listener();
}

function lerPendentes(): Record<string, AtendimentoBalcaoEvento> {
  if (typeof sessionStorage === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, AtendimentoBalcaoEvento>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function gravarPendentes(map: Record<string, AtendimentoBalcaoEvento>) {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(map));
  notify();
}

/** Preferência opt-out: som ligado por padrão no balcão. */
export function isBalcaoAlertaEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(PREF_KEY) !== '0';
}

export function setBalcaoAlertaEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  if (enabled) localStorage.removeItem(PREF_KEY);
  else localStorage.setItem(PREF_KEY, '0');
}

export function listAtendimentosBalcaoPendentes(): AtendimentoBalcaoEvento[] {
  return Object.values(lerPendentes());
}

export function getAtendimentoBalcaoPendente(comandaId: string): AtendimentoBalcaoEvento | null {
  return lerPendentes()[comandaId] ?? null;
}

export function temAtendimentoBalcaoPendente(comandaId: string): boolean {
  return Boolean(lerPendentes()[comandaId]);
}

export function subscribeAtendimentoBalcao(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function chavePedidos(pedidoIds: string[]): string {
  return [...pedidoIds].sort().join(',');
}

/** Registra pedido do portal e toca alerta uma vez por conjunto de pedidos. */
export function registrarAtendimentoBalcao(evento: AtendimentoBalcaoEvento): void {
  if (!evento.comandaId || !Array.isArray(evento.pedidoIds) || evento.pedidoIds.length === 0) return;
  if (!Array.isArray(evento.itens) || evento.itens.length === 0) return;

  const pendentes = lerPendentes();
  const anterior = pendentes[evento.comandaId];
  const pedidoIds = [...new Set([...(anterior?.pedidoIds ?? []), ...evento.pedidoIds])];
  const itens = [...(anterior?.itens ?? []), ...evento.itens];
  pendentes[evento.comandaId] = {
    ...evento,
    pedidoIds,
    itens,
  };
  gravarPendentes(pendentes);

  const chave = chavePedidos(evento.pedidoIds);
  if (avisados.has(chave)) return;
  avisados.add(chave);
  if (isBalcaoAlertaEnabled()) {
    void playAlertaAgora();
  }
}

export function limparAtendimentoBalcao(comandaId: string): void {
  const pendentes = lerPendentes();
  if (!pendentes[comandaId]) return;
  delete pendentes[comandaId];
  gravarPendentes(pendentes);
}

export function resumoItensBalcao(itens: AtendimentoBalcaoEvento['itens']): string {
  return itens
    .map((item) => {
      const volume = item.volumeMl && item.volumeMl > 1 ? ` ${item.volumeMl} ml` : '';
      return `${item.quantidade}× ${item.nome}${volume}`;
    })
    .join(', ');
}
