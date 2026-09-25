import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { PageHeader } from '../../components/PageHeader';
import { useQuiosqueContexto } from '../../hooks/useQuiosqueContexto';
import { usePollInterval } from '../../hooks/usePollInterval';
import { TIPOS_COMANDA, type CaixaResposta, type ComandaQuiosque } from '../../lib/quiosque';

export function QuiosqueNovaComandaPage() {
  const navigate = useNavigate();
  const { contexto } = useQuiosqueContexto();
  const pontosVenda = contexto.ativo ? contexto.pontosVenda : [];

  const [pontoVendaId, setPontoVendaId] = useState('');
  const [tipoComanda, setTipoComanda] = useState<'APELIDO' | 'MESA' | 'FICHA'>('APELIDO');
  const [identificador, setIdentificador] = useState('');
  const [erro, setErro] = useState('');

  const pontoAtivo = pontoVendaId || pontosVenda[0]?.id || '';
  const pollMs = usePollInterval(30_000);

  const { data: caixaData } = useQuery({
    queryKey: ['quiosque-caixa', pontoAtivo],
    queryFn: () => api.get<CaixaResposta>(`/api/quiosque/caixa?pontoVendaId=${pontoAtivo}`),
    enabled: Boolean(pontoAtivo),
    refetchInterval: pollMs,
  });
  const caixaAberto = caixaData?.sessao?.status === 'ABERTO';

  const abrir = useMutation({
    mutationFn: () =>
      api.post<ComandaQuiosque>('/api/quiosque/comandas', {
        pontoVendaId: pontoAtivo,
        tipo: tipoComanda,
        identificador: identificador.trim(),
        itens: [],
      }),
    onSuccess: (comanda) => navigate(`/quiosque/comandas/${comanda.id}`),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && typeof err.body?.comandaId === 'string') {
        navigate(`/quiosque/comandas/${err.body.comandaId}`);
        return;
      }
      setErro(err instanceof ApiError ? err.message : 'Não foi possível abrir a comanda');
    },
  });

  return (
    <div className="space-y-4 pb-2">
      <PageHeader title="Nova comanda" backTo="/quiosque/comandas" backLabel="Comandas" />

      <p className="text-sm text-ink-muted leading-relaxed">
        Abra uma comanda por apelido, mesa ou ficha. Os itens são lançados na tela seguinte.
      </p>

      {!caixaAberto && pontoAtivo && (
        <div className="alert-error">
          Caixa fechado. Abra o caixa na tela de comandas para continuar.
        </div>
      )}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!identificador.trim()) return setErro('Informe o apelido, mesa ou ficha');
          setErro('');
          abrir.mutate();
        }}
      >
        {erro && <div className="alert-error">{erro}</div>}

        {pontosVenda.length > 1 && (
          <div>
            <label className="label">Ponto de venda</label>
            <select
              className="input"
              value={pontoAtivo}
              onChange={(e) => setPontoVendaId(e.target.value)}
            >
              {pontosVenda.map((ponto) => (
                <option key={ponto.id} value={ponto.id}>
                  {ponto.nome}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="label">Identificar por</label>
          <div className="segmented-control">
            {TIPOS_COMANDA.map((opcao) => (
              <button
                key={opcao.valor}
                type="button"
                onClick={() => setTipoComanda(opcao.valor)}
                className={`segmented-control-btn ${
                  tipoComanda === opcao.valor
                    ? 'segmented-control-btn-active'
                    : 'segmented-control-btn-inactive'
                }`}
              >
                {opcao.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">
            {tipoComanda === 'APELIDO'
              ? 'Nome ou apelido'
              : `Número da ${tipoComanda === 'MESA' ? 'mesa' : 'ficha'}`}
          </label>
          <input
            className="input"
            autoFocus
            value={identificador}
            onChange={(e) => setIdentificador(e.target.value)}
            placeholder={tipoComanda === 'APELIDO' ? 'Zé da praia' : '12'}
            inputMode={tipoComanda === 'APELIDO' ? 'text' : 'numeric'}
          />
        </div>

        <button type="submit" className="touch-btn-primary w-full" disabled={abrir.isPending || !caixaAberto}>
          {abrir.isPending ? 'Abrindo...' : 'Abrir comanda'}
        </button>

        <button
          type="button"
          className="touch-btn-secondary w-full"
          onClick={() => navigate('/quiosque/comandas')}
        >
          Cancelar
        </button>
      </form>
    </div>
  );
}
