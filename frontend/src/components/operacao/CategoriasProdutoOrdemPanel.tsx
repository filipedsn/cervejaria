import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../Modal';
import { CATEGORIAS_PRODUTO_OPERACAO } from '../../lib/operacao';

export function CategoriasProdutoOrdemPanel() {
  const { isDono } = useAuth();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [ordem, setOrdem] = useState<string[]>([...CATEGORIAS_PRODUTO_OPERACAO]);

  const { data } = useQuery({
    queryKey: ['operacao-categorias'],
    queryFn: () => api.get<{ categorias: string[]; ordem: string[] }>('/api/operacao/produtos/categorias'),
    enabled: isDono,
  });

  const salvar = useMutation({
    mutationFn: () => api.put<{ ordem: string[] }>('/api/operacao/produtos/categorias/ordem', { ordem }),
    onSuccess: (result) => {
      queryClient.setQueryData(['operacao-categorias'], {
        categorias: [...CATEGORIAS_PRODUTO_OPERACAO],
        ordem: result.ordem,
      });
      setAberto(false);
    },
  });

  if (!isDono) return null;

  const abrir = () => {
    setOrdem(data?.ordem ?? [...CATEGORIAS_PRODUTO_OPERACAO]);
    salvar.reset();
    setAberto(true);
  };

  const mover = (index: number, delta: -1 | 1) => {
    const destino = index + delta;
    if (destino < 0 || destino >= ordem.length) return;
    setOrdem((atual) => {
      const proxima = [...atual];
      [proxima[index], proxima[destino]] = [proxima[destino], proxima[index]];
      return proxima;
    });
  };

  return (
    <>
      <section className="card-touch flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Ordem das categorias do catálogo</h3>
          <p className="mt-1 text-sm text-ink-faint">
            Defina como as categorias aparecem em Adicionar item para esta empresa.
          </p>
        </div>
        <button type="button" className="touch-btn-secondary touch-btn-sm shrink-0" onClick={abrir}>
          Organizar categorias
        </button>
      </section>

      <Modal
        open={aberto}
        onClose={() => setAberto(false)}
        title="Ordem das categorias"
        hideHeaderClose
        footer={
          <>
            <button type="button" className="touch-btn-primary w-full" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? 'Salvando...' : 'Salvar ordem'}
            </button>
            <button type="button" className="touch-btn-secondary w-full" disabled={salvar.isPending} onClick={() => setOrdem([...CATEGORIAS_PRODUTO_OPERACAO])}>
              Restaurar ordem padrão
            </button>
            <button type="button" className="touch-btn-orange w-full" disabled={salvar.isPending} onClick={() => setAberto(false)}>
              Fechar
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">A ordem será aplicada aos atendentes desta empresa.</p>
          {salvar.isError && (
            <div className="alert-error text-sm">
              {salvar.error instanceof ApiError ? salvar.error.message : 'Não foi possível salvar a ordem.'}
            </div>
          )}
          <ol className="space-y-2">
            {ordem.map((categoria, index) => (
              <li key={categoria} className="card flex items-center gap-3 py-2.5">
                <span className="w-7 text-center text-sm text-ink-faint">{index + 1}</span>
                <span className="min-w-0 flex-1 font-semibold">{categoria}</span>
                <button type="button" className="touch-btn-secondary touch-btn-sm" aria-label={`Mover ${categoria} para cima`} disabled={index === 0} onClick={() => mover(index, -1)}>Subir</button>
                <button type="button" className="touch-btn-secondary touch-btn-sm" aria-label={`Mover ${categoria} para baixo`} disabled={index === ordem.length - 1} onClick={() => mover(index, 1)}>Descer</button>
              </li>
            ))}
          </ol>
        </div>
      </Modal>
    </>
  );
}
