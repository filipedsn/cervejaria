import { useState } from 'react';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { PainelCaixaQuiosque } from '../../components/quiosque/PainelCaixaQuiosque';
import { useQuiosqueContexto } from '../../hooks/useQuiosqueContexto';

/** Rota legada /quiosque/caixa — o painel principal fica em Comandas. */
export function QuiosqueCaixaPage() {
  const { contexto } = useQuiosqueContexto();
  const pontosVenda = contexto.ativo ? contexto.pontosVenda : [];
  const [pontoVendaId, setPontoVendaId] = useState('');
  const pontoAtivo = pontoVendaId || pontosVenda[0]?.id || '';

  if (pontosVenda.length === 0) {
    return <p className="text-ink-faint text-center py-10">Cadastre um ponto de venda para operar o caixa.</p>;
  }

  return (
    <div className="space-y-4 pb-2">
      <PageHeader title="Caixa" backTo="/quiosque/comandas" backLabel="Comandas" />

      {pontosVenda.length > 1 && (
        <div>
          <label className="label">Ponto de venda</label>
          <select className="input" value={pontoAtivo} onChange={(e) => setPontoVendaId(e.target.value)}>
            {pontosVenda.map((ponto) => (
              <option key={ponto.id} value={ponto.id}>
                {ponto.nome}
              </option>
            ))}
          </select>
        </div>
      )}

      {pontoAtivo ? <PainelCaixaQuiosque pontoVendaId={pontoAtivo} /> : <Loading />}
    </div>
  );
}
