import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, formatCurrency } from '../../lib/api';
import { Loading } from '../../components/Loading';
import { rotuloComanda, type ComandaQuiosque } from '../../lib/quiosque';

export function QuiosqueComandasPage() {
  const { data: comandas, isLoading } = useQuery({
    queryKey: ['quiosque-comandas'],
    queryFn: () => api.get<ComandaQuiosque[]>('/api/quiosque/comandas?status=ABERTA'),
    refetchInterval: 30_000,
  });

  if (isLoading) return <Loading />;

  if (!comandas || comandas.length === 0) {
    return (
      <p className="text-ink-faint text-center py-10">
        Nenhuma comanda aberta. Lance os itens em Vender e escolha "Abrir comanda".
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {comandas.map((comanda) => (
        <Link
          key={comanda.id}
          to={`/quiosque/comandas/${comanda.id}`}
          className="card flex items-center justify-between gap-3 py-3"
        >
          <div className="min-w-0">
            <p className="truncate font-semibold">{rotuloComanda(comanda)}</p>
            <p className="text-xs text-ink-faint">
              {comanda.pedidos.length} {comanda.pedidos.length === 1 ? 'rodada' : 'rodadas'}
            </p>
          </div>
          <span className="shrink-0 text-lg font-bold">{formatCurrency(comanda.saldo)}</span>
        </Link>
      ))}
    </div>
  );
}
