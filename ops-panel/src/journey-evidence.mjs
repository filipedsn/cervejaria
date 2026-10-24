const SAFE_KEYS = new Set(['id', 'cervejariaId', 'usuarioId', 'operadorId', 'clienteId', 'comandaId', 'pedidoId', 'produtoId', 'opcionalId', 'eventoId', 'pontoVendaId', 'sessaoCaixaId', 'tapId', 'quantidade', 'volumeMl', 'valor', 'total', 'desconto', 'preco', 'trocoInicial', 'valorRecebido', 'valorCorrigido', 'divergenciaCentavos', 'ativo', 'paraViagem', 'itens', 'opcionais', 'pagamentos', 'forma', 'status', 'tipo', 'operacao', 'papel']);

/** Reapply a field policy even to historical records written before TAP-96. */
export function safeJourneyPayload(metadata) {
  let parsed;
  try { parsed = typeof metadata === 'string' ? JSON.parse(metadata) : metadata; } catch { return undefined; }
  const source = parsed?.requestBody ?? parsed?.payload;
  if (!source || typeof source !== 'object') return undefined;
  let budget = 200;
  function visit(value, key, depth) {
    if (depth > 6 || budget-- <= 0) return '[TRUNCATED]';
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') {
      const pattern = /(?:Id|^id)$/.test(key) ? /^[A-Za-z0-9_-]{1,100}$/ : /^[A-Z][A-Z0-9_]{0,63}$/;
      return pattern.test(value) ? value : undefined;
    }
    if (Array.isArray(value)) return value.slice(0, 20).map(item => visit(item, key, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => SAFE_KEYS.has(k)).map(([k, v]) => [k, visit(v, k, depth + 1)]).filter(([, v]) => v !== undefined));
    return undefined;
  }
  return visit(source, '', 0);
}
