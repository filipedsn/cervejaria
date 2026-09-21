import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { PainelCaixaQuiosque } from '../../components/quiosque/PainelCaixaQuiosque';
import { useQuiosqueContexto } from '../../hooks/useQuiosqueContexto';

/** Rota legada /quiosque/caixa — o painel principal fica em Comandas. */
export function QuiosqueCaixaPage() {
  const queryClient = useQueryClient();
  const { contexto } = useQuiosqueContexto();
  const pontosVenda = contexto.ativo ? contexto.pontosVenda : [];
  const [pontoVendaId, setPontoVendaId] = useState('');
  const [nomePonto, setNomePonto] = useState('Principal');
  const [erro, setErro] = useState('');
  const pontoAtivo = pontoVendaId || pontosVenda[0]?.id || '';
  const criarPonto = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/quiosque/pontos-venda', { nome: nomePonto.trim() }),
    onSuccess: (ponto) => { setPontoVendaId(ponto.id); setErro(''); queryClient.invalidateQueries({ queryKey: ['quiosque-contexto'] }); },
    onError: (cause) => setErro(cause instanceof ApiError ? cause.message : 'Não foi possível criar o ponto de venda'),
  });

  if (pontosVenda.length === 0) {
    return <div className="card mx-auto max-w-lg space-y-4 text-center">
      <div><h1 className="text-xl font-bold text-ink">Você ainda não possui um ponto de venda.</h1><p className="mt-2 text-sm text-ink-muted">Crie um ponto de venda para abrir o caixa e começar a vender.</p></div>
      <label className="block text-left"><span className="label">Nome do ponto</span><input className="input" value={nomePonto} onChange={(event) => setNomePonto(event.target.value)} /></label>
      {erro && <div className="alert-error text-left">{erro}</div>}
      <button type="button" className="touch-btn-primary w-full" disabled={!nomePonto.trim() || criarPonto.isPending} onClick={() => criarPonto.mutate()}>{criarPonto.isPending ? 'Criando...' : 'Criar ponto de venda'}</button>
    </div>;
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
