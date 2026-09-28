import { useEffect, useState } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api, ApiError } from '../../lib/api';

import type { CardapioOperacao, CardapioOperacaoItem, ProdutoOperacao } from '../../lib/operacao';

import { Modal } from '../../components/Modal';

import { ModalFormFooter } from '../../components/ModalFormFooter';

import { Loading } from '../../components/Loading';

import { CardapioOperacaoProdutosPicker } from '../../components/operacao/CardapioOperacaoProdutosPicker';



function itensFromCardapio(cardapio: CardapioOperacao): CardapioOperacaoItem[] {

  if (cardapio.itens?.length) {

    return cardapio.itens.map((i) => ({ produtoId: i.produtoId, volumeMl: i.volumeMl, precoUnit: i.precoUnit }));

  }

  if (cardapio.produtos?.length) {

    return cardapio.produtos.map((p) => ({

      produtoId: p.id,
      volumeMl: p.volumeMl,

      precoUnit: p.precoEfetivo ?? (parseFloat(p.precoUnit) || 0),

    }));

  }

  return (cardapio.produtoIds ?? []).map((produtoId) => ({ produtoId, precoUnit: 0 }));

}



export function CardapiosOperacaoPage({ embedded, modo = 'caixa' }: { embedded?: boolean; modo?: 'caixa' | 'evento' } = {}) {

  const queryClient = useQueryClient();

  const [showModal, setShowModal] = useState(false);

  const [editing, setEditing] = useState<CardapioOperacao | null>(null);

  const [nome, setNome] = useState('');

  const [itens, setItens] = useState<CardapioOperacaoItem[]>([]);

  const [error, setError] = useState('');



  const { data: cardapios, isLoading } = useQuery({

    queryKey: ['operacao-cardapios'],

    queryFn: () => api.get<CardapioOperacao[]>('/api/operacao/cardapios'),

  });



  const { data: catalogo } = useQuery({

    queryKey: ['operacao-cardapios', 'catalogo'],

    queryFn: () => api.get<ProdutoOperacao[]>('/api/operacao/cardapios/catalogo'),

    enabled: showModal,

  });



  useEffect(() => {

    if (editing) {

      setNome(editing.nome);

      setItens(itensFromCardapio(editing));

    } else {

      setNome('');

      setItens([]);

    }

  }, [editing, showModal]);



  const openCreate = () => {

    setEditing(null);

    setError('');

    setShowModal(true);

  };



  const openEdit = (cardapio: CardapioOperacao) => {

    setEditing(cardapio);

    setError('');

    setShowModal(true);

  };



  const toggleProduto = (produtoId: string, volumeMl: number, defaultPreco: number) => {

    setItens((prev) => {

      const exists = prev.some((i) => i.produtoId === produtoId && (i.volumeMl ?? 0) === volumeMl);

      if (exists) return prev.filter((i) => !(i.produtoId === produtoId && (i.volumeMl ?? 0) === volumeMl));

      return [...prev, { produtoId, volumeMl, precoUnit: defaultPreco }];

    });

  };



  const changePreco = (produtoId: string, volumeMl: number, precoUnit: number) => {

    setItens((prev) => prev.map((i) => (i.produtoId === produtoId && (i.volumeMl ?? 0) === volumeMl ? { ...i, precoUnit } : i)));

  };



  const saveMutation = useMutation({

    mutationFn: () => {

      const payload = {

        nome: nome.trim(),

        itens: itens.map((i) => ({ produtoId: i.produtoId, volumeMl: i.volumeMl ?? 0, precoUnit: i.precoUnit })),

      };

      return editing

        ? api.put<CardapioOperacao>(`/api/operacao/cardapios/${editing.id}`, payload)

        : api.post<CardapioOperacao>('/api/operacao/cardapios', payload);

    },

    onSuccess: () => {

      queryClient.invalidateQueries({ queryKey: ['operacao-cardapios'] });
      if (editing) {
        queryClient.invalidateQueries({ queryKey: ['operacao-produtos-operacionais'] });
        queryClient.invalidateQueries({ queryKey: ['operacao-turno-cardapio'] });
      }

      setShowModal(false);

      setError('');

    },

    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao salvar'),

  });



  const toggleMutation = useMutation({

    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>

      api.patch(`/api/operacao/cardapios/${id}/ativo`, { ativo }),

    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operacao-cardapios'] }),

    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao atualizar'),

  });



  const deleteMutation = useMutation({

    mutationFn: (id: string) => api.delete(`/api/operacao/cardapios/${id}`),

    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operacao-cardapios'] }),

    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir'),

  });



  if (isLoading) return <Loading />;



  const sorted = [...(cardapios ?? [])].sort((a, b) => {

    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;

    return a.nome.localeCompare(b.nome, 'pt-BR');

  });



  return (

    <div className="space-y-4">

      {!embedded && <h2 className="text-xl font-bold">Cardápios salvos</h2>}



      <p className="text-sm text-ink-faint">

        {modo === 'evento'
          ? 'Cardápios reutilizáveis para aplicar aos eventos.'
          : 'Templates reutilizáveis para aplicar na abertura do caixa ou durante o turno.'}

      </p>



      <button type="button" className="touch-btn-primary touch-btn-sm w-full" onClick={openCreate}>

        + Novo cardápio

      </button>



      {error && !showModal && (

        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>

      )}



      <div className="space-y-3">

        {sorted.map((cardapio) => (

          <div key={cardapio.id} className={`card ${!cardapio.ativo ? 'opacity-60' : ''}`}>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">

              <div className="min-w-0">

                <div className="flex items-center gap-2 flex-wrap">

                  <p className="font-bold text-lg">{cardapio.nome}</p>

                  {!cardapio.ativo && <span className="badge-inactive">Inativo</span>}

                </div>

                <p className="text-sm text-ink-muted mt-0.5">

                  {cardapio.itemCount ?? cardapio.produtos?.length ?? 0} item(ns)

                </p>

              </div>

              <div className="flex flex-wrap gap-2 shrink-0">

                <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => openEdit(cardapio)}>

                  Editar

                </button>

                <button

                  type="button"

                  className="touch-btn-secondary touch-btn-sm"

                  onClick={() => {

                    if (cardapio.ativo && !confirm(`Desativar "${cardapio.nome}"?`)) return;

                    toggleMutation.mutate({ id: cardapio.id, ativo: !cardapio.ativo });

                  }}

                >

                  {cardapio.ativo ? 'Desativar' : 'Ativar'}

                </button>

                <button

                  type="button"

                  className="touch-btn-danger touch-btn-sm"

                  onClick={() => {

                    if (!confirm(`Excluir "${cardapio.nome}" permanentemente?`)) return;

                    deleteMutation.mutate(cardapio.id);

                  }}

                >

                  Excluir

                </button>

              </div>

            </div>

          </div>

        ))}

        {sorted.length === 0 && (

          <p className="text-sm text-ink-faint text-center py-6">Nenhum cardápio cadastrado.</p>

        )}

      </div>



      {showModal && (

        <Modal

          open

          onClose={() => setShowModal(false)}

          title={editing ? 'Editar cardápio' : 'Novo cardápio'}

        >

          <form

            className="space-y-4"

            onSubmit={(e) => {

              e.preventDefault();

              if (!nome.trim()) return;

              saveMutation.mutate();

            }}

          >

            {error && (

              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>

            )}

            <div>

              <label className="label">Nome</label>

              <input

                className="input"

                value={nome}

                onChange={(e) => setNome(e.target.value)}

                placeholder="Ex: Turno praia"

                required

              />

            </div>

            {catalogo && (

              <CardapioOperacaoProdutosPicker

                catalogo={catalogo}

                itens={itens}

                onToggle={toggleProduto}

                onPrecoChange={changePreco}

              />

            )}

            <ModalFormFooter

              onCancel={() => setShowModal(false)}

              pending={saveMutation.isPending}

              disabled={!nome.trim()}

            />

          </form>

        </Modal>

      )}

    </div>

  );

}

