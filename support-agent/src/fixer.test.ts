import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasNewTest, parseCursorStream } from './fixer.js';

/** Sequencia representativa do `--output-format stream-json`, conforme a doc do CLI. */
const STREAM = [
  '{"type":"system","subtype":"init","apiKeySource":"login","cwd":"C:\\\\wt","session_id":"s1","model":"Claude 4 Sonnet","permissionMode":"default"}',
  '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"corrija o bug"}]},"session_id":"s1"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Vou ler o arquivo"}]},"session_id":"s1"}',
  '{"type":"tool_call","subtype":"started","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"a.ts"}}},"session_id":"s1"}',
  '{"type":"tool_call","subtype":"completed","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"a.ts"}}},"session_id":"s1"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Corrigido"}]},"session_id":"s1"}',
  '{"type":"result","subtype":"success","duration_ms":5234,"duration_api_ms":5234,"is_error":false,"result":"Vou ler o arquivoCorrigido","session_id":"s1"}',
];

test('parseCursorStream le o texto e a duracao do evento result', () => {
  const parsed = parseCursorStream(STREAM);
  assert.equal(parsed.output, 'Vou ler o arquivoCorrigido');
  assert.equal(parsed.durationMs, 5234);
  assert.equal(parsed.isError, false);
});

test('parseCursorStream cai nas mensagens do assistant quando falta o result', () => {
  const parsed = parseCursorStream(STREAM.slice(0, -1));
  assert.equal(parsed.output, 'Vou ler o arquivo\nCorrigido');
  assert.equal(parsed.durationMs, 0);
});

test('parseCursorStream sinaliza is_error', () => {
  const parsed = parseCursorStream([
    '{"type":"result","subtype":"error","is_error":true,"duration_ms":10,"result":"deu erro"}',
  ]);
  assert.equal(parsed.isError, true);
  assert.equal(parsed.output, 'deu erro');
});

test('parseCursorStream ignora flush duplicado com model_call_id', () => {
  const parsed = parseCursorStream([
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"novo"}]},"timestamp_ms":1}',
    '{"type":"assistant","model_call_id":"m1","message":{"role":"assistant","content":[{"type":"text","text":"duplicado"}]},"timestamp_ms":2}',
  ]);
  assert.equal(parsed.output, 'novo');
});

test('parseCursorStream tolera linha nao-JSON e stream vazio', () => {
  assert.equal(parseCursorStream(['', 'lixo do stderr', '{quebrado']).output, '');
  assert.equal(parseCursorStream([]).durationMs, 0);
});

test('parseCursorStream reconhece a desistencia declarada', () => {
  const parsed = parseCursorStream([
    '{"type":"result","subtype":"success","is_error":false,"duration_ms":100,"result":"NAO CONSEGUI DIAGNOSTICAR: falta stack trace no dossie."}',
  ]);
  assert.match(parsed.output, /NAO CONSEGUI DIAGNOSTICAR/);
});

test('hasNewTest exige arquivo de teste no diff', () => {
  assert.equal(hasNewTest(['backend/src/lib/caixa.ts']), false);
  assert.equal(hasNewTest(['backend/src/lib/caixa.ts', 'backend/src/lib/caixa.test.ts']), true);
  assert.equal(hasNewTest(['backend/src/lib/caixa.property.test.ts']), true);
  assert.equal(hasNewTest(['backend/src/lib/caixa.spec.ts']), true);
  assert.equal(hasNewTest([]), false);
});
