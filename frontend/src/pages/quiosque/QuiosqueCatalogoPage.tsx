import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Loading } from '../../components/Loading';
import { useAuth } from '../../contexts/AuthContext';
import { useQuiosqueContexto } from '../../hooks/useQuiosqueContexto';

interface ProdutoQuiosque {
  id: string;
  nome: string;
  categoria: string | null;
  precoUnit: string;
  exigePreparo: boolean;
  controlaEstoque: boolean;
  ativo: boolean;
  ordem: number;
}

const FORM_VAZIO = {
  nome: '',
  categoria: '',
  precoUnit: '',
  exigePreparo: false,
  controlaEstoque: true,
};

export function QuiosqueCatalogoPage() {
  const queryClient = useQueryClient();
  const { isDono } = useAuth();
  const { contexto } = useQuiosqueContexto();
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState<ProdutoQuiosque | null>(null);
  const [form, setForm] = useState({ ...FORM_VAZIO });
  const [error, setError] = useState('');

  const controlaEstoque = contexto.ativo && contexto.controlaEstoque;
  const temCozinha = contexto.ativo && contexto.temCozinha;

  const { data: produtos, isLoading } = useQuery({
    queryKey: ['quiosque-produtos'],
    queryFn: () => api.get<ProdutoQuiosque[]>('/api/quiosque/produtos?incluirInativos=true'),
  });

  const fechar = () => {
    setShowModal(false);
    setEditando(null);
    setForm({ ...FORM_VAZIO });
    setError('');
  };

  const abrirNovo = () => {
    setEditando(null);
    setForm({ ...FORM_VAZIO });
    setError('');
    setShowModal(true);
  };

  const abrirEdicao = (produto: ProdutoQuiosque) => {
    setEditando(produto);
    setForm({
      nome: produto.nome,
      categoria: produto.categoria ?? '',
      precoUnit: String(produto.precoUnit),
      exigePreparo: produto.exigePreparo,
      controlaEstoque: produto.controlaEstoque,
    });
    setError('');
    setShowModal(true);
  };

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        nome: form.nome.trim(),
        categoria: form.categoria.trim() || undefined,
        precoUnit: Number(form.precoUnit.replace(',', '.')),
        exigePreparo: form.exigePreparo,
        controlaEstoque: form.controlaEstoque,
      };
      return editando
        ? api.put(`/api/quiosque/produtos/${editando.id}`, corpo)
        : api.post('/api/quiosque/produtos', corpo);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quiosque-produtos'] });
      fechar();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao salvar produto'),
  });

  const alternarAtivo = useMutation({
    mutationFn: (produto: ProdutoQuiosque) =>
      api.put(`/api/quiosque/produtos/${produto.id}`, { ativo: !produto.ativo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quiosque-produtos'] }),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const preco = Number(form.precoUnit.replace(',', '.'));
    if (!form.nome.trim()) return setError('Informe o nome do produto');
    if (!preco || preco <= 0) return setError('Informe um preço maior que zero');
    setError('');
    salvar.mutate();
  };

  if (isLoading) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">Catálogo do quiosque</h2>
          <p className="text-sm text-ink-faint">
            Produtos vendidos por unidade, separados do catálogo de chope.
          </p>
        </div>
      </div>

      {isDono && (
        <button type="button" className="touch-btn-orange w-full" onClick={abrirNovo}>
          + Produto
        </button>
      )}

      {produtos?.length === 0 && (
        <p className="text-ink-faint text-center py-8">
          Nenhum produto ainda. Cadastre o que o quiosque vende para liberar a venda rápida.
        </p>
      )}

      <div className="space-y-2">
        {produtos?.map((produto) => (
          <div key={produto.id} className="card flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className={`font-semibold truncate ${produto.ativo ? '' : 'text-ink-faint line-through'}`}>
                {produto.nome}
              </p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                <span>{formatCurrency(produto.precoUnit)}</span>
                {produto.categoria && <span>· {produto.categoria}</span>}
                {temCozinha && produto.exigePreparo && (
                  <span className="rounded-full bg-orange/10 px-2 py-0.5 font-semibold text-orange">
                    cozinha
                  </span>
                )}
                {controlaEstoque && !produto.controlaEstoque && (
                  <span className="rounded-full bg-surface-lighter px-2 py-0.5">sem estoque</span>
                )}
              </p>
            </div>
            {isDono && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="touch-btn-ghost touch-btn-sm"
                  onClick={() => alternarAtivo.mutate(produto)}
                >
                  {produto.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button
                  type="button"
                  className="touch-btn-ghost touch-btn-sm"
                  onClick={() => abrirEdicao(produto)}
                >
                  Editar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal
        open={showModal}
        onClose={fechar}
        title={editando ? `Editar — ${editando.nome}` : 'Novo produto'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="alert-error">{error}</div>}

          <div>
            <label className="label">Nome</label>
            <input
              className="input"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Preço</label>
              <input
                className="input"
                inputMode="decimal"
                placeholder="0,00"
                value={form.precoUnit}
                onChange={(e) => setForm({ ...form, precoUnit: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Categoria</label>
              <input
                className="input"
                placeholder="Bebidas"
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
              />
            </div>
          </div>

          {temCozinha && (
            <label className="card flex cursor-pointer items-start gap-3 py-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-brand-400"
                checked={form.exigePreparo}
                onChange={(e) => setForm({ ...form, exigePreparo: e.target.checked })}
              />
              <span className="min-w-0">
                <span className="block font-semibold">Vai para a cozinha</span>
                <span className="block text-xs text-ink-faint">
                  Gera pedido de preparo na fila, por ordem de chegada.
                </span>
              </span>
            </label>
          )}

          {controlaEstoque && (
            <label className="card flex cursor-pointer items-start gap-3 py-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-brand-400"
                checked={form.controlaEstoque}
                onChange={(e) => setForm({ ...form, controlaEstoque: e.target.checked })}
              />
              <span className="min-w-0">
                <span className="block font-semibold">Controlar estoque</span>
                <span className="block text-xs text-ink-faint">
                  Desmarque para itens sem contagem, como gelo ou copo.
                </span>
              </span>
            </label>
          )}

          <button type="submit" className="touch-btn-primary w-full" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
