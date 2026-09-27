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

/** Navega na aba atual para que o retorno do app externo restaure o Quiver Tap. */
export function navegarParaWhatsApp(url: string): void {
  window.location.assign(url);
}
