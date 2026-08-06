import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Loading } from '../../components/Loading';
import { GradeProdutos } from '../../components/quiosque/GradeProdutos';
import { ResumoCarrinho } from '../../components/quiosque/ResumoCarrinho';
import { PagamentoPanel } from '../../components/quiosque/PagamentoPanel';
import { useQuiosqueContexto } from '../../hooks/useQuiosqueContexto';
import {
  TIPOS_COMANDA,
  totalCarrinho,
  type CaixaResposta,
  type ComandaQuiosque,
  type FormaPagamento,
  type LinhaCarrinho,
  type ProdutoQuiosque,
} from '../../lib/quiosque';

type Dialogo = 'nenhum' | 'pagamento' | 'comanda';

export function QuiosquePdvPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { contexto } = useQuiosqueContexto();
  const pontosVenda = contexto.ativo ? contexto.pontosVenda : [];

  const [pontoVendaId, setPontoVendaId] = useState('');
  const [carrinho, setCarrinho] = useState<LinhaCarrinho[]>([]);
  const [dialogo, setDialogo] = useState<Dialogo>('nenhum');
  const [tipoComanda, setTipoComanda] = useState<'APELIDO' | 'MESA' | 'FICHA'>('APELIDO');
  const [identificador, setIdentificador] = useState('');
  const [erro, setErro] = useState('');
  const [recibo, setRecibo] = useState<ComandaQuiosque | null>(null);

  const pontoAtivo = pontoVendaId || pontosVenda[0]?.id || '';

  const { data: produtos, isLoading } = useQuery({
    queryKey: ['quiosque-produtos-ativos'],
    queryFn: () => api.get<ProdutoQuiosque[]>('/api/quiosque/produtos'),
  });

  const { data: caixaData } = useQuery({
    queryKey: ['quiosque-caixa', pontoAtivo],
    queryFn: () => api.get<CaixaResposta>(`/api/quiosque/caixa?pontoVendaId=${pontoAtivo}`),
    enabled: Boolean(pontoAtivo),
    refetchInterval: 30_000,
  });

  const caixaAberto = caixaData?.sessao?.status === 'ABERTO';
  const temCozinha = contexto.ativo && contexto.temCozinha;
  const total = totalCarrinho(carrinho);

  const adicionar = (produto: ProdutoQuiosque) => {
    setCarrinho((atual) => {
      const existente = atual.find((linha) => linha.produto.id === produto.id);
      if (!existente) return [...atual, { produto, quantidade: 1 }];
      return atual.map((linha) =>
        linha.produto.id === produto.id ? { ...linha, quantidade: linha.quantidade + 1 } : linha,
      );
    });
  };

  const alterarQuantidade = (produtoId: string, delta: number) => {
    setCarrinho((atual) =>
      atual
        .map((linha) =>
          linha.produto.id === produtoId
            ? { ...linha, quantidade: linha.quantidade + delta }
            : linha,
        )
        .filter((linha) => linha.quantidade > 0),
    );
  };

  const limpar = () => {
    setCarrinho([]);
    setErro('');
    setDialogo('nenhum');
  };

  const itensDoCarrinho = () =>
    carrinho.map((linha) => ({ produtoId: linha.produto.id, quantidade: linha.quantidade }));

  const cobrar = useMutation({
    mutationFn: (pagamento: { forma: FormaPagamento; valor: number; valorRecebido?: number }) =>
      api.post<ComandaQuiosque>('/api/quiosque/vendas', {
        pontoVendaId: pontoAtivo,
        itens: itensDoCarrinho(),
        pagamentos: [pagamento],
      }),
    onSuccess: (venda) => {
      queryClient.invalidateQueries({ queryKey: ['quiosque-comandas'] });
      queryClient.invalidateQueries({ queryKey: ['quiosque-caixa', pontoAtivo] });
      limpar();
      setRecibo(venda);
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível concluir a venda'),
  });

  const abrirComanda = useMutation({
    mutationFn: () =>
      api.post<ComandaQuiosque>('/api/quiosque/comandas', {
        pontoVendaId: pontoAtivo,
        tipo: tipoComanda,
        identificador: identificador.trim(),
        itens: itensDoCarrinho(),
      }),
    onSuccess: (comanda) => {
      queryClient.invalidateQueries({ queryKey: ['quiosque-comandas'] });
      setCarrinho([]);
      setIdentificador('');
      setDialogo('nenhum');
      navigate(`/quiosque/comandas/${comanda.id}`);
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível abrir a comanda'),
  });

  if (isLoading) return <Loading />;

  if (!produtos || produtos.length === 0) {
    return (
      <p className="text-ink-faint text-center py-10">
        Cadastre produtos no catálogo para começar a vender.
      </p>
    );
  }

  return (
    <div className={`space-y-4 ${carrinho.length > 0 ? 'page-with-action-bar' : ''}`}>
      {!caixaAberto && pontoAtivo && (
        <div className="alert-error">
          Caixa fechado.{' '}
          <Link to="/quiosque/caixa" className="underline font-semibold">
            Abra o caixa
          </Link>{' '}
          para registrar vendas.
        </div>
      )}

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

      <GradeProdutos produtos={produtos} onSelecionar={adicionar} />

      {carrinho.length > 0 && (
        <div className="mobile-action-bar">
          <div className="mobile-action-bar-inner">
            <div className="max-h-32 overflow-y-auto">
              <ResumoCarrinho linhas={carrinho} onAlterar={alterarQuantidade} />
            </div>

            <div className="flex items-baseline justify-between">
              <button type="button" className="text-sm text-ink-faint underline" onClick={limpar}>
                Limpar
              </button>
              <span className="text-2xl font-bold">{formatCurrency(total)}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="touch-btn-primary"
                disabled={!caixaAberto}
                onClick={() => {
                  setErro('');
                  setDialogo('comanda');
                }}
              >
                Abrir comanda
              </button>
              <button
                type="button"
                className="touch-btn-orange"
                disabled={!caixaAberto}
                onClick={() => {
                  setErro('');
                  setDialogo('pagamento');
                }}
              >
                Cobrar
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal open={dialogo === 'pagamento'} onClose={() => setDialogo('nenhum')} title="Cobrar">
        {erro && <div className="alert-error mb-3">{erro}</div>}
        <PagamentoPanel
          total={total}
          confirmando={cobrar.isPending}
          textoConfirmar="Confirmar venda"
          onConfirmar={(pagamento) => cobrar.mutate(pagamento)}
        />
      </Modal>

      <Modal open={dialogo === 'comanda'} onClose={() => setDialogo('nenhum')} title="Abrir comanda">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!identificador.trim()) return setErro('Informe o apelido, mesa ou ficha');
            setErro('');
            abrirComanda.mutate();
          }}
        >
          {erro && <div className="alert-error">{erro}</div>}

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
              {tipoComanda === 'APELIDO' ? 'Nome ou apelido' : `Número da ${tipoComanda === 'MESA' ? 'mesa' : 'ficha'}`}
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

          <div className="card flex items-baseline justify-between py-3">
            <span className="text-sm text-ink-faint">Já lançado</span>
            <span className="text-xl font-bold">{formatCurrency(total)}</span>
          </div>

          <button type="submit" className="touch-btn-primary w-full" disabled={abrirComanda.isPending}>
            {abrirComanda.isPending ? 'Abrindo...' : 'Abrir comanda'}
          </button>
        </form>
      </Modal>

      <Modal open={recibo !== null} onClose={() => setRecibo(null)} title="Venda concluída">
        {recibo && (
          <div className="space-y-4">
            <div className="card flex items-baseline justify-between py-3">
              <span className="text-sm text-ink-faint">Total</span>
              <span className="text-2xl font-bold">{formatCurrency(recibo.total)}</span>
            </div>
            {recibo.pagamentos[0]?.troco ? (
              <div className="card flex items-baseline justify-between border-orange/40 py-3">
                <span className="text-sm font-semibold text-orange">Troco</span>
                <span className="text-3xl font-bold text-orange">
                  {formatCurrency(recibo.pagamentos[0].troco)}
                </span>
              </div>
            ) : null}
            {temCozinha &&
            recibo.pedidos.some((pedido) => pedido.itens.some((item) => item.exigePreparo)) ? (
              <p className="text-sm text-ink-faint">
                Senha {recibo.pedidos[0]?.numero} enviada para a cozinha.
              </p>
            ) : null}
            <button type="button" className="touch-btn-primary w-full" onClick={() => setRecibo(null)}>
              Nova venda
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
