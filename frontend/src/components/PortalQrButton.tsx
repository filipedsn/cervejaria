import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePublicAppOrigin } from '../hooks/usePublicAppOrigin';
import { buildPublicAppUrl } from '../lib/public-app-url';
import type { Trailer } from '../types';
import { IconQr } from './NavIcons';
import { Modal } from './Modal';
import { QrCodeImage } from './QrCodeImage';

interface PortalQrButtonProps {
  trailerId: string;
  trailer?: Pick<Trailer, 'nome' | 'identificador'> | null;
  className?: string;
  iconOnly?: boolean;
  fullWidth?: boolean;
  variant?: 'hero' | 'surface' | 'header';
}

export function PortalQrButton({
  trailerId,
  className = '',
  iconOnly = false,
  fullWidth = true,
  variant = 'surface',
}: PortalQrButtonProps) {
  const [open, setOpen] = useState(false);
  const { cervejaria } = useAuth();
  const { origin } = usePublicAppOrigin();

  if (!cervejaria?.slug) return null;

  const portalUrl = buildPublicAppUrl(`/c/${cervejaria.slug}/t/${trailerId}`, origin);

  const iconButtonClass =
    variant === 'hero'
      ? 'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/10 text-white transition hover:bg-white/20'
      : variant === 'header'
        ? 'inline-flex h-full min-h-14 w-14 shrink-0 items-center justify-center border-0 border-l border-line bg-surface text-ink hover:bg-surface-lighter active:bg-surface-lighter transition-colors'
        : 'inline-flex h-[3.75rem] w-[3.75rem] shrink-0 items-center justify-center rounded-2xl border border-line bg-surface text-ink shadow-sm active:scale-[0.98] transition-transform';

  const closeModal = () => setOpen(false);

  const modal = (
    <Modal
      open={open}
      onClose={closeModal}
      title="QR Code — Abrir comanda"
      hideHeaderClose
      footer={
        <button type="button" className="touch-btn-secondary w-full" onClick={closeModal}>
          Fechar
        </button>
      }
    >
      <div className="flex justify-center py-2">
        <QrCodeImage value={portalUrl} size={200} title="QR Code abrir comanda" />
      </div>
    </Modal>
  );

  if (iconOnly) {
    return (
      <>
        <button
          type="button"
          title="QR Code"
          aria-label="Ver QR Code"
          onClick={() => setOpen(true)}
          className={`${iconButtonClass} ${className}`}
        >
          <IconQr />
        </button>
        {modal}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`touch-btn-secondary touch-btn-sm inline-flex items-center justify-center gap-2 ${
          fullWidth ? 'w-full' : ''
        } ${className}`}
      >
        <IconQr className="w-4 h-4" />
        QR Code
      </button>
      {modal}
    </>
  );
}
