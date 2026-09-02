import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/Modal';
import { useQuiosqueContexto } from '../../hooks/useQuiosqueContexto';
import { usePollInterval } from '../../hooks/usePollInterval';
import { useAuth } from '../../contexts/AuthContext';
import {
  TIPOS_SAIDA_ESTOQUE,
  type SaldoEstoque,
  type TipoSaidaEstoque,
  normalizeCategoriaProduto,
} from '../../lib/quiosque';

type Dialogo = 'nenhum' | 'entrada' | 'saida' | 'ajuste';

export function QuiosqueEstoquePage() {
  const queryClient = useQueryClient();
  const { contexto } = useQuiosqueContexto();
  const { isDono } = useAuth();
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
    queryKey: ['quiosque-estoque', pontoAtivo],
    queryFn: () => api.get<SaldoEstoque[]>(`/api/quiosque/estoque?pontoVendaId=${pontoAtivo}`),
    enabled: Boolean(pontoAtivo),
    refetchInterval: pollMs,
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['quiosque-estoque', pontoAtivo] });
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
      api.post<SaldoEstoque[]>('/api/quiosque/estoque/entrada', {
        pontoVendaId: pontoAtivo,
        produtoId: produtoSelecionado!.produtoId,
        quantidade: Number(quantidade),
        observacao: observacao.trim() || undefined,
      }),
    onSuccess: () => {
      invalidar();
      fecharDialogo();
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível repor'),
  });

  const saida = useMutation({
    mutationFn: () =>
      api.post<SaldoEstoque[]>('/api/quiosque/estoque/saida', {
        pontoVendaId: pontoAtivo,
        produtoId: produtoSelecionado!.produtoId,
        tipo: tipoSaida,
        quantidade: Number(quantidade),
        observacao: observacao.trim() || undefined,
      }),
    onSuccess: () => {
      invalidar();
      fecharDialogo();
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível registrar a saída'),
  });

  const ajuste = useMutation({
    mutationFn: () =>
      api.post<SaldoEstoque[]>('/api/quiosque/estoque/ajuste', {
        pontoVendaId: pontoAtivo,
        produtoId: produtoSelecionado!.produtoId,
        quantidadeNova: Number(quantidadeNova),
        observacao: observacao.trim() || undefined,
      }),
    onSuccess: () => {
      invalidar();
      fecharDialogo();
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível ajustar'),
  });

  const minimo = useMutation({
    mutationFn: () =>
      api.put<SaldoEstoque[]>('/api/quiosque/estoque/minimo', {
        pontoVendaId: pontoAtivo,
        produtoId: produtoSelecionado!.produtoId,
        estoqueMinimo: estoqueMinimo === '' ? null : Number(estoqueMinimo),
      }),
    onSuccess: () => {
      invalidar();
      fecharDialogo();
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível salvar o aviso'),
  });

  if (isLoading) return <Loading />;

  if (pontosVenda.length === 0) {
    return (
      <EmptyState
        title="Nenhum ponto de venda"
        description="Cadastre um ponto de venda para controlar estoque."
      />
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
                  {item.quantidade}
                </span>
              </div>

              {item.statusEstoque === 'OUT_OF_STOCK' ? (
                <p className="text-sm font-semibold text-red-600">Esgotado</p>
              ) : item.statusEstoque === 'LOW' ? (
                <p className="text-sm font-semibold text-orange-700">Estoque baixo · restam {item.quantidade}</p>
              ) : null}

              <div className="grid grid-cols-3 gap-2">
                <button type="button" className="touch-btn-primary touch-btn-sm" onClick={() => abrirEntrada(item)} data-audit="quiosque-estoque-repor">
                  Repor
                </button>
                <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => abrirSaida(item)} data-audit="quiosque-estoque-saida">
                  Saída
                </button>
                <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => abrirAjuste(item)} data-audit="quiosque-estoque-ajustar">
                  Ajustar
                </button>
              </div>
              {isDono && (
                <button type="button" className="touch-btn-secondary touch-btn-sm w-full" onClick={() => abrirMinimo(item)} data-audit="quiosque-estoque-minimo">
                  {item.estoqueMinimo === null ? 'Definir aviso de estoque baixo' : `Avisar quando chegar a ${item.estoqueMinimo}`}
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
            if (!quantidade || Number(quantidade) <= 0) return setErro('Informe a quantidade');
            entrada.mutate();
          }}
        >
          {erro && <div className="alert-error">{erro}</div>}
          <div>
            <label className="label">Quantidade</label>
            <input
              className="input"
              autoFocus
              inputMode="numeric"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Observação (opcional)</label>
            <input className="input" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
          <button type="submit" className="touch-btn-primary w-full" disabled={entrada.isPending} data-audit="quiosque-estoque-repor-confirmar">
            {entrada.isPending ? 'Salvando...' : 'Confirmar reposição'}
          </button>
        </form>
      </Modal>

      <Modal open={dialogo === 'saida'} onClose={fecharDialogo} title={`Saída — ${produtoSelecionado?.nome ?? ''}`}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!quantidade || Number(quantidade) <= 0) return setErro('Informe a quantidade');
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
            <label className="label">Quantidade</label>
            <input
              className="input"
              inputMode="numeric"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Observação (opcional)</label>
            <input className="input" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
          <button type="submit" className="touch-btn-orange w-full" disabled={saida.isPending} data-audit="quiosque-estoque-saida-confirmar">
            {saida.isPending ? 'Salvando...' : 'Registrar saída'}
          </button>
        </form>
      </Modal>

      <Modal open={dialogo === 'ajuste'} onClose={fecharDialogo} title={`Ajustar — ${produtoSelecionado?.nome ?? ''}`}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (quantidadeNova === '' || Number(quantidadeNova) < 0) {
              return setErro('Informe a quantidade contada');
            }
            ajuste.mutate();
          }}
        >
          {erro && <div className="alert-error">{erro}</div>}
          <p className="text-sm text-ink-faint">
            Informe quantas unidades existem fisicamente agora. O sistema calcula a diferença.
          </p>
          <div>
            <label className="label">Quantidade contada</label>
            <input
              className="input"
              autoFocus
              inputMode="numeric"
              value={quantidadeNova}
              onChange={(e) => setQuantidadeNova(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Observação (opcional)</label>
            <input className="input" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
          <button type="submit" className="touch-btn-primary w-full" disabled={ajuste.isPending} data-audit="quiosque-estoque-ajuste-confirmar">
            {ajuste.isPending ? 'Salvando...' : 'Confirmar ajuste'}
          </button>
        </form>
      </Modal>

      <Modal open={dialogo === 'minimo'} onClose={fecharDialogo} title={`Aviso de estoque — ${produtoSelecionado?.nome ?? ''}`}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (estoqueMinimo !== '' && (!Number.isInteger(Number(estoqueMinimo)) || Number(estoqueMinimo) < 0)) {
              return setErro('Informe um número inteiro igual ou maior que zero');
            }
            minimo.mutate();
          }}
        >
          {erro && <div className="alert-error">{erro}</div>}
          <p className="text-sm text-ink-faint">Saldo atual: {produtoSelecionado?.quantidade ?? 0}. Deixe vazio para não avisar quando estiver baixo.</p>
          <div>
            <label className="label">Avisar quando chegar a</label>
            <input className="input" autoFocus inputMode="numeric" value={estoqueMinimo} onChange={(e) => setEstoqueMinimo(e.target.value)} placeholder="Ex.: 3" />
          </div>
          <button type="submit" className="touch-btn-primary w-full" disabled={minimo.isPending} data-audit="quiosque-estoque-minimo-confirmar">
            {minimo.isPending ? 'Salvando...' : 'Salvar aviso'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
