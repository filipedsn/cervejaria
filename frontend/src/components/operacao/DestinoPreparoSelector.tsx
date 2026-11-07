import type { EstacaoPreparo } from '../../lib/estacao';

export type DestinoPreparo = 'BALCAO' | EstacaoPreparo;

const OPCOES: Array<{ valor: DestinoPreparo; rotulo: string; detalhe: string; ajuda: string }> = [
  {
    valor: 'BALCAO',
    rotulo: 'Balcão',
    detalhe: 'sem preparo',
    ajuda: 'Sai direto do balcão, sem fila de preparo.',
  },
  {
    valor: 'COZINHA',
    rotulo: 'Cozinha',
    detalhe: 'fila da cozinha',
    ajuda: 'Gera pedido de preparo na fila da Cozinha, por ordem de chegada.',
  },
  {
    valor: 'BAR',
    rotulo: 'Bar',
    detalhe: 'fila do bar',
    ajuda: 'Gera pedido de preparo na fila do Bar, por ordem de chegada.',
  },
];

export function destinoDoProduto(produto: { exigePreparo?: boolean; estacaoPreparo?: EstacaoPreparo | null }): DestinoPreparo {
  if (!produto.exigePreparo) return 'BALCAO';
  return produto.estacaoPreparo === 'BAR' ? 'BAR' : 'COZINHA';
}

/** Converte o destino escolhido nos campos persistidos do produto. */
export function camposDoDestino(destino: DestinoPreparo): { exigePreparo: boolean; estacaoPreparo: EstacaoPreparo } {
  return destino === 'BALCAO'
    ? { exigePreparo: false, estacaoPreparo: 'COZINHA' }
    : { exigePreparo: true, estacaoPreparo: destino };
}

/**
 * Um único destino por produto: escolher Bar desmarca Cozinha e vice-versa.
 * Estações desligadas não aparecem, exceto a que o produto já usa.
 */
export function DestinoPreparoSelector({
  value,
  onChange,
  temCozinha,
  temBar,
}: {
  value: DestinoPreparo;
  onChange: (destino: DestinoPreparo) => void;
  temCozinha: boolean;
  temBar: boolean;
}) {
  const opcoes = OPCOES.filter((opcao) =>
    opcao.valor === 'BALCAO'
    || opcao.valor === value
    || (opcao.valor === 'COZINHA' && temCozinha)
    || (opcao.valor === 'BAR' && temBar));
  if (opcoes.length <= 1) return null;
  const selecionada = opcoes.find((opcao) => opcao.valor === value) ?? opcoes[0]!;

  return (
    <div>
      <span className="label" id="destino-preparo-label">Destino do preparo</span>
      <div className="chip-picker" role="radiogroup" aria-labelledby="destino-preparo-label">
        {opcoes.map((opcao) => (
          <button
            key={opcao.valor}
            type="button"
            role="radio"
            aria-checked={value === opcao.valor}
            data-testid={`destino-preparo-${opcao.valor.toLowerCase()}`}
            onClick={() => onChange(opcao.valor)}
            className={`chip-picker-btn flex flex-col items-center justify-center gap-0.5 py-1.5 ${value === opcao.valor ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
          >
            <span>{opcao.rotulo}</span>
            <span className="text-[0.7rem] font-normal leading-tight opacity-80">{opcao.detalhe}</span>
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-ink-faint">{selecionada.ajuda}</p>
    </div>
  );
}
