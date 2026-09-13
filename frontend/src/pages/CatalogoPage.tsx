import { useState, useEffect } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api, formatCurrency, ApiError } from '../lib/api';

import type { Produto } from '../types';

import { VOLUMES, FOOD_UNIT_ML, FORMATO_BEBIDA_LABELS, FORMATOS_EMBALAGEM, isBebidaChope, type FormatoBebida } from '../types';

import { Loading } from '../components/Loading';

import { Modal } from '../components/Modal';
import { ModalFormFooter } from '../components/ModalFormFooter';

import { CurrencyInput } from '../components/CurrencyInput';

import { parseCurrencyInput, formatCurrencyInputFromNumber } from '../lib/currency';
import { invalidateOnboardingReadiness } from '../lib/onboarding';



type Tab = 'bebidas' | 'comida';

function sortByActiveThenName<T extends { ativo: boolean; nome?: string | null }>(items: T[]) {
  return [...items].sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    const nameA = a.nome ?? '';
    const nameB = b.nome ?? '';
    return nameA.localeCompare(nameB, 'pt-BR');
  });
}

function CatalogItemActions({
  active,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  active: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 shrink-0">
      <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={onEdit}>
        Editar
      </button>
      <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={onToggleActive}>
        {active ? 'Desativar' : 'Ativar'}
      </button>
      <button type="button" className="touch-btn-danger touch-btn-sm" onClick={onDelete}>
        Excluir
      </button>
    </div>
  );
}



export function CatalogoPage({ embedded }: { embedded?: boolean } = {}) {

  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('bebidas');

  const [showBebidaModal, setShowBebidaModal] = useState(false);

  const [showComidaModal, setShowComidaModal] = useState(false);

  const [editingProduto, setEditingProduto] = useState<Produto | null>(null);

  const [error, setError] = useState('');



  const { data: produtos, isLoading: loadingProdutos } = useQuery({

    queryKey: ['produtos'],

    queryFn: () => api.get<Produto[]>('/api/produtos'),

  });



  const toggleProdutoAtivo = useMutation({

    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.patch(`/api/produtos/${id}/ativo`, { ativo }),

    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['produtos'] }),

    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao atualizar'),

  });



  const deleteProduto = useMutation({

    mutationFn: (id: string) => api.delete(`/api/produtos/${id}`),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
    },

    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir'),

  });



  const handleToggleProduto = (produto: Produto) => {
    if (produto.ativo && !confirm(`Desativar "${produto.nome}"? Ele não ficará disponível para novas vendas.`)) return;
    toggleProdutoAtivo.mutate({ id: produto.id, ativo: !produto.ativo });
  };

  const handleDeleteProduto = (produto: Produto) => {
    if (!confirm(`Excluir "${produto.nome}" permanentemente? Esta ação não pode ser desfeita.`)) return;
    deleteProduto.mutate(produto.id);
  };

  if (loadingProdutos) return <Loading />;



  const bebidas = sortByActiveThenName(produtos?.filter((p) => p.tipo === 'BEBIDA') ?? []);
  const comidas = sortByActiveThenName(produtos?.filter((p) => p.tipo === 'COMIDA') ?? []);



  return (

    <div className="space-y-4">

      {!embedded && <h2 className="text-xl font-bold">Catálogo</h2>}

      <div className="segmented-control">
        {([
          ['bebidas', 'Bebidas'],
          ['comida', 'Comida'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`segmented-control-btn ${
              tab === key ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>



      {tab === 'bebidas' && (

        <div className="space-y-3">

          <button

            className="touch-btn-primary touch-btn-sm w-full"

            data-onboarding-target="brewery-add-chope"

            onClick={() => { setEditingProduto(null); setShowBebidaModal(true); }}

          >

            + Nova Bebida

          </button>

          {bebidas.map((p) => (

            <div
              key={p.id}
              className={`card flex flex-col sm:flex-row sm:items-center gap-3 justify-between ${!p.ativo ? 'opacity-60' : ''}`}
              style={{ borderLeftColor: p.cor ?? undefined, borderLeftWidth: p.cor ? 4 : undefined }}
            >

              <div className="min-w-0 flex-1">

                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-lg">{p.nome}</p>
                  {!p.ativo && (
                    <span className="badge-inactive">Inativo</span>
                  )}
                  {p.formato && (
                    <span className="text-xs bg-surface-lighter px-2 py-0.5 rounded-full text-ink-muted">
                      {FORMATO_BEBIDA_LABELS[p.formato]}
                    </span>
                  )}
                </div>

                {p.estilo && <p className="text-sm text-ink-muted">{p.estilo}</p>}

                <div className="flex flex-wrap gap-2 mt-1">

                  {isBebidaChope(p)
                    ? p.precos.map((pr) => (
                        <span key={pr.id} className="text-xs bg-surface-lighter px-2 py-0.5 rounded text-ink-muted">
                          {pr.volumeMl}ml: {formatCurrency(pr.preco)}
                        </span>
                      ))
                    : p.precos[0] && (
                        <span className="text-xs bg-surface-lighter px-2 py-0.5 rounded text-ink-muted">
                          {formatCurrency(p.precos[0].preco)}
                        </span>
                      )}

                </div>

              </div>

              <CatalogItemActions
                active={p.ativo}
                onEdit={() => { setEditingProduto(p); setShowBebidaModal(true); }}
                onToggleActive={() => handleToggleProduto(p)}
                onDelete={() => handleDeleteProduto(p)}
              />

            </div>

          ))}

          {bebidas.length === 0 && <p className="text-ink-faint text-center py-8">Nenhuma bebida cadastrada</p>}

        </div>

      )}



      {tab === 'comida' && (

        <div className="space-y-3">

          <button

            className="touch-btn-primary touch-btn-sm w-full"

            onClick={() => { setEditingProduto(null); setShowComidaModal(true); }}

          >

            + Nova Comida

          </button>

          {comidas.map((p) => {

            const preco = p.precos[0];

            return (

              <div key={p.id} className={`card flex flex-col sm:flex-row sm:items-center gap-3 justify-between ${!p.ativo ? 'opacity-60' : ''}`}>

                <div className="min-w-0 flex-1">

                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-lg">{p.nome}</p>
                    {!p.ativo && (
                      <span className="badge-inactive">Inativo</span>
                    )}
                  </div>

                  {p.descricao && <p className="text-sm text-ink-muted">{p.descricao}</p>}

                  {preco && (

                    <p className="text-brand-600 font-semibold mt-1">{formatCurrency(preco.preco)}</p>

                  )}

                </div>

                <CatalogItemActions
                  active={p.ativo}
                  onEdit={() => { setEditingProduto(p); setShowComidaModal(true); }}
                  onToggleActive={() => handleToggleProduto(p)}
                  onDelete={() => handleDeleteProduto(p)}
                />

              </div>

            );

          })}

          {comidas.length === 0 && <p className="text-ink-faint text-center py-8">Nenhuma comida cadastrada</p>}

        </div>

      )}



      <BebidaModal

        open={showBebidaModal}

        onClose={() => setShowBebidaModal(false)}

        produto={editingProduto?.tipo === 'BEBIDA' ? editingProduto : null}

        onError={setError}

      />

      <ComidaModal

        open={showComidaModal}

        onClose={() => setShowComidaModal(false)}

        produto={editingProduto?.tipo === 'COMIDA' ? editingProduto : null}

        onError={setError}

      />



      {error && <div className="alert-error">{error}</div>}

    </div>

  );

}



function BebidaModal({ open, onClose, produto, onError }: {
  open: boolean; onClose: () => void; produto: Produto | null; onError: (e: string) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    nome: '',
    descricao: '',
    formato: 'CHOPE' as FormatoBebida,
    cor: '#F5C842',
    estilo: '',
    precoUnitario: '',
    precos: VOLUMES.map((v) => ({ volumeMl: v, preco: '' })),
  });

  const isChope = form.formato === 'CHOPE';

  useEffect(() => {
    if (!open) return;
    if (produto) {
      const chope = isBebidaChope(produto);
      setForm({
        nome: produto.nome,
        descricao: produto.descricao ?? '',
        formato: produto.formato ?? 'CHOPE',
        cor: produto.cor ?? '#F5C842',
        estilo: produto.estilo ?? '',
        precoUnitario: !chope && produto.precos[0] ? formatCurrencyInputFromNumber(produto.precos[0].preco) : '',
        precos: VOLUMES.map((v) => {
          const p = produto.precos.find((pr) => pr.volumeMl === v);
          return { volumeMl: v, preco: p ? formatCurrencyInputFromNumber(p.preco) : '' };
        }),
      });
    } else {
      setForm({
        nome: '',
        descricao: '',
        formato: 'CHOPE',
        cor: '#F5C842',
        estilo: '',
        precoUnitario: '',
        precos: VOLUMES.map((v) => ({ volumeMl: v, preco: '' })),
      });
    }
  }, [produto, open]);

  const save = useMutation({
    mutationFn: () => {
      const precos = isChope
        ? form.precos
            .filter((p) => p.preco)
            .map((p) => ({ volumeMl: p.volumeMl, preco: parseCurrencyInput(p.preco) }))
        : [{ volumeMl: FOOD_UNIT_ML, preco: parseCurrencyInput(form.precoUnitario) }];

      const data = {
        tipo: 'BEBIDA' as const,
        formato: form.formato,
        nome: form.nome,
        descricao: form.descricao || undefined,
        cor: isChope ? form.cor : undefined,
        estilo: isChope ? form.estilo || undefined : undefined,
        precos,
      };
      return produto
        ? api.put(`/api/produtos/${produto.id}`, data)
        : api.post('/api/produtos', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      invalidateOnboardingReadiness(queryClient);
      onClose();
    },
    onError: (err) => onError(err instanceof ApiError ? err.message : 'Erro ao salvar'),
  });

  return (
    <Modal open={open} onClose={onClose} title={produto ? 'Editar Bebida' : 'Nova Bebida'}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <div>
          <label className="label">Formato</label>
          <select
            className="input"
            value={form.formato}
            onChange={(e) => setForm({ ...form, formato: e.target.value as FormatoBebida })}
          >
            <option value="CHOPE">Chope (tap / copo)</option>
            {FORMATOS_EMBALAGEM.map((f) => (
              <option key={f} value={f}>{FORMATO_BEBIDA_LABELS[f]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Nome</label>
          <input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
        </div>
        <div>
          <label className="label">Descrição (opcional)</label>
          <input className="input" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Marca, volume da embalagem..." />
        </div>
        {isChope ? (
          <>
            <div>
              <label className="label">Estilo</label>
              <input className="input" value={form.estilo} onChange={(e) => setForm({ ...form, estilo: e.target.value })} placeholder="Pilsen, IPA, Weiss..." />
            </div>
            <div>
              <label className="label">Cor</label>
              <input type="color" className="w-full h-14 rounded-xl" value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="label">Preços por volume</label>
              {form.precos.map((p, i) => (
                <div key={p.volumeMl} className="flex items-center gap-2">
                  <span className="w-16 text-ink-muted">{p.volumeMl}ml</span>
                  <CurrencyInput
                    className="input flex-1"
                    value={p.preco}
                    onChange={(value) => {
                      const updated = [...form.precos];
                      updated[i].preco = value;
                      setForm({ ...form, precos: updated });
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div>
            <label className="label">Preço</label>
            <CurrencyInput
              className="input"
              value={form.precoUnitario}
              onChange={(value) => setForm({ ...form, precoUnitario: value })}
              required
            />
          </div>
        )}
        <ModalFormFooter onCancel={onClose} pending={save.isPending} />
      </form>
    </Modal>
  );
}



function ComidaModal({ open, onClose, produto, onError }: {

  open: boolean; onClose: () => void; produto: Produto | null; onError: (e: string) => void;

}) {

  const queryClient = useQueryClient();

  const [form, setForm] = useState({ nome: '', descricao: '', preco: '' });



  useEffect(() => {

    if (!open) return;

    if (produto) {

      setForm({

        nome: produto.nome,

        descricao: produto.descricao ?? '',

        preco: produto.precos[0] ? formatCurrencyInputFromNumber(produto.precos[0].preco) : '',

      });

    } else {

      setForm({ nome: '', descricao: '', preco: '' });

    }

  }, [produto, open]);



  const save = useMutation({

    mutationFn: () => {

      const data = {

        tipo: 'COMIDA' as const,

        nome: form.nome,

        descricao: form.descricao || undefined,

        precos: [{ volumeMl: FOOD_UNIT_ML, preco: parseCurrencyInput(form.preco) }],

      };

      return produto

        ? api.put(`/api/produtos/${produto.id}`, data)

        : api.post('/api/produtos', data);

    },

    onSuccess: () => {

      queryClient.invalidateQueries({ queryKey: ['produtos'] });

      onClose();

    },

    onError: (err) => onError(err instanceof ApiError ? err.message : 'Erro ao salvar'),

  });



  return (

    <Modal open={open} onClose={onClose} title={produto ? 'Editar Comida' : 'Nova Comida'}>

      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">

        <div>

          <label className="label">Nome</label>

          <input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required placeholder="Hambúrguer, Porção de fritas..." />

        </div>

        <div>

          <label className="label">Descrição (opcional)</label>

          <input className="input" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Ingredientes, tamanho..." />

        </div>

        <div>

          <label className="label">Preço</label>

          <CurrencyInput
            className="input"
            value={form.preco}
            onChange={(value) => setForm({ ...form, preco: value })}
            required
          />

        </div>

        <ModalFormFooter onCancel={onClose} pending={save.isPending} />

      </form>

    </Modal>

  );

}


