import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Loading } from '../../components/Loading';
import { GradeProdutos } from '../../components/quiosque/GradeProdutos';
import { ResumoCarrinho } from '../../components/quiosque/ResumoCarrinho';
import { PagamentoPanel } from '../../components/quiosque/PagamentoPanel';
import {
  rotuloComanda,
  totalCarrinho,
  type ComandaQuiosque,
  type FormaPagamento,
  type LinhaCarrinho,
  type ProdutoQuiosque,
} from '../../lib/quiosque';

type Dialogo = 'nenhum' | 'itens' | 'pagamento';

export function QuiosqueComandaDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialogo, setDialogo] = useState<Dialogo>('nenhum');
  const [carrinho, setCarrinho] = useState<LinhaCarrinho[]>([]);
  const [erro, setErro] = useState('');

  const { data: comanda, isLoading } = useQuery({
    queryKey: ['quiosque-comanda', id],
    queryFn: () => api.get<ComandaQuiosque>(`/api/quiosque/comandas/${id}`),
  });

  const { data: produtos } = useQuery({
    queryKey: ['quiosque-produtos-ativos'],
    queryFn: () => api.get<ProdutoQuiosque[]>('/api/quiosque/produtos'),
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['quiosque-comanda', id] });
    queryClient.invalidateQueries({ queryKey: ['quiosque-comandas'] });
  };

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

  const lancarItens = useMutation({
    mutationFn: () =>
      api.post<ComandaQuiosque>(`/api/quiosque/comandas/${id}/pedidos`, {
        itens: carrinho.map((linha) => ({
          produtoId: linha.produto.id,
          quantidade: linha.quantidade,
        })),
      }),
    onSuccess: () => {
      invalidar();
      setCarrinho([]);
      setDialogo('nenhum');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível lançar os itens'),
  });

  const cobrar = useMutation({
    mutationFn: (pagamento: { forma: FormaPagamento; valor: number; valorRecebido?: number }) =>
      api.post<ComandaQuiosque>(`/api/quiosque/comandas/${id}/pagamentos`, {
        pagamentos: [pagamento],
      }),
    onSuccess: () => {
      invalidar();
      setDialogo('nenhum');
      navigate('/quiosque/comandas');
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível registrar o pagamento'),
  });

  if (isLoading) return <Loading />;
  if (!comanda) return <p className="text-ink-faint text-center py-10">Comanda não encontrada.</p>;

  const aberta = comanda.status === 'ABERTA';

  return (
    <div className="space-y-4 pb-24">
      <div className="card space-y-1 py-3">
        <p className="text-lg font-bold">{rotuloComanda(comanda)}</p>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-ink-faint">
            {aberta ? 'Saldo a pagar' : 'Comanda fechada'}
          </span>
          <span className="text-2xl font-bold">{formatCurrency(aberta ? comanda.saldo : comanda.total)}</span>
        </div>
      </div>

      {comanda.pedidos.map((pedido) => (
        <section key={pedido.id} className="card space-y-2 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Senha {pedido.numero}
            </span>
            {pedido.observacao && <span className="text-xs text-ink-faint">{pedido.observacao}</span>}
          </div>
          {pedido.itens.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {item.quantidade}× {item.nome}
              </span>
              <span className="shrink-0 font-semibold">{formatCurrency(item.subtotal)}</span>
            </div>
          ))}
        </section>
      ))}

      {comanda.pagamentos.length > 0 && (
        <section className="card space-y-2 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Pagamentos
          </span>
          {comanda.pagamentos.map((pagamento) => (
            <div key={pagamento.id} className="flex items-center justify-between gap-3 text-sm">
              <span>{pagamento.forma.replace('CARTAO_', 'Cartão ').toLowerCase()}</span>
              <span className="font-semibold">{formatCurrency(pagamento.valor)}</span>
            </div>
          ))}
          {comanda.pagamentos.some((pagamento) => pagamento.troco) && (
            <p className="text-xs text-ink-faint">
              Troco devolvido:{' '}
              {formatCurrency(
                comanda.pagamentos.reduce((soma, pagamento) => soma + (pagamento.troco ?? 0), 0),
              )}
            </p>
          )}
        </section>
      )}

      {aberta && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="touch-btn-primary"
            onClick={() => {
              setErro('');
              setDialogo('itens');
            }}
          >
            Adicionar itens
          </button>
          <button
            type="button"
            className="touch-btn-orange"
            disabled={comanda.saldo <= 0}
            onClick={() => {
              setErro('');
              setDialogo('pagamento');
            }}
          >
            Cobrar
          </button>
        </div>
      )}

      <Modal open={dialogo === 'itens'} onClose={() => setDialogo('nenhum')} title="Adicionar itens">
        <div className="space-y-4">
          {erro && <div className="alert-error">{erro}</div>}
          {produtos && <GradeProdutos produtos={produtos} onSelecionar={adicionar} />}

          {carrinho.length > 0 && (
            <div className="space-y-3 border-t border-line pt-3">
              <ResumoCarrinho linhas={carrinho} onAlterar={alterarQuantidade} />
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-ink-faint">Nesta rodada</span>
                <span className="text-xl font-bold">{formatCurrency(totalCarrinho(carrinho))}</span>
              </div>
              <button
                type="button"
                className="touch-btn-primary w-full"
                disabled={lancarItens.isPending}
                onClick={() => lancarItens.mutate()}
              >
                {lancarItens.isPending ? 'Lançando...' : 'Lançar na comanda'}
              </button>
            </div>
          )}
        </div>
      </Modal>

      <Modal open={dialogo === 'pagamento'} onClose={() => setDialogo('nenhum')} title="Cobrar comanda">
        {erro && <div className="alert-error mb-3">{erro}</div>}
        <PagamentoPanel
          total={comanda.saldo}
          confirmando={cobrar.isPending}
          textoConfirmar="Fechar comanda"
          onConfirmar={(pagamento) => cobrar.mutate(pagamento)}
        />
      </Modal>
    </div>
  );
}
