import { digitsOnly } from './phone';

export function linkWhatsAppPedidoPronto(params: {
  telefone: string | null | undefined;
  clienteNome: string;
  numeroPedido: number;
  nomeEmpresa: string;
}): string | null {
  let telefone = digitsOnly(params.telefone ?? '');
  if (telefone.startsWith('55') && (telefone.length === 12 || telefone.length === 13)) {
    telefone = telefone.slice(2);
  }
  if (telefone.length !== 10 && telefone.length !== 11) return null;

  const texto = `Olá, ${params.clienteNome}! Seu pedido (senha ${params.numeroPedido}) está pronto para retirada no ${params.nomeEmpresa}.`;
  return `https://wa.me/55${telefone}?text=${encodeURIComponent(texto)}`;
}

export function createWhatsAppIosAppLink(url: string): string | null {
  try {
    const webLink = new URL(url);
    if (webLink.hostname !== 'wa.me') return null;

    const phone = webLink.pathname.replace(/\D/g, '');
    if (!phone) return null;

    const params = new URLSearchParams({ phone });
    const text = webLink.searchParams.get('text');
    if (text) params.set('text', text);
    return `whatsapp://send?${params.toString()}`;
  } catch {
    return null;
  }
}

/** Abre o WhatsApp sem deixar uma aba wa.me em branco ao voltar para o PWA no iOS. */
export function navegarParaWhatsApp(url: string): void {
  const isAppleMobile =
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isAppleMobile) {
    const appLink = createWhatsAppIosAppLink(url);
    if (appLink) {
      window.location.assign(appLink);
      return;
    }
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}
