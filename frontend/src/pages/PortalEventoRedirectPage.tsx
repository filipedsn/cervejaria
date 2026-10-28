import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, assetUrl } from '../lib/api';
import { Loading } from '../components/Loading';

type PontoInfo = {
  pontoVenda: { id: string; nome: string };
  cervejaria: { nome: string; logoUrl?: string | null };
};

/**
 * Soft kill do portal de evento `/c/:slug/t/:trailerId`.
 * Pós-cutover PDV o trailer e o ponto compartilham o mesmo id — redireciona para `/p/`.
 * Sem ponto correspondente, mostra página de descontinuado.
 */
export function PortalEventoRedirectPage() {
  const { slug, trailerId } = useParams<{ slug: string; trailerId: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['portal-evento-redirect', slug, trailerId],
    queryFn: () =>
      api.get<PontoInfo>(`/api/public/cervejarias/${slug}/pontos-venda/${trailerId}/info`),
    enabled: !!slug && !!trailerId,
    retry: false,
  });

  useEffect(() => {
    document.body.classList.add('auth-screen');
    return () => document.body.classList.remove('auth-screen');
  }, []);

  if (!slug || !trailerId) {
    return <Navigate to="/login" replace />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
        <Loading />
      </div>
    );
  }

  if (data?.pontoVenda?.id) {
    return <Navigate to={`/c/${slug}/p/${data.pontoVenda.id}`} replace />;
  }

  const logo = !isError && data?.cervejaria ? assetUrl(data.cervejaria.logoUrl) : null;

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 safe-area-pt safe-area-pb">
      <div className="max-w-md mx-auto space-y-6 text-center">
        {logo ? (
          <img
            src={logo}
            alt=""
            className="h-16 w-16 mx-auto rounded-xl object-contain bg-surface border border-line"
          />
        ) : (
          <div className="text-4xl" aria-hidden>
            🍺
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold">{data?.cervejaria?.nome ?? 'Quiver Tap'}</h1>
          <p className="text-sm text-ink-muted mt-1">Abrir comanda</p>
        </div>
        <div className="card space-y-3 text-left">
          <p className="font-semibold">Portal de evento descontinuado</p>
          <p className="text-sm text-ink-muted">
            Este link de trailer não abre mais comanda. Peça à equipe o{' '}
            <strong>QR do ponto de venda</strong> (caixa) para abrir sua comanda.
          </p>
          {isError && (
            <p className="text-sm text-ink-muted">Link inválido ou estabelecimento não encontrado.</p>
          )}
        </div>
        <Link to="/login" className="text-sm text-brand-600 font-semibold hover:underline">
          Acesso da equipe
        </Link>
      </div>
    </div>
  );
}
