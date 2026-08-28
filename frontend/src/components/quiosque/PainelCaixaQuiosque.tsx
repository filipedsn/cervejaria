import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { Modal } from '../Modal';
import { CurrencyInput } from '../CurrencyInput';
import { formatCurrencyInputFromNumber, parseCurrencyInput } from '../../lib/currency';
import {
  FORMAS_PAGAMENTO,
  type CaixaResposta,
  type ResumoCaixa,
  defaultTurnoCardapioForm,
  buildTurnoCardapioAbrirPayload,
} from '../../lib/quiosque';
import { usePollInterval } from '../../hooks/usePollInterval';
import { useQuiosqueContexto } from '../../hooks/useQuiosqueContexto';
import {
  TurnoCardapioFormFields,
  type TurnoCardapioFormState,
} from './TurnoCardapioFormFields';
import { QuiosqueTurnoCardapioPanel } from './QuiosqueTurnoCardapioPanel';

type Dialogo = 'nenhum' | 'movimento' | 'correcao' | 'fechar' | 'cardapio';

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

interface Props {
  pontoVendaId: string;
  /** Na lista de comandas: painel compacto quando aberto. */
  compacto?: boolean;
  /** Contagem ao vivo da página de comandas; senão usa a API. */
  comandasAbertas?: number;
}

export function PainelCaixaQuiosque({ pontoVendaId, compacto = false, comandasAbertas: comandasAbertasProp }: Props) {
  const queryClient = useQueryClient();
  const { contexto } = useQuiosqueContexto();
  const usaCardapio = contexto.ativo ? (contexto.usaCardapio ?? false) : false;
  const pollMs = usePollInterval(30_000);
  const [trocoInicial, setTrocoInicial] = useState(() => formatCurrencyInputFromNumber(100));
  const [dialogo, setDialogo] = useState<Dialogo>('nenhum');
  const [tipoMovimento, setTipoMovimento] = useState<'SANGRIA' | 'SUPRIMENTO'>('SANGRIA');
  const [valorMovimento, setValorMovimento] = useState('');
  const [obsMovimento, setObsMovimento] = useState('');
  const [movimentoParaCorrigir, setMovimentoParaCorrigir] = useState<ResumoCaixa['movimentos'][number] | null>(null);
  const [valorCorrigido, setValorCorrigido] = useState('');
  const [motivoCorrecao, setMotivoCorrecao] = useState('');
  const [autorizadorEmail, setAutorizadorEmail] = useState('');
  const [autorizadorSenha, setAutorizadorSenha] = useState('');
  const [historicoAberto, setHistoricoAberto] = useState<string | null>(null);
  const [contado, setContado] = useState<Record<string, string>>({});
  const [obsFechamento, setObsFechamento] = useState('');
  const [erro, setErro] = useState('');
  const [cardapioForm, setCardapioForm] = useState<TurnoCardapioFormState>(defaultTurnoCardapioForm);

  const { data } = useQuery({
    queryKey: ['quiosque-caixa', pontoVendaId],
    queryFn: () => api.get<CaixaResposta>(`/api/quiosque/caixa?pontoVendaId=${pontoVendaId}`),
    enabled: Boolean(pontoVendaId),
    refetchInterval: pollMs,
  });

  const sessao = data?.sessao ?? null;
  const comandasAbertas = comandasAbertasProp ?? data?.comandasAbertas ?? 0;
  const bloqueioFechamento = comandasAbertas > 0;

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['quiosque-caixa', pontoVendaId] });
  };

  const abrir = useMutation({
    mutationFn: () =>
      api.post<ResumoCaixa>('/api/quiosque/caixa/abrir', {
        pontoVendaId,
        trocoInicial: parseCurrencyInput(trocoInicial),
        ...buildTurnoCardapioAbrirPayload(cardapioForm),
      }),
    onSuccess: () => {
      invalidar();
      queryClient.invalidateQueries({ queryKey: ['quiosque-comandas'] });
      queryClient.invalidateQueries({ queryKey: ['quiosque-produtos-operacionais', pontoVendaId] });
      queryClient.invalidateQueries({ queryKey: ['quiosque-turno-cardapio', pontoVendaId] });
      setCardapioForm(defaultTurnoCardapioForm());
      setErro('');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível abrir o caixa'),
  });

  const movimento = useMutation({
    mutationFn: () =>
      api.post<ResumoCaixa>('/api/quiosque/caixa/movimentos', {
        pontoVendaId,
        tipo: tipoMovimento,
        valor: parseCurrencyInput(valorMovimento),
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
        pontoVendaId,
        contadoDinheiro: parseCurrencyInput(contado.dinheiro ?? '0'),
        contadoPix: parseCurrencyInput(contado.pix ?? '0'),
        contadoCartaoDebito: parseCurrencyInput(contado.debito ?? '0'),
        contadoCartaoCredito: parseCurrencyInput(contado.credito ?? '0'),
        observacaoFechamento: obsFechamento.trim() || undefined,
      }),
    onSuccess: () => {
      invalidar();
      queryClient.invalidateQueries({ queryKey: ['quiosque-comandas'] });
      setDialogo('nenhum');
      setErro('');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível fechar o caixa'),
  });

  const corrigir = useMutation({
    mutationFn: () => {
      if (!movimentoParaCorrigir) throw new Error('Movimento não selecionado');
      return api.post<ResumoCaixa>(`/api/quiosque/caixa/movimentos/${movimentoParaCorrigir.id}/corrigir`, {
        pontoVendaId,
        valorCorrigido: parseCurrencyInput(valorCorrigido),
        motivo: motivoCorrecao.trim(),
        autorizadorEmail: autorizadorEmail.trim(),
        autorizadorSenha,
      });
    },
    onSuccess: () => {
      invalidar();
      setDialogo('nenhum');
      setMovimentoParaCorrigir(null);
      setValorCorrigido('');
      setMotivoCorrecao('');
      setAutorizadorEmail('');
      setAutorizadorSenha('');
      setErro('');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível corrigir o movimento'),
  });

  const abrirDialogoFechar = (atual: ResumoCaixa) => {
    if (bloqueioFechamento) return;
    setContado({
      dinheiro: formatCurrencyInputFromNumber(atual.gaveta.esperadoDinheiro),
      pix: formatCurrencyInputFromNumber(atual.esperado.pix),
      debito: formatCurrencyInputFromNumber(atual.esperado.cartaoDebito),
      credito: formatCurrencyInputFromNumber(atual.esperado.cartaoCredito),
    });
    setObsFechamento('');
    setErro('');
    setDialogo('fechar');
  };

  if (!pontoVendaId) return null;

  return (
    <>
      {!sessao && (
        <div className="card space-y-3">
          <div>
            <h2 className="text-base font-semibold">Caixa do dia</h2>
            <p className="text-sm text-ink-faint">
              Abra um turno de caixa para registrar comandas e vendas. Você pode fechar e abrir de
              novo no mesmo dia — praia de dia, rua à noite.
            </p>
          </div>

          {erro && <div className="alert-error">{erro}</div>}

          <div>
            <label className="label">Troco inicial (R$)</label>
            <CurrencyInput value={trocoInicial} onChange={setTrocoInicial} />
          </div>

          {usaCardapio && (
            <TurnoCardapioFormFields form={cardapioForm} setForm={setCardapioForm} />
          )}

          <button
            type="button"
            className="touch-btn-primary w-full"
            disabled={abrir.isPending}
            data-audit="quiosque-caixa-abrir"
            onClick={() => abrir.mutate()}
          >
            {abrir.isPending ? 'Abrindo...' : 'Abrir caixa'}
          </button>
        </div>
      )}

      {sessao?.status === 'ABERTO' && compacto && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Caixa aberto</h2>
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
              Em operação
            </span>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
            <span>
              Gaveta: <strong className="text-ink">{formatCurrency(sessao.gaveta.esperadoDinheiro)}</strong>
            </span>
            <span>
              Vendido: <strong className="text-ink">{formatCurrency(sessao.esperado.totalVendas)}</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="touch-btn-secondary touch-btn-sm"
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
              className="touch-btn-secondary touch-btn-sm"
              onClick={() => {
                setTipoMovimento('SANGRIA');
                setErro('');
                setDialogo('movimento');
              }}
            >
              Sangria
            </button>
          </div>

          {erro && !dialogo && <div className="alert-error">{erro}</div>}

          {usaCardapio && (
            <button
              type="button"
              className="touch-btn-secondary touch-btn-sm w-full"
              onClick={() => {
                setErro('');
                setDialogo('cardapio');
              }}
            >
              Cardápio do turno
            </button>
          )}

          <button
            type="button"
            className="touch-btn-orange w-full disabled:opacity-50"
            disabled={bloqueioFechamento}
            onClick={() => abrirDialogoFechar(sessao)}
            data-audit="quiosque-caixa-fechar"
          >
            Fechar caixa
          </button>
        </div>
      )}

      {sessao?.status === 'ABERTO' && !compacto && (
        <>
          {usaCardapio && (
            <div className="card space-y-3">
              <QuiosqueTurnoCardapioPanel pontoVendaId={pontoVendaId} embedded />
            </div>
          )}

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
              {sessao.movimentos.filter((mov) => !mov.correcaoDeId).map((mov) => (
                <div key={mov.id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    {mov.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'}
                    {mov.corrigidoEm && <span className="ml-2 text-xs font-semibold text-amber-700">CORRIGIDA</span>}
                    {mov.observacao ? ` — ${mov.observacao}` : ''}
                  </span>
                  <span className={mov.tipo === 'SANGRIA' ? 'text-red-600' : 'text-green-600'}>
                    {mov.tipo === 'SANGRIA' ? '-' : '+'}
                    {formatCurrency(sessao.movimentos.find((item) => item.correcaoDeId === mov.id && item.naturezaCorrecao === 'SUBSTITUICAO')?.valor ?? mov.valor)}
                  </span>
                  {!mov.corrigidoEm && (
                    <button type="button" className="mt-1 text-xs text-primary underline" onClick={() => {
                      setMovimentoParaCorrigir(mov);
                      setValorCorrigido(formatCurrencyInputFromNumber(mov.valor));
                      setMotivoCorrecao(''); setAutorizadorEmail(''); setAutorizadorSenha(''); setErro(''); setDialogo('correcao');
                    }}>Corrigir</button>
                  )}
                  {mov.corrigidoEm && (
                    <button type="button" className="mt-1 text-xs text-primary underline" onClick={() => setHistoricoAberto(historicoAberto === mov.id ? null : mov.id)}>Ver histórico</button>
                  )}
                  {historicoAberto === mov.id && <div className="mt-2 rounded bg-ink/5 p-2 text-xs text-ink-faint">
                    <div>Original: {formatCurrency(mov.valor)}</div>
                    <div>Estorno: {formatCurrency(sessao.movimentos.find((item) => item.correcaoDeId === mov.id && item.naturezaCorrecao === 'ESTORNO')?.valor ?? 0)}</div>
                    <div>Novo valor: {formatCurrency(sessao.movimentos.find((item) => item.correcaoDeId === mov.id && item.naturezaCorrecao === 'SUBSTITUICAO')?.valor ?? mov.valor)}</div>
                    <div>Motivo: {mov.motivoCorrecao}</div>
                    <div>Autorizado por: {mov.autorizadoPorId}</div>
                  </div>}
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

          {erro && !dialogo && <div className="alert-error">{erro}</div>}

          <button
            type="button"
            className="touch-btn-orange w-full disabled:opacity-50"
            disabled={bloqueioFechamento}
            onClick={() => abrirDialogoFechar(sessao)}
            data-audit="quiosque-caixa-fechar"
          >
            Fechar caixa
          </button>
        </>
      )}

      {sessao?.status === 'FECHADO' && (
        <div className="card space-y-3">
          <div>
            <h2 className="text-base font-semibold">Turno encerrado</h2>
            <p className="text-sm text-ink-faint">
              Conferência do turno que acabou de fechar. Abra um novo turno abaixo quando for
              operar de novo.
            </p>
          </div>
          {!compacto && (
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
          )}
          {sessao.observacaoFechamento && (
            <p className="text-sm text-ink-faint">Obs.: {sessao.observacaoFechamento}</p>
          )}
        </div>
      )}

      {usaCardapio && (
        <Modal
          open={dialogo === 'cardapio'}
          onClose={() => setDialogo('nenhum')}
          title="Cardápio do turno"
          hideHeaderClose
        >
          <QuiosqueTurnoCardapioPanel
            pontoVendaId={pontoVendaId}
            embedded
            onClose={() => setDialogo('nenhum')}
          />
        </Modal>
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
            if (!valorMovimento.trim() || parseCurrencyInput(valorMovimento) <= 0) {
              return setErro('Informe um valor válido');
            }
            movimento.mutate();
          }}
        >
          {erro && <div className="alert-error">{erro}</div>}
          <div>
            <label className="label">Valor (R$)</label>
            <CurrencyInput autoFocus value={valorMovimento} onChange={setValorMovimento} />
          </div>
          <div>
            <label className="label">Observação (opcional)</label>
            <input className="input" value={obsMovimento} onChange={(e) => setObsMovimento(e.target.value)} />
          </div>
          <button type="submit" className="touch-btn-primary w-full" disabled={movimento.isPending} data-audit={tipoMovimento === 'SANGRIA' ? 'quiosque-caixa-sangria' : 'quiosque-caixa-suprimento'}>
            {movimento.isPending ? 'Salvando...' : 'Confirmar'}
          </button>
        </form>
      </Modal>

      <Modal open={dialogo === 'correcao'} onClose={() => !corrigir.isPending && setDialogo('nenhum')} title="Corrigir movimentação">
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          if (!valorCorrigido.trim() || parseCurrencyInput(valorCorrigido) <= 0) return setErro('Informe o novo valor');
          if (!motivoCorrecao.trim()) return setErro('Informe o motivo da correção');
          corrigir.mutate();
        }}>
          {erro && <div className="alert-error">{erro}</div>}
          <p className="text-sm text-ink-faint">Valor atual: {movimentoParaCorrigir && formatCurrency(movimentoParaCorrigir.valor)}</p>
          <div><label className="label">Novo valor (R$)</label><CurrencyInput autoFocus value={valorCorrigido} onChange={setValorCorrigido} /></div>
          <div><label className="label">Motivo</label><input className="input" value={motivoCorrecao} onChange={(e) => setMotivoCorrecao(e.target.value)} maxLength={500} /></div>
          <fieldset className="space-y-3 border-t border-ink/10 pt-3"><legend className="text-sm font-semibold">Autorização do responsável</legend>
            <div><label className="label">E-mail do DONO</label><input className="input" type="email" autoComplete="username" value={autorizadorEmail} onChange={(e) => setAutorizadorEmail(e.target.value)} /></div>
            <div><label className="label">Senha</label><input className="input" type="password" autoComplete="current-password" value={autorizadorSenha} onChange={(e) => setAutorizadorSenha(e.target.value)} /></div>
          </fieldset>
          <button type="submit" className="touch-btn-primary w-full" disabled={corrigir.isPending} data-audit="quiosque-caixa-corrigir">{corrigir.isPending ? 'Corrigindo...' : 'Autorizar e corrigir'}</button>
        </form>
      </Modal>

      <Modal
        open={dialogo === 'fechar'}
        onClose={() => {
          if (fechar.isPending) return;
          setDialogo('nenhum');
          setErro('');
        }}
        title="Fechar caixa"
        hideHeaderClose
        footer={
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              className="touch-btn-secondary w-full min-h-14"
              disabled={fechar.isPending}
              onClick={() => {
                setDialogo('nenhum');
                setErro('');
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="fechar-caixa-form"
              className="touch-btn-orange w-full min-h-14"
              disabled={fechar.isPending}
              data-audit="quiosque-caixa-fechar-confirmar"
            >
              {fechar.isPending ? 'Fechando...' : 'Confirmar fechamento'}
            </button>
          </div>
        }
      >
        <form
          id="fechar-caixa-form"
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
                <CurrencyInput
                  value={contado[chave] ?? ''}
                  onChange={(valor) => setContado((atual) => ({ ...atual, [chave]: valor }))}
                />
              </div>
            );
          })}

          <div>
            <label className="label">Observação (opcional)</label>
            <input className="input" value={obsFechamento} onChange={(e) => setObsFechamento(e.target.value)} />
          </div>
        </form>
      </Modal>
    </>
  );
}
