import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogoCategoriasCanonicoAtivo, categoriaPdvInputSchema, normalizarNomeCategoria } from './catalogo-categorias.js';

test('normaliza a chave de categoria sem reescrever o nome apresentado', () => {
  assert.equal(normalizarNomeCategoria('  Porções   especiais '), 'porcoes especiais');
  assert.equal(categoriaPdvInputSchema.parse({ nome: '  Porções  ', gamificada: true }).nome, 'Porções');
});

test('catálogo canônico fica desligado até habilitação explícita', () => {
  assert.equal(catalogoCategoriasCanonicoAtivo({}), false);
  assert.equal(catalogoCategoriasCanonicoAtivo({ PDV_GAMIFIED_CATEGORY_CATALOG: '0' } as NodeJS.ProcessEnv), false);
  assert.equal(catalogoCategoriasCanonicoAtivo({ PDV_GAMIFIED_CATEGORY_CATALOG: '1' } as NodeJS.ProcessEnv), true);
});
