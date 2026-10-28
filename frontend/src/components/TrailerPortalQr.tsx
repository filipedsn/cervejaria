import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePublicAppOrigin } from '../hooks/usePublicAppOrigin';
import { buildPublicAppUrl } from '../lib/public-app-url';
import { formatTrailerLabel, type Trailer } from '../types';
import { QrCodeImage } from './QrCodeImage';

export function TrailerPortalQr({ trailer }: { trailer: Trailer }) {
  const { cervejaria } = useAuth();
  const { origin, isLocalhostQr } = usePublicAppOrigin();
  const [copied, setCopied] = useState(false);

  if (!cervejaria?.slug) return null;

  // Portal de evento descontinuado: QR aponta para o PDV (mesmo id pós-cutover).
  const portalUrl = buildPublicAppUrl(`/c/${cervejaria.slug}/p/${trailer.id}`, origin);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(portalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-line space-y-2">
      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">
        QR abrir comanda (PDV) — {formatTrailerLabel(trailer)}
      </p>
      <p className="text-xs text-ink-muted">
        Cliente escaneia, informa nome e telefone e abre a comanda no ponto de venda enquanto o caixa
        estiver aberto.
      </p>
      {isLocalhostQr && (
        <p className="text-xs text-amber-700">
          QR em localhost — abra o painel pelo IP da rede para testar no celular.
        </p>
      )}
      <div className="flex gap-3 items-start">
        <QrCodeImage
          value={portalUrl}
          size={90}
          title={`QR Code abrir comanda ${formatTrailerLabel(trailer)}`}
        />
        <div className="flex-1 min-w-0 space-y-2">
          <input className="input text-xs" readOnly value={portalUrl} />
          <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={copyLink}>
            {copied ? 'Copiado!' : 'Copiar link'}
          </button>
        </div>
      </div>
    </div>
  );
}
