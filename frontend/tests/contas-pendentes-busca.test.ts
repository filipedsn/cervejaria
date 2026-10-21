import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  contaPendenteCorrespondeBusca,
  type ContaPendenteBusca,
} from '../src/lib/contas-pendentes-busca.ts';

function conta(parcial: Partial<ContaPendenteBusca> & { cliente?: Partial<ContaPendenteBusca['cliente']> }): ContaPendenteBusca {
  return {
    cliente: {
      nome: parcial.cliente?.nome ?? 'José Silva',
      telefone: parcial.cliente?.telefone ?? '11987654321',
    },
    comanda: {
      numero: parcial.comanda?.numero ?? 42,
      identificador: parcial.comanda?.identificador ?? '7',
      tipo: parcial.comanda?.tipo ?? 'MESA',
      itens: parcial.comanda?.itens ?? [{ nome: 'Churrasquinho de boi' }],
    },
  };
}

/** Espelho da lógica antiga embutida na página — para comprovar a falha pré-correção. */
function correspondeBuscaAntiga(c: ContaPendenteBusca, busca: string): boolean {
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const digitos = termo.replace(/\D/g, '');
  const rotulo =
    c.comanda.tipo === 'AVULSA'
      ? 'Venda avulsa'
      : `${c.comanda.tipo === 'MESA' ? 'Mesa ' : c.comanda.tipo === 'FICHA' ? 'Ficha ' : ''}${c.comanda.identificador ?? 'Comanda'}`;
  return !termo || [
    c.cliente.nome,
    c.cliente.telefone ?? '',
    rotulo,
    String(c.comanda.numero ?? ''),
    ...c.comanda.itens.map((item) => item.nome ?? ''),
  ].some(
    (campo) =>
      campo.toLocaleLowerCase('pt-BR').includes(termo)
      || (digitos.length > 0 && campo.replace(/\D/g, '').includes(digitos)),
  );
}

describe('busca contas pendentes', () => {
  it('reproduz falha antiga com acento e passa após normalização', () => {
    const c = conta({});
    assert.equal(correspondeBuscaAntiga(c, 'jose'), false, 'versão atual falhava sem acento');
    assert.equal(contaPendenteCorrespondeBusca(c, 'jose'), true);
    assert.equal(contaPendenteCorrespondeBusca(c, 'José'), true);
  });

  it('filtra por telefone formatado, limpa termo e ausência de resultado', () => {
    const c = conta({});
    assert.equal(contaPendenteCorrespondeBusca(c, '(11) 9 8765-4321'), true);
    assert.equal(contaPendenteCorrespondeBusca(c, ''), true);
    assert.equal(contaPendenteCorrespondeBusca(c, '   '), true);
    assert.equal(contaPendenteCorrespondeBusca(c, 'xyz-inexistente'), false);
  });

  it('aceita identificação, número e nome de item', () => {
    const c = conta({});
    assert.equal(contaPendenteCorrespondeBusca(c, '7'), true);
    assert.equal(contaPendenteCorrespondeBusca(c, '42'), true);
    assert.equal(contaPendenteCorrespondeBusca(c, 'churrasquinho'), true);
    assert.equal(contaPendenteCorrespondeBusca(c, 'Mesa 7'), true);
  });
});
