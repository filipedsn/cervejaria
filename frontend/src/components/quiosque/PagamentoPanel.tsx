import { useMemo, useState } from 'react';
import { formatCurrency } from '../../lib/api';
import { FORMAS_PAGAMENTO, parseValor, type FormaPagamento } from '../../lib/quiosque';

interface Props {
  total: number;
  confirmando: boolean;
  textoConfirmar: string;
  onConfirmar: (pagamento: {
    forma: FormaPagamento;
    valor: number;
    valorRecebido?: number;
  }) => void;
}

/** Notas com que o cliente de quiosque costuma pagar. */
const NOTAS = [5, 10, 20, 50, 100];

export function PagamentoPanel({ total, confirmando, textoConfirmar, onConfirmar }: Props) {
  const [forma, setForma] = useState<FormaPagamento>('DINHEIRO');
  const [recebido, setRecebido] = useState('');

  const valorRecebido = recebido ? parseValor(recebido) : null;
  const troco = useMemo(() => {
    if (forma !== 'DINHEIRO' || valorRecebido === null || Number.isNaN(valorRecebido)) return null;
    return Math.round((valorRecebido - total) * 100) / 100;
  }, [forma, valorRecebido, total]);

  const faltaDinheiro = troco !== null && troco < 0;
  const podeConfirmar = total > 0 && !faltaDinheiro && !confirmando;

  const confirmar = () => {
    if (!podeConfirmar) return;
    onConfirmar({
      forma,
      valor: total,
      // Sem valor digitado o cliente pagou certo: nao ha troco a registrar.
      valorRecebido: forma === 'DINHEIRO' && troco !== null && troco > 0 ? valorRecebido! : undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="card flex items-baseline justify-between py-3">
        <span className="text-sm text-ink-faint">Total a pagar</span>
        <span className="text-2xl font-bold">{formatCurrency(total)}</span>
      </div>

      <div>
        <label className="label">Forma de pagamento</label>
        <div className="segmented-control">
          {FORMAS_PAGAMENTO.map((opcao) => (
            <button
              key={opcao.valor}
              type="button"
              onClick={() => {
                setForma(opcao.valor);
                setRecebido('');
              }}
              className={`segmented-control-btn ${
                forma === opcao.valor
                  ? 'segmented-control-btn-active'
                  : 'segmented-control-btn-inactive'
              }`}
            >
              {opcao.label}
            </button>
          ))}
        </div>
      </div>

      {forma === 'DINHEIRO' && (
        <div className="space-y-2">
          <label className="label">Valor recebido</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="Deixe vazio se pagou certo"
            value={recebido}
            onChange={(e) => setRecebido(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {NOTAS.filter((nota) => nota >= total).map((nota) => (
              <button
                key={nota}
                type="button"
                className="touch-btn-ghost touch-btn-sm"
                onClick={() => setRecebido(String(nota))}
              >
                {formatCurrency(nota)}
              </button>
            ))}
          </div>

          {troco !== null && troco > 0 && (
            <div className="card flex items-baseline justify-between border-orange/40 py-3">
              <span className="text-sm font-semibold text-orange">Troco</span>
              <span className="text-2xl font-bold text-orange">{formatCurrency(troco)}</span>
            </div>
          )}
          {faltaDinheiro && (
            <div className="alert-error">
              Faltam {formatCurrency(Math.abs(troco))} para fechar a conta.
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="touch-btn-primary w-full"
        disabled={!podeConfirmar}
        data-audit="quiosque-confirmar-pagamento"
        onClick={confirmar}
      >
        {confirmando ? 'Registrando...' : textoConfirmar}
      </button>
    </div>
  );
}
