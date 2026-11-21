export type ComboGrupoModo = 'LISTA' | 'CATEGORIA';
export type ComboGrupoPrecoModo = 'FIXO' | 'CATALOGO';

export type OpcaoCombo = {
  id: string;
  produtoId: string;
  nome: string;
  ativo: boolean;
  categoria: string | null;
  precoNoCombo: number;
  quantidade: number;
  exigePreparo: boolean;
  controlaEstoque: boolean;
  disponivel?: boolean;
};

export type GrupoCombo = {
  id: string;
  nome: string;
  minimo: number;
  maximo: number;
  modo?: ComboGrupoModo;
  categoria?: string | null;
  categoriaPdvId?: string | null;
  precoModo?: ComboGrupoPrecoModo | null;
  precoFixo?: number | null;
  somenteCardapioTurno: boolean;
  opcoes: OpcaoCombo[];
};

export type ComposicaoCombo = { precoCatalogo: number; grupos: GrupoCombo[] };

export type EscolhaCombo = { grupoId: string; opcaoIds: string[] };

/** Espelha o backend: em cada grupo, as `minimo` opções mais baratas. */
export function precoBaseCombo(grupos: Array<{ minimo: number; opcoes: Array<{ precoNoCombo: number; quantidade?: number }> }>): number {
  const centavos = grupos.reduce((total, grupo) => {
    const valores = grupo.opcoes
      .map((opcao) => Math.round(opcao.precoNoCombo * 100) * (opcao.quantidade ?? 1))
      .sort((a, b) => a - b);
    return total + valores.slice(0, grupo.minimo).reduce((soma, valor) => soma + valor, 0);
  }, 0);
  return centavos / 100;
}

/** O combo mais caro possível: em cada grupo, as `maximo` opções mais caras. */
export function precoMaximoCombo(grupos: Array<{ maximo: number; opcoes: Array<{ precoNoCombo: number; quantidade?: number }> }>): number {
  const centavos = grupos.reduce((total, grupo) => {
    const valores = grupo.opcoes
      .map((opcao) => Math.round(opcao.precoNoCombo * 100) * (opcao.quantidade ?? 1))
      .sort((a, b) => b - a);
    return total + valores.slice(0, grupo.maximo).reduce((soma, valor) => soma + valor, 0);
  }, 0);
  return centavos / 100;
}

/** Fator do preço do combo no cardápio/turno sobre o catálogo, como o backend aplica. */
export function fatorPrecoCombo(precoEfetivo: number, precoCatalogo: number): number {
  return precoCatalogo > 0 ? precoEfetivo / precoCatalogo : 1;
}

/** Valor de uma unidade do combo para as escolhas feitas. */
export function precoEscolhasCombo(grupos: GrupoCombo[], escolhidas: Record<string, string[]>, fator: number): number {
  const centavos = grupos.reduce((total, grupo) => total + grupo.opcoes
    .filter((opcao) => (escolhidas[grupo.id] ?? []).includes(opcao.id))
    .reduce((soma, opcao) => soma + Math.round(opcao.precoNoCombo * 100) * opcao.quantidade, 0), 0);
  return Math.round(centavos * fator) / 100;
}

export function escolhasCompletas(grupos: GrupoCombo[], escolhidas: Record<string, string[]>): boolean {
  return grupos.every((grupo) => {
    const total = (escolhidas[grupo.id] ?? []).length;
    return total >= grupo.minimo && total <= grupo.maximo;
  });
}

export function resumoEscolhasCombo(grupos: GrupoCombo[], escolhidas: Record<string, string[]>): string[] {
  return grupos.flatMap((grupo) => grupo.opcoes
    .filter((opcao) => (escolhidas[grupo.id] ?? []).includes(opcao.id))
    .map((opcao) => (opcao.quantidade > 1 ? `${opcao.quantidade}× ` : '') + opcao.nome));
}
