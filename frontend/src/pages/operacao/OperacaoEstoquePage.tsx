import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/Modal';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { usePollInterval } from '../../hooks/usePollInterval';
import { useAuth } from '../../contexts/AuthContext';
import { invalidateOnboardingReadiness } from '../../lib/onboarding';
import {
  TIPOS_SAIDA_ESTOQUE,
  type SaldoEstoque,
  type TipoSaidaEstoque,
  normalizeCategoriaProduto,
} from '../../lib/operacao';

type Dialogo = 'nenhum' | 'entrada' | 'saida' | 'ajuste';

function parseQuantidadeEstoque(value: string) {
  return Number(value.trim().replace(',', '.'));
}

export function OperacaoEstoquePage() {
  const queryClient = useQueryClient();
  const { contexto, isLoading: isContextoLoading } = useOperacaoContexto();
  const { isDono, canPermission } = useAuth();
  const podeMovimentar = canPermission('inventory.adjust');
  const pontosVenda = contexto.ativo ? contexto.pontosVenda : [];

  const [pontoVendaId, setPontoVendaId] = useState('');
  const [dialogo, setDialogo] = useState<Dialogo | 'minimo'>('nenhum');
  const [produtoSelecionado, setProdutoSelecionado] = useState<SaldoEstoque | null>(null);
  const [quantidade, setQuantidade] = useState('1');
  const [quantidadeNova, setQuantidadeNova] = useState('');
  const [estoqueMinimo, setEstoqueMinimo] = useState('');
  const [tipoSaida, setTipoSaida] = useState<TipoSaidaEstoque>('PERDA');
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState('');

  const pontoAtivo = pontoVendaId || pontosVenda[0]?.id || '';
  const pollMs = usePollInterval(30_000);

  const { data: saldos, isLoading } = useQuery({
    queryKey: ['operacao-estoque', pontoAtivo],
    queryFn: () => api.get<SaldoEstoque[]>(`/api/operacao/estoque?pontoVendaId=${pontoAtivo}`),
    enabled: Boolean(pontoAtivo),
    refetchInterval: pollMs,
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['operacao-estoque', pontoAtivo] });
  };

  const fecharDialogo = () => {
    setDialogo('nenhum');
    setProdutoSelecionado(null);
    setQuantidade('1');
    setQuantidadeNova('');
    setEstoqueMinimo('');
    setObservacao('');
    setErro('');
  };

  const abrirEntrada = (produto: SaldoEstoque) => {
    setProdutoSelecionado(produto);
    setQuantidade('1');
    setObservacao('');
    setErro('');
    setDialogo('entrada');
  };

  const abrirSaida = (produto: SaldoEstoque) => {
    setProdutoSelecionado(produto);
    setQuantidade('1');
    setTipoSaida('PERDA');
    setObservacao('');
    setErro('');
    setDialogo('saida');
  };

  const abrirAjuste = (produto: SaldoEstoque) => {
    setProdutoSelecionado(produto);
    setQuantidadeNova(String(produto.quantidade));
    setObservacao('');
    setErro('');
    setDialogo('ajuste');
  };

  const abrirMinimo = (produto: SaldoEstoque) => {
    setProdutoSelecionado(produto);
    setEstoqueMinimo(produto.estoqueMinimo === null ? '' : String(produto.estoqueMinimo));
    setErro('');
    setDialogo('minimo');
  };

  const entrada = useMutation({
    mutationFn: () =>
      api.post<SaldoEstoque[]>('/api/operacao/estoque/entrada', {
        pontoVendaId: pontoAtivo,
        produtoId: produtoSelecionado!.produtoId,
        quantidade: parseQuantidadeEstoque(quantidade),
        observacao: observacao.trim() || undefined,
      }),
    onSuccess: () => {
      invalidar();
      invalidateOnboardingReadiness(queryClient);
      fecharDialogo();
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível repor'),
  });

  const saida = useMutation({
    mutationFn: () =>
      api.post<SaldoEstoque[]>('/api/operacao/estoque/saida', {
        pontoVendaId: pontoAtivo,
        produtoId: produtoSelecionado!.produtoId,
        tipo: tipoSaida,
        quantidade: parseQuantidadeEstoque(quantidade),
        observacao: observacao.trim() || undefined,
      }),
    onSuccess: () => {
      invalidar();
      invalidateOnboardingReadiness(queryClient);
      fecharDialogo();
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível registrar a saída'),
  });

  const ajuste = useMutation({
    mutationFn: () =>
      api.post<SaldoEstoque[]>('/api/operacao/estoque/ajuste', {
        pontoVendaId: pontoAtivo,
        produtoId: produtoSelecionado!.produtoId,
        quantidadeNova: parseQuantidadeEstoque(quantidadeNova),
        observacao: observacao.trim() || undefined,
      }),
    onSuccess: () => {
      invalidar();
      invalidateOnboardingReadiness(queryClient);
      fecharDialogo();
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível ajustar'),
  });

  const minimo = useMutation({
    mutationFn: () =>
      api.put<SaldoEstoque[]>('/api/operacao/estoque/minimo', {
        pontoVendaId: pontoAtivo,
        produtoId: produtoSelecionado!.produtoId,
        estoqueMinimo: estoqueMinimo === '' ? null : parseQuantidadeEstoque(estoqueMinimo),
      }),
    onSuccess: () => {
      invalidar();
      fecharDialogo();
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível salvar o aviso'),
  });

  const criarLocalEstoque = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/operacao/pontos-venda', { nome: 'Estoque principal' }),
    onSuccess: async (pontoVenda) => {
      setPontoVendaId(pontoVenda.id);
      await queryClient.invalidateQueries({ queryKey: ['operacao-contexto'] });
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível criar o local de estoque'),
  });

  if (isContextoLoading) return <Loading />;
  if (isLoading) return <Loading />;

  if (pontosVenda.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          title="Estoque sem local vinculado"
          description="Os saldos são organizados por local. Crie um local principal para começar a lançar e ajustar o estoque; isso não abre um caixa."
        />
        {isDono && (
          <div className="space-y-2">
            {erro && <div className="alert-error">{erro}</div>}
            <button
              type="button"
              className="touch-btn-primary w-full"
              onClick={() => { setErro(''); criarLocalEstoque.mutate(); }}
              disabled={criarLocalEstoque.isPending}
            >
              {criarLocalEstoque.isPending ? 'Criando local...' : 'Criar estoque principal'}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-2">
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

      {!saldos || saldos.length === 0 ? (
        <EmptyState
          icon="📦"
          title="Nenhum produto com estoque"
          description="Marque produtos no catálogo para controlar saldo."
        />
      ) : (
        <div className="space-y-2">
          {[...saldos].sort((a, b) => {
            const prioridade = { OUT_OF_STOCK: 0, LOW: 1, NORMAL: 2 };
            return prioridade[a.statusEstoque] - prioridade[b.statusEstoque];
          }).map((item) => (
            <div key={item.produtoId} className="card-touch space-y-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{item.nome}</p>
                  {item.categoria && (
                    <p className="text-xs text-ink-faint">{normalizeCategoriaProduto(item.categoria)}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 text-2xl font-bold ${item.statusEstoque === 'OUT_OF_STOCK' ? 'text-red-600' : ''}`}
                >
                  {item.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {item.unidadeEstoque}
                </span>
              </div>

              {item.statusEstoque === 'OUT_OF_STOCK' ? (
                <p className="text-sm font-semibold text-red-600">Esgotado</p>
              ) : item.statusEstoque === 'LOW' ? (
                <p className="text-sm font-semibold text-orange-700">Estoque baixo · restam {item.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {item.unidadeEstoque}</p>
              ) : null}

              {podeMovimentar && <div className="grid grid-cols-3 gap-2">
                <button type="button" className="touch-btn-primary touch-btn-sm" onClick={() => abrirEntrada(item)} data-audit="operacao-estoque-repor">
                  Repor
                </button>
                <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => abrirSaida(item)} data-audit="operacao-estoque-saida">
                  Saída
                </button>
                <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => abrirAjuste(item)} data-audit="operacao-estoque-ajustar" data-onboarding-target="operacao-adjust-stock">
                  Ajustar
                </button>
              </div>}
              {isDono && (
                <button type="button" className="touch-btn-secondary touch-btn-sm w-full" onClick={() => abrirMinimo(item)} data-audit="operacao-estoque-minimo">
                  {item.estoqueMinimo === null ? 'Definir aviso de estoque baixo' : `Avisar quando chegar a ${item.estoqueMinimo} ${item.unidadeEstoque}`}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={dialogo === 'entrada'} onClose={fecharDialogo} title={`Repor — ${produtoSelecionado?.nome ?? ''}`}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!quantidade || parseQuantidadeEstoque(quantidade) <= 0) return setErro('Informe a quantidade');
            entrada.mutate();
          }}
        >
          {erro && <div className="alert-error">{erro}</div>}
          <div>
            <label className="label">Quantidade ({produtoSelecionado?.unidadeEstoque ?? 'un'})</label>
            <input
              className="input"
              autoFocus
              inputMode={produtoSelecionado?.unidadeEstoque === 'L' ? 'decimal' : 'numeric'}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Observação (opcional)</label>
            <input className="input" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
          <button type="submit" className="touch-btn-primary w-full" disabled={entrada.isPending} data-audit="operacao-estoque-repor-confirmar">
            {entrada.isPending ? 'Salvando...' : 'Confirmar reposição'}
          </button>
        </form>
      </Modal>

      <Modal open={dialogo === 'saida'} onClose={fecharDialogo} title={`Saída — ${produtoSelecionado?.nome ?? ''}`}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!quantidade || parseQuantidadeEstoque(quantidade) <= 0) return setErro('Informe a quantidade');
            saida.mutate();
          }}
        >
          {erro && <div className="alert-error">{erro}</div>}
          <div>
            <label className="label">Motivo</label>
            <div className="segmented-control">
              {TIPOS_SAIDA_ESTOQUE.map((opcao) => (
                <button
                  key={opcao.valor}
                  type="button"
                  onClick={() => setTipoSaida(opcao.valor)}
                  className={`segmented-control-btn ${
                    tipoSaida === opcao.valor
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
            <label className="label">Quantidade ({produtoSelecionado?.unidadeEstoque ?? 'un'})</label>
            <input
              className="input"
              inputMode={produtoSelecionado?.unidadeEstoque === 'L' ? 'decimal' : 'numeric'}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Observação (opcional)</label>
            <input className="input" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
          <button type="submit" className="touch-btn-primary w-full" disabled={saida.isPending} data-audit="operacao-estoque-saida-confirmar">
            {saida.isPending ? 'Salvando...' : 'Registrar saída'}
          </button>
        </form>
      </Modal>

      <Modal open={dialogo === 'ajuste'} onClose={fecharDialogo} title={`Ajustar — ${produtoSelecionado?.nome ?? ''}`}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (quantidadeNova === '' || parseQuantidadeEstoque(quantidadeNova) < 0) {
              return setErro('Informe a quantidade contada');
            }
            ajuste.mutate();
          }}
        >
          {erro && <div className="alert-error">{erro}</div>}
          <p className="text-sm text-ink-faint">
            {produtoSelecionado?.unidadeEstoque === 'L' ? 'Informe quantos litros existem fisicamente agora.' : 'Informe quantas unidades existem fisicamente agora.'} O sistema calcula a diferença.
          </p>
          <div>
            <label className="label">Quantidade contada ({produtoSelecionado?.unidadeEstoque ?? 'un'})</label>
            <input
              className="input"
              autoFocus
              inputMode={produtoSelecionado?.unidadeEstoque === 'L' ? 'decimal' : 'numeric'}
              value={quantidadeNova}
              onChange={(e) => setQuantidadeNova(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Observação (opcional)</label>
            <input className="input" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
          <button type="submit" className="touch-btn-primary w-full" disabled={ajuste.isPending} data-audit="operacao-estoque-ajuste-confirmar">
            {ajuste.isPending ? 'Salvando...' : 'Confirmar ajuste'}
          </button>
        </form>
      </Modal>

      <Modal open={dialogo === 'minimo'} onClose={fecharDialogo} title={`Aviso de estoque — ${produtoSelecionado?.nome ?? ''}`}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const valorMinimo = parseQuantidadeEstoque(estoqueMinimo);
            if (estoqueMinimo !== '' && (valorMinimo < 0 || (produtoSelecionado?.unidadeEstoque === 'L' ? Math.abs(Math.round(valorMinimo * 1000) / 1000 - valorMinimo) > 1e-9 : !Number.isInteger(valorMinimo)))) {
              return setErro('Informe um número inteiro igual ou maior que zero');
            }
            minimo.mutate();
          }}
        >
          {erro && <div className="alert-error">{erro}</div>}
          <p className="text-sm text-ink-faint">Saldo atual: {produtoSelecionado?.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) ?? 0} {produtoSelecionado?.unidadeEstoque}. Deixe vazio para não avisar quando estiver baixo.</p>
          <div>
            <label className="label">Avisar quando chegar a ({produtoSelecionado?.unidadeEstoque ?? 'un'})</label>
            <input className="input" autoFocus inputMode={produtoSelecionado?.unidadeEstoque === 'L' ? 'decimal' : 'numeric'} value={estoqueMinimo} onChange={(e) => setEstoqueMinimo(e.target.value)} placeholder={produtoSelecionado?.unidadeEstoque === 'L' ? 'Ex.: 5,5' : 'Ex.: 3'} />
          </div>
          <button type="submit" className="touch-btn-primary w-full" disabled={minimo.isPending} data-audit="operacao-estoque-minimo-confirmar">
            {minimo.isPending ? 'Salvando...' : 'Salvar aviso'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
