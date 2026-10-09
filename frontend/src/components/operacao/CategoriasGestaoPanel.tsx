import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../Modal';

type CategoriaPdv = { id: string; nome: string; gamificada: boolean };
type CategoriaResponse = { categorias: string[]; categoriasPdv?: CategoriaPdv[]; ordem: string[]; catalogoCanonico?: boolean };
type Produto = { id: string; nome: string; categoria: string | null; categoriaPdvId?: string | null };
const COMANDA_LABELS: Record<string, string> = { chope: 'Chopes', comidas: 'Comidas', bebidas: 'Bebidas', outros: 'Outros' };

function erroDaApi(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function OrderEditor({
  title, description, queryKey, endpoint, initialOrder, enabled = true,
}: {
  title: string; description: string; queryKey: string[]; endpoint: string; initialOrder: string[]; enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string[] | null>(null);
  const order = draft ?? initialOrder;
  const initialOrderKey = JSON.stringify(initialOrder);
  const save = useMutation({
    mutationFn: () => api.put<{ ordem: string[]; catalogoCanonico?: boolean }>(endpoint, { ordem: order }),
    onSuccess: async (result) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey }), queryClient.invalidateQueries({ queryKey: ['operacao-categorias'] })]);
      setDraft(null);
      queryClient.setQueryData(['operacao-categorias'], (current: CategoriaResponse | undefined) => current ? { ...current, categorias: result.ordem, ordem: result.ordem } : current);
      queryClient.setQueryData(queryKey, (current: CategoriaResponse | { ordem: string[] } | undefined) => current && 'categorias' in current
        ? { ...current, ordem: result.ordem }
        : result);
    },
  });
  useEffect(() => {
    setDraft((current) => {
      if (current === null) return null;
      const available = new Set(initialOrder);
      const seen = new Set<string>();
      const retained = current.filter((name) => {
        if (!available.has(name) || seen.has(name)) return false;
        seen.add(name);
        return true;
      });
      const retainedSet = new Set(retained);
      const reconciled = [...retained, ...initialOrder.filter((name) => !retainedSet.has(name))];
      return reconciled.length === current.length && reconciled.every((name, index) => name === current[index])
        ? current
        : reconciled;
    });
    save.reset();
  }, [initialOrderKey]);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    setDraft((current) => {
      const next = [...(current ?? initialOrder)];
      const [value] = next.splice(from, 1);
      next.splice(to, 0, value);
      return next;
    });
    save.reset();
  };
  const updateFromDrag = (event: DragEvent, index: number) => {
    const from = Number(event.dataTransfer.getData('text/plain'));
    if (Number.isInteger(from)) move(from, index);
  };
  if (!enabled || !order.length) return null;
  const changed = draft !== null && draft.some((item, index) => item !== initialOrder[index]);
  return (
    <section className="card-touch space-y-3 min-w-0">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-ink-faint">{description}</p>
      </div>
      {save.isError && <div className="alert-error text-sm" role="alert">{erroDaApi(save.error, 'Não foi possível salvar a ordem. A escolha continua no rascunho.')}</div>}
      <ol className="space-y-2">
        {order.map((name, index) => (
          <li key={`${name}-${index}`} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); updateFromDrag(event, index); }} className="card flex min-w-0 items-center gap-2 py-2">
            <span className="w-7 shrink-0 text-center text-sm text-ink-faint">{index + 1}</span>
            <span className="min-w-0 flex-1 break-words font-medium">{COMANDA_LABELS[name] ?? name}</span>
            <button type="button" className="touch-btn-secondary touch-btn-sm min-h-11" aria-label={`Mover ${COMANDA_LABELS[name] ?? name} para cima`} disabled={index === 0 || save.isPending} onClick={() => move(index, index - 1)}>Subir</button>
            <button type="button" className="touch-btn-secondary touch-btn-sm min-h-11" aria-label={`Mover ${COMANDA_LABELS[name] ?? name} para baixo`} disabled={index === order.length - 1 || save.isPending} onClick={() => move(index, index + 1)}>Descer</button>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {changed && <button type="button" className="touch-btn-orange w-full sm:w-auto" disabled={save.isPending} onClick={() => { setDraft(null); save.reset(); }}>Descartar rascunho</button>}
        <button type="button" className="touch-btn-primary w-full sm:w-auto" disabled={!changed || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Salvando...' : 'Salvar ordem'}</button>
      </div>
    </section>
  );
}

export function CategoriasGestaoPanel() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('catalog.manage');
  const [editing, setEditing] = useState<CategoriaPdv | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ nome: '', gamificada: false });
  const [formError, setFormError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [deleting, setDeleting] = useState<CategoriaPdv | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const { data: categoryData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['operacao-categorias'],
    queryFn: () => api.get<CategoriaResponse>('/api/operacao/produtos/categorias'),
    enabled: canManage,
  });
  const { data: products, isLoading: productsLoading, isError: productsError, refetch: refetchProducts } = useQuery({
    queryKey: ['operacao-produtos'],
    queryFn: () => api.get<Produto[]>('/api/operacao/produtos?incluirInativos=true'),
    enabled: canManage,
  });
  const categories = categoryData?.categoriasPdv ?? [];
  const productCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products ?? []) {
      const category = categories.find((item) => item.id === product.categoriaPdvId || (!product.categoriaPdvId && item.nome === product.categoria));
      if (category) counts.set(category.id, (counts.get(category.id) ?? 0) + 1);
    }
    return counts;
  }, [products, categories]);
  const comandaOrder = useQuery({
    queryKey: ['comanda-categorias-ordem'],
    queryFn: () => api.get<{ ordem: string[] }>('/api/produtos/categorias-comanda/ordem'),
    enabled: canManage,
  });
  const saveCategory = useMutation({
    mutationFn: () => editing
      ? api.put(`/api/operacao/produtos/categorias/${editing.id}`, { nome: form.nome.trim(), gamificada: form.gamificada })
      : api.post('/api/operacao/produtos/categorias', { nome: form.nome.trim(), gamificada: form.gamificada }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operacao-categorias'] }),
        queryClient.invalidateQueries({ queryKey: ['operacao-produtos'] }),
      ]);
      closeForm();
    },
    onError: (error) => setFormError(erroDaApi(error, 'Não foi possível salvar a categoria. O rascunho foi mantido.')),
  });
  const deleteCategory = useMutation({
    mutationFn: (category: CategoriaPdv) => api.delete(`/api/operacao/produtos/categorias/${category.id}`),
    onSuccess: async (_result, category) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operacao-categorias'] }),
        queryClient.invalidateQueries({ queryKey: ['comanda-categorias-ordem'] }),
      ]);
      queryClient.setQueryData<{ ordem: string[]; catalogoCanonico?: boolean }>(['comanda-categorias-ordem'], (current) =>
        current ? { ...current, ordem: current.ordem.filter((name) => name !== category.nome) } : current,
      );
      setDeleting(null);
      setDeleteError('');
    },
    onError: (error) => setDeleteError(erroDaApi(error, 'Não foi possível excluir a categoria.')),
  });
  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm({ nome: '', gamificada: false });
    setFormError('');
    setConfirmDiscard(false);
  };
  const openForm = (category?: CategoriaPdv) => {
    saveCategory.reset();
    setFormError('');
    setEditing(category ?? null);
    setFormOpen(true);
    setForm(category ? { nome: category.nome, gamificada: category.gamificada } : { nome: '', gamificada: false });
  };
  const hasDraft = Boolean(form.nome || form.gamificada || editing);
  const catalogoCanonico = categoryData?.catalogoCanonico === true;

  if (!canManage) return <p className="alert-error" role="alert">Você não tem permissão para gerenciar categorias.</p>;
  if (isLoading) return <p className="text-sm text-ink-faint" role="status">Carregando categorias…</p>;
  if (isError) return <div className="alert-error" role="alert">{erroDaApi(error, 'Não foi possível carregar as categorias.')} <button type="button" className="underline" onClick={() => void refetch()}>Tentar novamente</button></div>;
  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><h3 className="text-base font-semibold">{catalogoCanonico ? 'Categorias cadastradas' : 'Categorias do modo LEGACY'}</h3><p className="text-sm text-ink-faint">As categorias existentes continuam disponíveis na seleção de produtos.</p></div>
        {catalogoCanonico && <button type="button" className="touch-btn-primary min-h-11 shrink-0" onClick={() => openForm()}>+ Categoria</button>}
      </div>
      {!catalogoCanonico && <div className="alert-error" role="status">O catálogo canônico ainda não está ativo neste contexto. Cadastro e edição ficam fechados para preservar a compatibilidade LEGACY.</div>}
      {catalogoCanonico && categories.length === 0 && !isError && <p className="card-touch text-sm text-ink-faint">Nenhuma categoria cadastrada.</p>}
      {catalogoCanonico && productsError && <div className="alert-error text-sm" role="alert">Não foi possível carregar as quantidades; a exclusão fica desabilitada até atualizar. <button type="button" className="underline" onClick={() => void refetchProducts()}>Tentar novamente</button></div>}
      {catalogoCanonico && <ul className="space-y-2">
        {categories.map((category) => <li key={category.id} className="card-touch flex min-w-0 flex-wrap items-center gap-3 py-3">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold break-words">{category.nome}</span>{category.gamificada && <span className="rounded-full bg-brand-400/15 px-2 py-1 text-xs font-semibold text-brand-300">Gamificada</span>}</div><p className="mt-1 text-sm text-ink-faint">{productsLoading ? 'Carregando quantidade…' : productsError ? 'Quantidade indisponível' : `${productCounts.get(category.id) ?? 0} produtos`}</p></div>
          <div className="flex shrink-0 gap-2"><button type="button" className="touch-btn-secondary min-h-11" onClick={() => openForm(category)}>Editar</button><button type="button" className="touch-btn-ghost min-h-11" disabled={productsLoading || productsError} onClick={() => { setDeleting(category); setDeleteError(''); deleteCategory.reset(); }}>Excluir</button></div>
        </li>)}
      </ul>}
      {catalogoCanonico ? <>
        <OrderEditor title="Organizar categorias" description="Esta ordem única é usada no catálogo, na seleção de produtos da comanda e nos portais. Categorias sem produtos não aparecem nos consumidores." queryKey={['comanda-categorias-ordem']} endpoint="/api/produtos/categorias-comanda/ordem" initialOrder={categoryData?.ordem ?? []} enabled={!comandaOrder.isLoading && !comandaOrder.isError} />
        {comandaOrder.isError && <div className="alert-error text-sm" role="alert">Não foi possível carregar a ordem compartilhada. <button type="button" className="underline" onClick={() => void comandaOrder.refetch()}>Tentar novamente</button></div>}
      </> : <>
        <OrderEditor title="Organizar na comanda (LEGACY)" description="Ordem efetiva dos grupos na seleção de produtos LEGACY." queryKey={['comanda-categorias-ordem']} endpoint="/api/produtos/categorias-comanda/ordem" initialOrder={comandaOrder.data?.ordem ?? []} enabled={!comandaOrder.isLoading && !comandaOrder.isError} />
        {comandaOrder.isError && <div className="alert-error text-sm" role="alert">Não foi possível carregar a ordem da comanda. <button type="button" className="underline" onClick={() => void comandaOrder.refetch()}>Tentar novamente</button></div>}
        <OrderEditor title="Ordem no catálogo (LEGACY)" description="Ordem legada do catálogo, mantida separada durante a compatibilidade." queryKey={['operacao-categorias']} endpoint="/api/operacao/produtos/categorias/ordem" initialOrder={categoryData?.ordem ?? []} />
      </>}
      {catalogoCanonico && <p className="text-xs text-ink-faint">A categoria gamificada fica registrada e identificada. Atualmente ela não altera pontos nem rankings.</p>}
      <Modal open={formOpen} onClose={() => hasDraft ? setConfirmDiscard(true) : closeForm()} title={editing ? 'Editar categoria' : 'Nova categoria'} hideHeaderClose closeOnBackdrop={false} footer={<><button type="button" className="touch-btn-orange w-full" disabled={saveCategory.isPending} onClick={() => hasDraft ? setConfirmDiscard(true) : closeForm()}>Voltar</button><button type="submit" form="categoria-pdv-form" className="touch-btn-primary w-full" disabled={saveCategory.isPending || !form.nome.trim()}>{saveCategory.isPending ? 'Salvando…' : 'Salvar'}</button></>}>
        <form id="categoria-pdv-form" onSubmit={(event) => { event.preventDefault(); if (!saveCategory.isPending) { setFormError(''); saveCategory.mutate(); } }} className="space-y-4">
          {formError && <div className="alert-error" role="alert">{formError}</div>}
          <div><label className="label" htmlFor="categoria-pdv-nome">Nome</label><input id="categoria-pdv-nome" className="input min-h-11" value={form.nome} maxLength={80} onChange={(event) => setForm({ ...form, nome: event.target.value })} required /></div>
          <label className="card flex min-h-11 cursor-pointer items-start gap-3 py-3"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-brand-400" checked={form.gamificada} onChange={(event) => setForm({ ...form, gamificada: event.target.checked })} /><span><span className="block font-semibold">Categoria gamificada</span><span className="block text-xs text-ink-faint">A flag é salva como ativada ou desativada; ainda não gera pontos nem altera rankings.</span></span></label>
        </form>
      </Modal>
      <Modal open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="Descartar alterações?" hideHeaderClose footer={<><button type="button" className="touch-btn-orange w-full" onClick={() => { setConfirmDiscard(false); closeForm(); }}>Descartar</button><button type="button" className="touch-btn-secondary w-full" onClick={() => setConfirmDiscard(false)}>Continuar editando</button></>}><p className="text-sm text-ink-muted">O rascunho da categoria será perdido.</p></Modal>
      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} title="Excluir categoria" hideHeaderClose footer={<><button type="button" className="touch-btn-orange w-full" disabled={deleteCategory.isPending} onClick={() => setDeleting(null)}>Voltar</button><button type="button" className="touch-btn-primary w-full" disabled={deleteCategory.isPending || !deleting} onClick={() => deleting && deleteCategory.mutate(deleting)}>{deleteCategory.isPending ? 'Excluindo…' : 'Confirmar exclusão'}</button></>}><p className="text-sm text-ink-muted">Excluir “{deleting?.nome}”? A exclusão é bloqueada se houver produtos vinculados.</p>{deleteError && <div className="alert-error mt-3" role="alert">{deleteError}</div>}</Modal>
    </div>
  );
}
