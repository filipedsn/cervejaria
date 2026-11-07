/** HTTP payload policy: retain bounded business structure, never arbitrary text. */
const FIELDS = new Set([
  'id', 'cervejariaId', 'usuarioId', 'operadorId', 'clienteId', 'comandaId', 'pedidoId',
  'produtoId', 'opcionalId', 'eventoId', 'pontoVendaId', 'sessaoCaixaId', 'tapId',
  'cardapioId', 'trailerId', 'ocorrenciaId', 'categoriaPdvId', 'comandaIds', 'produtoIds',
  'quantidade', 'volumeMl', 'valor', 'total', 'desconto', 'preco', 'precoUnit', 'precos',
  'trocoInicial', 'valorRecebido', 'valorCorrigido', 'divergenciaCentavos',
  'contadoDinheiro', 'contadoPix', 'contadoCartaoDebito', 'contadoCartaoCredito',
  'contadoDebito', 'contadoCredito', 'contadoCartao',
  'quantidadeNova', 'estoqueMinimo', 'quantidadeEsperada', 'quantidadeMesas',
  'ordem', 'ativo', 'paraViagem', 'deixarPendente', 'abrirAgora', 'confirmarDataDiferente',
  'temCozinha', 'controlaEstoque', 'confirmacaoEstoque', 'exigePreparo', 'estacaoPreparo', 'prepararEmPedidoSeparado',
  'gamificada', 'usaCardapio', 'exibirKpisComanda', 'comandasColunaUnica',
  'comandasAlarmeAtivo', 'comandasAlarmeIntervaloSegundos',
  'operationMode', 'tapsEnabled', 'inventoryEnabled', 'kitchenEnabled',
  'kitchenItemsChargeAtLaunch', 'allowCloseComandaWithPendingKitchenOrders',
  'barEnabled', 'barItemsChargeAtLaunch', 'allowCloseComandaWithPendingBarOrders',
  'agendaEnabled',
  'whatsappPedidoProntoEnabled', 'whatsappPedidoProntoNaCozinha', 'whatsappPedidoProntoNoBar', 'completeInitialSetup',
  'podeDarDescontoOperacao',
  'itens', 'opcionais', 'pagamentos', 'forma', 'status', 'tipo', 'operacao', 'papel',
  'escopo', 'tratamentoEstoque',
]);
const ENUMS = new Set([
  'forma', 'status', 'tipo', 'operacao', 'papel', 'escopo', 'tratamentoEstoque', 'operationMode', 'estacaoPreparo',
]);

export function summarizeRequestPayload(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  let omitted = false;
  let truncated = false;
  let remaining = 200;
  function visit(value: unknown, key: string, depth: number): unknown {
    if (depth > 6 || remaining-- <= 0) { truncated = true; return '[TRUNCATED]'; }
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') {
      const valid = ENUMS.has(key) ? /^[A-Z][A-Z0-9_]{0,63}$/.test(value)
        : /(?:Id|^id)$/.test(key) && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
      if (valid) return value;
      omitted = true; return undefined;
    }
    if (Array.isArray(value)) {
      if (value.length > 20) truncated = true;
      if (key === 'produtoIds' || key === 'comandaIds') {
        return value.slice(0, 20).map((item) => {
          if (typeof item === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(item)) return item;
          omitted = true;
          return undefined;
        }).filter((item) => item !== undefined);
      }
      return value.slice(0, 20).map((item) => visit(item, key, depth + 1));
    }
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [field, item] of Object.entries(value)) {
        if (!FIELDS.has(field)) { omitted = true; continue; }
        const safe = visit(item, field, depth + 1);
        if (safe !== undefined) out[field] = safe;
      }
      return out;
    }
    omitted = true; return undefined;
  }
  const payload = visit(body, '', 0) as Record<string, unknown>;
  return { payload, omitted, truncated, identitySource: 'request_untrusted' };
}
