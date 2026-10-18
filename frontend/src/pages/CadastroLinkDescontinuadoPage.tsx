import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, logoAssetUrl } from '../lib/api';
import type { PublicCervejariaInfo } from '../types';
import { Loading } from '../components/Loading';

export function CadastroLinkDescontinuadoPage() {
  const { slug } = useParams<{ slug: string }>();

  const { data: info, isLoading, isError } = useQuery({
    queryKey: ['public-cervejaria', slug],
    queryFn: () => api.get<PublicCervejariaInfo>(`/api/public/cervejarias/${slug}/info`),
    enabled: !!slug,
    retry: false,
  });

  useEffect(() => {
    document.body.classList.add('auth-screen');
    return () => document.body.classList.remove('auth-screen');
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
        <Loading />
      </div>
    );
  }

  const logo = info ? logoAssetUrl(info) : null;

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 safe-area-pt safe-area-pb">
      <div className="max-w-md mx-auto space-y-6 text-center">
        {logo ? (
          <img src={logo} alt="" className="h-16 w-16 mx-auto rounded-xl object-contain bg-surface border border-line" />
        ) : (
          <div className="text-4xl">🍺</div>
        )}
        <div>
          <h1 className="text-xl font-bold">{info?.nome ?? 'Quiver Tap'}</h1>
          <p className="text-sm text-ink-muted mt-1">Abrir comanda</p>
        </div>
        <div className="card space-y-3 text-left">
          <p className="font-semibold">Use o QR Code do trailer</p>
          <p className="text-sm text-ink-muted">
            Este link de cadastro não abre comanda. Escaneie o <strong>QR do trailer</strong> onde
            você está — informe nome e telefone e sua comanda será aberta na hora.
          </p>
          {!isError && info && (
            <p className="text-sm text-ink-muted">
              Se você é da equipe, configure os QRs em Configurações → Trailers.
            </p>
          )}
        </div>
        {isError && (
          <p className="text-sm text-ink-muted">Link inválido ou cervejaria não encontrada.</p>
        )}
        <Link to="/login" className="text-sm text-brand-600 font-semibold hover:underline">
          Acesso da equipe
        </Link>
      </div>
    </div>
  );
}
