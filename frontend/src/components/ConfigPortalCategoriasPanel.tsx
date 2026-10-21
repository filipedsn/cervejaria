import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';

type PortalCategories = { categorias: string[]; categoriasPermitidas: string[] | null };
type PortalCategoryMode = 'all' | 'selected';

export function ConfigPortalCategoriasPanel() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<PortalCategoryMode>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const { data } = useQuery({
    queryKey: ['portal-categories-config'],
    queryFn: () => api.get<PortalCategories>('/api/cervejaria/configuracao-portal-categorias'),
  });
  useEffect(() => {
    if (!data) return;
    setMode(data.categoriasPermitidas === null ? 'all' : 'selected');
    setSelected(data.categoriasPermitidas ?? []);
  }, [data]);
  const saveMutation = useMutation({
    mutationFn: () => api.put<PortalCategories>('/api/cervejaria/configuracao-portal-categorias', { categoriasPermitidas: mode === 'all' ? null : selected }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['portal-categories-config'], saved);
      setMode(saved.categoriasPermitidas === null ? 'all' : 'selected');
      setSelected(saved.categoriasPermitidas ?? []);
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar as categorias.'),
  });
  return (
    <section className="card space-y-3" aria-label="Categorias do portal do cliente">
      <div>
        <h3 className="font-semibold">Categorias disponíveis no portal do cliente</h3>
        <p className="mt-1 text-sm text-ink-muted">Defina o cardápio do autoatendimento deste estabelecimento. O catálogo e o atendimento interno não são alterados.</p>
      </div>
      {data?.categorias.length ? <>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Categorias visíveis ao cliente</legend>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 py-2">
            <input type="radio" name="portal-category-mode" checked={mode === 'all'} onChange={() => setMode('all')} />
            <span><span className="block font-medium">Todas as categorias</span><span className="block text-xs text-ink-muted">Inclui categorias atuais e futuras.</span></span>
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 py-2">
            <input type="radio" name="portal-category-mode" checked={mode === 'selected'} onChange={() => setMode('selected')} />
            <span><span className="block font-medium">Selecionar categorias</span><span className="block text-xs text-ink-muted">Escolha exatamente o que aparece no portal.</span></span>
          </label>
        </fieldset>
        {mode === 'selected' && <div className="grid gap-2 sm:grid-cols-2" aria-label="Categorias selecionáveis">
          {data.categorias.map((category) => <label key={category} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 py-2">
            <input type="checkbox" checked={selected.includes(category)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, category] : current.filter((name) => name !== category))} />
            <span>{category}</span>
          </label>)}
        </div>}
      </> : <p className="text-sm text-ink-faint">Cadastre categorias no catálogo para configurar o portal.</p>}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {saveMutation.isSuccess && <div className="alert-success" role="status">Configuração do portal salva.</div>}
      <p className="text-xs text-ink-faint">Sem configuração salva, estabelecimentos existentes mantêm todas as categorias. Em “Selecionar categorias”, salvar sem marcar nenhuma deixa o cardápio público vazio.</p>
      <div className="flex gap-2">
        <button type="button" className="touch-btn-primary" disabled={saveMutation.isPending || !data} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? 'Salvando…' : 'Salvar configuração'}</button>
        {mode === 'selected' && <button type="button" className="touch-btn-secondary" disabled={!data || saveMutation.isPending} onClick={() => setSelected([])}>Limpar seleção</button>}
      </div>
    </section>
  );
}
