import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { Loading } from '../../components/Loading';
import { Modal } from '../../components/Modal';
import { useQuiosqueContexto } from '../../hooks/useQuiosqueContexto';
import { FORMAS_PAGAMENTO, parseValor, type CaixaResposta, type ResumoCaixa } from '../../lib/quiosque';

type Dialogo = 'nenhum' | 'movimento' | 'fechar';

function LinhaResumo({ rotulo, valor, destaque = false }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between py-1 ${destaque ? 'font-semibold' : ''}`}>
      <span className="text-sm text-ink-faint">{rotulo}</span>
      <span>{formatCurrency(valor)}</span>
    </div>
  );
}

function Diferenca({ valor }: { valor: number }) {
  if (valor === 0) return <span className="text-sm text-ink-faint">confere</span>;
  const positivo = valor > 0;
  return (
    <span className={`text-sm font-semibold ${positivo ? 'text-green-600' : 'text-red-600'}`}>
      {positivo ? '+' : ''}
      {formatCurrency(valor)}
    </span>
  );
}

export function QuiosqueCaixaPage() {
  const queryClient = useQueryClient();
  const { contexto } = useQuiosqueContexto();
  const pontosVenda = contexto.ativo ? contexto.pontosVenda : [];

  const [pontoVendaId, setPontoVendaId] = useState('');
  const [trocoInicial, setTrocoInicial] = useState('100');
  const [dialogo, setDialogo] = useState<Dialogo>('nenhum');
  const [tipoMovimento, setTipoMovimento] = useState<'SANGRIA' | 'SUPRIMENTO'>('SANGRIA');
  const [valorMovimento, setValorMovimento] = useState('');
  const [obsMovimento, setObsMovimento] = useState('');
  const [contado, setContado] = useState<Record<string, string>>({});
  const [obsFechamento, setObsFechamento] = useState('');
  const [erro, setErro] = useState('');

  const pontoAtivo = pontoVendaId || pontosVenda[0]?.id || '';

  const { data, isLoading } = useQuery({
    queryKey: ['quiosque-caixa', pontoAtivo],
    queryFn: () => api.get<CaixaResposta>(`/api/quiosque/caixa?pontoVendaId=${pontoAtivo}`),
    enabled: Boolean(pontoAtivo),
    refetchInterval: 30_000,
  });

  const sessao = data?.sessao ?? null;

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['quiosque-caixa', pontoAtivo] });
  };

  const abrir = useMutation({
    mutationFn: () =>
      api.post<ResumoCaixa>('/api/quiosque/caixa/abrir', {
        pontoVendaId: pontoAtivo,
        trocoInicial: parseValor(trocoInicial),
      }),
    onSuccess: () => {
      invalidar();
      setErro('');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível abrir o caixa'),
  });

  const movimento = useMutation({
    mutationFn: () =>
      api.post<ResumoCaixa>('/api/quiosque/caixa/movimentos', {
        pontoVendaId: pontoAtivo,
        tipo: tipoMovimento,
        valor: parseValor(valorMovimento),
        observacao: obsMovimento.trim() || undefined,
      }),
    onSuccess: () => {
      invalidar();
      setDialogo('nenhum');
      setValorMovimento('');
      setObsMovimento('');
      setErro('');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível registrar o movimento'),
  });

  const fechar = useMutation({
    mutationFn: () =>
      api.post<ResumoCaixa>('/api/quiosque/caixa/fechar', {
        pontoVendaId: pontoAtivo,
        contadoDinheiro: parseValor(contado.dinheiro ?? '0'),
        contadoPix: parseValor(contado.pix ?? '0'),
        contadoCartaoDebito: parseValor(contado.debito ?? '0'),
        contadoCartaoCredito: parseValor(contado.credito ?? '0'),
        observacaoFechamento: obsFechamento.trim() || undefined,
      }),
    onSuccess: () => {
      invalidar();
      setDialogo('nenhum');
      setErro('');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível fechar o caixa'),
  });

  const abrirDialogoFechar = (atual: ResumoCaixa) => {
    setContado({
      dinheiro: String(atual.gaveta.esperadoDinheiro),
      pix: String(atual.esperado.pix),
      debito: String(atual.esperado.cartaoDebito),
      credito: String(atual.esperado.cartaoCredito),
    });
    setObsFechamento('');
    setErro('');
    setDialogo('fechar');
  };

  if (isLoading) return <Loading />;

  if (pontosVenda.length === 0) {
    return <p className="text-ink-faint text-center py-10">Cadastre um ponto de venda para operar o caixa.</p>;
  }

  return (
    <div className="space-y-4">
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

      {!sessao && (
        <div className="card space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Abrir caixa do dia</h2>
            <p className="text-sm text-ink-faint">
              Informe o troco inicial na gaveta. Vendas só entram com o caixa aberto.
            </p>
          </div>

          {erro && <div className="alert-error">{erro}</div>}

          <div>
            <label className="label">Troco inicial (R$)</label>
            <input
              className="input"
              inputMode="decimal"
              value={trocoInicial}
              onChange={(e) => setTrocoInicial(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="touch-btn-primary w-full"
            disabled={abrir.isPending}
            onClick={() => abrir.mutate()}
          >
            {abrir.isPending ? 'Abrindo...' : 'Abrir caixa'}
          </button>
        </div>
      )}

      {sessao?.status === 'ABERTO' && (
        <>
          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Caixa aberto</h2>
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                Em operação
              </span>
            </div>

            <LinhaResumo rotulo="Troco inicial" valor={sessao.gaveta.trocoInicial} />
            <LinhaResumo rotulo="Vendas em dinheiro" valor={sessao.gaveta.entradasDinheiro} />
            <LinhaResumo rotulo="Suprimentos" valor={sessao.gaveta.suprimentos} />
            <LinhaResumo rotulo="Sangrias" valor={-sessao.gaveta.sangrias} />
            <div className="border-t border-ink/10 pt-2">
              <LinhaResumo rotulo="Dinheiro esperado na gaveta" valor={sessao.gaveta.esperadoDinheiro} destaque />
            </div>
          </div>

          <div className="card space-y-2">
            <h3 className="font-semibold">Vendas por forma</h3>
            {FORMAS_PAGAMENTO.map((forma) => {
              const chave =
                forma.valor === 'DINHEIRO'
                  ? 'dinheiro'
                  : forma.valor === 'PIX'
                    ? 'pix'
                    : forma.valor === 'CARTAO_DEBITO'
                      ? 'cartaoDebito'
                      : 'cartaoCredito';
              const valor = sessao.esperado[chave as keyof typeof sessao.esperado] as number;
              return <LinhaResumo key={forma.valor} rotulo={forma.label} valor={valor} />;
            })}
            <div className="border-t border-ink/10 pt-2">
              <LinhaResumo rotulo="Total vendido" valor={sessao.esperado.totalVendas} destaque />
            </div>
          </div>

          {sessao.movimentos.length > 0 && (
            <div className="card space-y-2">
              <h3 className="font-semibold">Movimentos</h3>
              {sessao.movimentos.map((mov) => (
                <div key={mov.id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    {mov.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'}
                    {mov.observacao ? ` — ${mov.observacao}` : ''}
                  </span>
                  <span className={mov.tipo === 'SANGRIA' ? 'text-red-600' : 'text-green-600'}>
                    {mov.tipo === 'SANGRIA' ? '-' : '+'}
                    {formatCurrency(mov.valor)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="touch-btn-secondary"
              onClick={() => {
                setTipoMovimento('SUPRIMENTO');
                setErro('');
                setDialogo('movimento');
              }}
            >
              Suprimento
            </button>
            <button
              type="button"
              className="touch-btn-secondary"
              onClick={() => {
                setTipoMovimento('SANGRIA');
                setErro('');
                setDialogo('movimento');
              }}
            >
              Sangria
            </button>
          </div>

          <button
            type="button"
            className="touch-btn-orange w-full"
            onClick={() => abrirDialogoFechar(sessao)}
          >
            Fechar caixa
          </button>
        </>
      )}

      {sessao?.status === 'FECHADO' && (
        <div className="card space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Caixa fechado</h2>
            <p className="text-sm text-ink-faint">
              O caixa deste ponto já foi fechado hoje. Novas vendas ficam bloqueadas até amanhã.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold">Conferência</h3>
            {FORMAS_PAGAMENTO.map((forma) => {
              const esperadoChave =
                forma.valor === 'DINHEIRO'
                  ? 'dinheiro'
                  : forma.valor === 'PIX'
                    ? 'pix'
                    : forma.valor === 'CARTAO_DEBITO'
                      ? 'cartaoDebito'
                      : 'cartaoCredito';
              const contadoChave =
                forma.valor === 'DINHEIRO'
                  ? 'dinheiro'
                  : forma.valor === 'PIX'
                    ? 'pix'
                    : forma.valor === 'CARTAO_DEBITO'
                      ? 'cartaoDebito'
                      : 'cartaoCredito';
              const esperado =
                forma.valor === 'DINHEIRO'
                  ? sessao.gaveta.esperadoDinheiro
                  : (sessao.esperado[esperadoChave as keyof typeof sessao.esperado] as number);
              const contadoValor = sessao.contado?.[contadoChave as keyof NonNullable<typeof sessao.contado>] ?? 0;
              const diff = sessao.diferencas?.[contadoChave as keyof NonNullable<typeof sessao.diferencas>] ?? 0;

              return (
                <div key={forma.valor} className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{forma.label}</span>
                  <div className="text-right">
                    <div>
                      {formatCurrency(contadoValor)}{' '}
                      <span className="text-ink-faint">/ {formatCurrency(esperado)}</span>
                    </div>
                    <Diferenca valor={diff} />
                  </div>
                </div>
              );
            })}
          </div>

          {sessao.observacaoFechamento && (
            <p className="text-sm text-ink-faint">Obs.: {sessao.observacaoFechamento}</p>
          )}
        </div>
      )}

      {!sessao && (
        <p className="text-center text-sm text-ink-faint">
          Sem caixa aberto.{' '}
          <Link to="/quiosque" className="underline">
            Vendas ficam bloqueadas
          </Link>{' '}
          até abrir.
        </p>
      )}

      <Modal
        open={dialogo === 'movimento'}
        onClose={() => setDialogo('nenhum')}
        title={tipoMovimento === 'SANGRIA' ? 'Registrar sangria' : 'Registrar suprimento'}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valorMovimento.trim() || parseValor(valorMovimento) <= 0) {
              return setErro('Informe um valor válido');
            }
            movimento.mutate();
          }}
        >
          {erro && <div className="alert-error">{erro}</div>}
          <div>
            <label className="label">Valor (R$)</label>
            <input
              className="input"
              autoFocus
              inputMode="decimal"
              value={valorMovimento}
              onChange={(e) => setValorMovimento(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Observação (opcional)</label>
            <input className="input" value={obsMovimento} onChange={(e) => setObsMovimento(e.target.value)} />
          </div>
          <button type="submit" className="touch-btn-primary w-full" disabled={movimento.isPending}>
            {movimento.isPending ? 'Salvando...' : 'Confirmar'}
          </button>
        </form>
      </Modal>

      <Modal open={dialogo === 'fechar'} onClose={() => setDialogo('nenhum')} title="Fechar caixa">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            fechar.mutate();
          }}
        >
          {erro && <div className="alert-error">{erro}</div>}
          <p className="text-sm text-ink-faint">
            Conte o que há fisicamente e ajuste se necessário. A diferença aparece no resumo.
          </p>

          {FORMAS_PAGAMENTO.map((forma) => {
            const chave =
              forma.valor === 'DINHEIRO'
                ? 'dinheiro'
                : forma.valor === 'PIX'
                  ? 'pix'
                  : forma.valor === 'CARTAO_DEBITO'
                    ? 'debito'
                    : 'credito';
            return (
              <div key={forma.valor}>
                <label className="label">Contado — {forma.label}</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={contado[chave] ?? ''}
                  onChange={(e) => setContado((atual) => ({ ...atual, [chave]: e.target.value }))}
                />
              </div>
            );
          })}

          <div>
            <label className="label">Observação (opcional)</label>
            <input className="input" value={obsFechamento} onChange={(e) => setObsFechamento(e.target.value)} />
          </div>

          <button type="submit" className="touch-btn-orange w-full" disabled={fechar.isPending}>
            {fechar.isPending ? 'Fechando...' : 'Confirmar fechamento'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
