import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { installZodPtBrErrorMap } from './zod-pt-br.js';

installZodPtBrErrorMap();
const firstMessage = (schema: z.ZodTypeAny, value: unknown) => {
  const result = schema.safeParse(value);
  assert.equal(result.success, false);
  return result.error!.errors[0]!.message;
};

test('default Zod messages come out in Portuguese', () => {
  assert.equal(firstMessage(z.number().min(0), -1), 'O valor não pode ser negativo');
  assert.equal(firstMessage(z.number().positive(), 0), 'O valor deve ser maior que zero');
  assert.equal(firstMessage(z.number().min(5), 1), 'O valor deve ser maior ou igual a 5');
  assert.equal(firstMessage(z.number().max(500), 501), 'O valor deve ser menor ou igual a 500');
  assert.equal(firstMessage(z.number().int(), 1.5), 'Informe um número inteiro');
  assert.equal(firstMessage(z.object({ nome: z.string() }), {}), 'Campo obrigatório');
  assert.equal(firstMessage(z.string().min(1), ''), 'Campo obrigatório');
  assert.equal(firstMessage(z.string().min(6), 'abc'), 'Informe pelo menos 6 caracteres');
  assert.equal(firstMessage(z.string().email(), 'x'), 'E-mail inválido');
  assert.equal(firstMessage(z.enum(['A', 'B']), 'C'), 'Opção inválida');
  assert.equal(firstMessage(z.number(), 'abc'), 'Informe um número válido');
});

test('messages written in the schema keep priority', () => {
  assert.equal(firstMessage(z.number().min(0, 'O troco inicial não pode ser negativo'), -1), 'O troco inicial não pode ser negativo');
  assert.equal(firstMessage(z.string().refine(() => false, { message: 'Regra de negócio' }), 'x'), 'Regra de negócio');
});
