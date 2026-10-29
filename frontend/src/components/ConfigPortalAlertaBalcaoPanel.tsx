import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';

type PortalBalcaoAlert = { categorias: string[]; categoriasAlertaBalcao: string[] | null };

export function ConfigPortalAlertaBalcaoPanel() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const { data } = useQuery({
    queryKey: ['portal-balcao-alert-config'],
    queryFn: () => api.get<PortalBalcaoAlert>('/api/cervejaria/configuracao-portal-alerta-balcao'),
  });

  useEffect(() => {
    if (!data) return;
    setSelected(data.categoriasAlertaBalcao ?? []);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put<PortalBalcaoAlert>('/api/cervejaria/configuracao-portal-alerta-balcao', {
        // Lista vazia = desligado (mesmo efeito de null para o gate do backend).
        categoriasAlertaBalcao: selected.length === 0 ? null : selected,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['portal-balcao-alert-config'], saved);
      setSelected(saved.categoriasAlertaBalcao ?? []);
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o alerta do balcão.'),
  });

  return (
    <section className="card space-y-3" aria-label="Alerta do balcão no portal">
      <div>
        <h3 className="font-semibold">Alertar o balcão nestas categorias</h3>
        <p className="mt-1 text-sm text-ink-muted">
          Quando o cliente pedir no portal um item sem preparo destas categorias (ex.: chope), a comanda destaca Servir e toca um aviso. Itens com preparo continuam só na cozinha. Sem seleção, o alerta fica desligado.
        </p>
      </div>
      {data?.categorias.length ? (
        <div className="grid gap-2 sm:grid-cols-2" aria-label="Categorias do alerta de balcão">
          {data.categorias.map((category) => (
            <label key={category} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 py-2">
              <input
                type="checkbox"
                checked={selected.includes(category)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked ? [...current, category] : current.filter((name) => name !== category),
                  )
                }
              />
              <span>{category}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-faint">Cadastre categorias no catálogo para configurar o alerta.</p>
      )}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {saveMutation.isSuccess && <div className="alert-success" role="status">Alerta do balcão salvo.</div>}
      <div className="flex gap-2">
        <button
          type="button"
          className="touch-btn-primary"
          disabled={saveMutation.isPending || !data}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? 'Salvando…' : 'Salvar alerta do balcão'}
        </button>
        <button
          type="button"
          className="touch-btn-secondary"
          disabled={!data || saveMutation.isPending || selected.length === 0}
          onClick={() => setSelected([])}
        >
          Limpar seleção
        </button>
      </div>
    </section>
  );
}
