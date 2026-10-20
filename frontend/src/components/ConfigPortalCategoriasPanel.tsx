import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';

type PortalCategories = { categorias: string[]; categoriasPermitidas: string[] | null };

export function ConfigPortalCategoriasPanel() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const { data } = useQuery({
    queryKey: ['portal-categories-config'],
    queryFn: () => api.get<PortalCategories>('/api/cervejaria/configuracao-portal-categorias'),
  });
  useEffect(() => {
    if (!data) return;
    setSelected(data.categoriasPermitidas ?? data.categorias);
  }, [data]);
  const saveMutation = useMutation({
    mutationFn: () => api.put<PortalCategories>('/api/cervejaria/configuracao-portal-categorias', { categoriasPermitidas: selected }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['portal-categories-config'], saved);
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar as categorias.'),
  });
  return (
    <section className="card space-y-3" aria-label="Categorias do portal do cliente">
      <div>
        <h3 className="font-semibold">Categorias do portal do cliente</h3>
        <p className="mt-1 text-sm text-ink-muted">Escolha o que aparece no autoatendimento. Essa seleção não altera o catálogo usado pela equipe.</p>
      </div>
      {data?.categorias.length ? <div className="grid gap-2 sm:grid-cols-2">
        {data.categorias.map((category) => <label key={category} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 py-2">
          <input type="checkbox" checked={selected.includes(category)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, category] : current.filter((name) => name !== category))} />
          <span>{category}</span>
        </label>)}
      </div> : <p className="text-sm text-ink-faint">Cadastre categorias no catálogo para configurar o portal.</p>}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {saveMutation.isSuccess && <div className="alert-success" role="status">Categorias do portal salvas.</div>}
      <p className="text-xs text-ink-faint">Sem configuração, estabelecimentos existentes mantêm todas as categorias. Se salvar sem selecionar nenhuma, o cardápio público ficará vazio.</p>
      <div className="flex gap-2">
        <button type="button" className="touch-btn-primary" disabled={saveMutation.isPending || !data} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? 'Salvando…' : 'Salvar categorias'}</button>
        <button type="button" className="touch-btn-secondary" disabled={!data} onClick={() => setSelected([])}>Limpar seleção</button>
      </div>
    </section>
  );
}
