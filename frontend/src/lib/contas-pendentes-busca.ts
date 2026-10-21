import { normalizarBuscaComanda } from './comandas-busca';

export type ContaPendenteBusca = {
  cliente: { nome: string; telefone: string | null };
  comanda: {
    numero: number | null;
    identificador: string | null;
    tipo: string;
    itens: Array<{ nome: string | null }>;
  };
};

function rotuloContaBusca(conta: ContaPendenteBusca): string {
  const tipo = conta.comanda.tipo;
  if (tipo === 'AVULSA') return 'Venda avulsa';
  const prefixo = tipo === 'MESA' ? 'Mesa ' : tipo === 'FICHA' ? 'Ficha ' : '';
  return prefixo + (conta.comanda.identificador ?? 'Comanda');
}

/** Campos textuais usados na busca local de contas pendentes. */
export function camposBuscaContaPendente(conta: ContaPendenteBusca): string[] {
  return [
    conta.cliente.nome,
    conta.cliente.telefone ?? '',
    rotuloContaBusca(conta),
    conta.comanda.identificador ?? '',
    String(conta.comanda.numero ?? ''),
    ...conta.comanda.itens.map((item) => item.nome ?? ''),
  ];
}

/**
 * Busca reativa alinhada à normalização de comandas (acentos) e a telefone
 * digitado com máscara — sem exigir match literal do formato persistido.
 */
export function contaPendenteCorrespondeBusca(conta: ContaPendenteBusca, termoBruto: string): boolean {
  const termo = termoBruto.trim();
  if (!termo) return true;
  const normalizado = normalizarBuscaComanda(termo);
  const digitos = termo.replace(/\D/g, '');
  return camposBuscaContaPendente(conta).some((campo) => {
    const texto = normalizarBuscaComanda(campo);
    if (normalizado && texto.includes(normalizado)) return true;
    if (digitos.length > 0 && campo.replace(/\D/g, '').includes(digitos)) return true;
    return false;
  });
}
