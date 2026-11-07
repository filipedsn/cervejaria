import type { OperacaoContexto } from '../hooks/useOperacaoContexto';

/** Estação de preparo na UI (rota/API em minúsculas). */
export type EstacaoUi = 'cozinha' | 'bar';
/** Valor gravado em produtos/itens no backend. */
export type EstacaoPreparo = 'COZINHA' | 'BAR';

export type EstacaoConfig = {
  estacao: EstacaoUi;
  valor: EstacaoPreparo;
  titulo: string;
  /** "na cozinha" / "no bar" */
  naEstacao: string;
  /** "da cozinha" / "do bar" */
  daEstacao: string;
  path: string;
  tvPath: string;
  api: string;
  icone: string;
  permissoes: { read: string; operate: string; cancel: string };
};

export const ESTACOES: Record<EstacaoUi, EstacaoConfig> = {
  cozinha: {
    estacao: 'cozinha',
    valor: 'COZINHA',
    titulo: 'Cozinha',
    naEstacao: 'na cozinha',
    daEstacao: 'da cozinha',
    path: '/operacao/cozinha',
    tvPath: '/operacao/cozinha/tv',
    api: '/api/operacao/cozinha',
    icone: '👨‍🍳',
    permissoes: { read: 'kitchen.read', operate: 'kitchen.operate', cancel: 'kitchen.cancel' },
  },
  bar: {
    estacao: 'bar',
    valor: 'BAR',
    titulo: 'Bar',
    naEstacao: 'no bar',
    daEstacao: 'do bar',
    path: '/operacao/bar',
    tvPath: '/operacao/bar/tv',
    api: '/api/operacao/bar',
    icone: '🍹',
    permissoes: { read: 'bar.read', operate: 'bar.operate', cancel: 'bar.cancel' },
  },
};

export function estacaoUiDoValor(valor: EstacaoPreparo | null | undefined): EstacaoUi {
  return valor === 'BAR' ? 'bar' : 'cozinha';
}

export function estacaoAtiva(contexto: Pick<OperacaoContexto, 'ativo' | 'temCozinha' | 'temBar'>, estacao: EstacaoUi): boolean {
  return contexto.ativo && (estacao === 'bar' ? contexto.temBar : contexto.temCozinha);
}

/** O aviso de "pedido pronto" acontece na tela da estação quando ela está configurada para isso. */
export function avisoClienteNaEstacao(
  contexto: Pick<OperacaoContexto, 'whatsappPedidoProntoEnabled' | 'whatsappPedidoProntoNaCozinha' | 'whatsappPedidoProntoNoBar'>,
  estacao: EstacaoUi,
): boolean {
  return contexto.whatsappPedidoProntoEnabled
    && (estacao === 'bar' ? contexto.whatsappPedidoProntoNoBar : contexto.whatsappPedidoProntoNaCozinha);
}

export type CobrancaAoLancar = { cozinha: boolean; bar: boolean };

export function itemCobradoAoLancar(
  item: { exigePreparo?: boolean; estacaoPreparo?: EstacaoPreparo | null },
  cobranca: boolean | CobrancaAoLancar,
): boolean {
  if (!item.exigePreparo) return true;
  if (typeof cobranca === 'boolean') return cobranca;
  return item.estacaoPreparo === 'BAR' ? cobranca.bar : cobranca.cozinha;
}
