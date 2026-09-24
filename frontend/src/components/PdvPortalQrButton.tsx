import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePublicAppOrigin } from '../hooks/usePublicAppOrigin';
import { buildPublicAppUrl } from '../lib/public-app-url';
import { IconQr } from './NavIcons';
import { Modal } from './Modal';
import { QrCodeImage } from './QrCodeImage';

export function PdvPortalQrButton({ pontoVendaId }: { pontoVendaId: string }) {
  const [open, setOpen] = useState(false);
  const { cervejaria } = useAuth();
  const { origin } = usePublicAppOrigin();
  if (!cervejaria?.slug) return null;
  const url = buildPublicAppUrl(`/c/${cervejaria.slug}/p/${pontoVendaId}`, origin);
  return <>
    <button type="button" className="touch-btn-secondary w-full inline-flex items-center justify-center gap-2" onClick={() => setOpen(true)}>
      <IconQr className="w-4 h-4" /> QR Code para abrir comanda
    </button>
    <Modal open={open} onClose={() => setOpen(false)} title="QR Code — Abrir comanda no Caixa" footer={<button type="button" className="touch-btn-secondary w-full" onClick={() => setOpen(false)}>Fechar</button>}>
      <div className="space-y-3 text-center"><QrCodeImage value={url} size={200} title="QR Code abrir comanda no caixa" /><p className="text-sm text-ink-muted">O cliente informa nome e telefone. A comanda é aberta neste ponto de venda enquanto o caixa estiver aberto.</p></div>
    </Modal>
  </>;
}
