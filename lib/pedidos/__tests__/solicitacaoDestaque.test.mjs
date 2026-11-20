// node --test lib/pedidos/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  destaqueForaDoFiltro,
  estadoDoDestaque,
  idDestaqueDaQuery,
  idDomDaSolicitacao,
  solicitacoesExibidas,
} from '../solicitacaoDestaque.js';

const PEND = 'aaaaaaaa-0000-4000-8000-000000000001';
const REAL = 'aaaaaaaa-0000-4000-8000-000000000002';
const SUMIU = 'aaaaaaaa-0000-4000-8000-000000000009';
const lista = [
  { id: PEND, status: 'pendente' },
  { id: REAL, status: 'realizada' },
];

test('id da query: só UUID válido, string única', () => {
  assert.equal(idDestaqueDaQuery(PEND), PEND);
  assert.equal(idDestaqueDaQuery(` ${PEND.toUpperCase()} `), PEND);
  assert.equal(idDestaqueDaQuery('abc'), null);
  assert.equal(idDestaqueDaQuery(''), null);
  assert.equal(idDestaqueDaQuery(undefined), null);
  assert.equal(idDestaqueDaQuery([PEND, REAL]), null, '?id= repetido é ignorado');
  assert.equal(idDestaqueDaQuery('<script>'), null);
});

test('estado do destaque: carregando, encontrada, não encontrada (excluída)', () => {
  assert.equal(estadoDoDestaque(null, lista, false), 'nenhum');
  assert.equal(estadoDoDestaque(PEND, [], true), 'carregando');
  assert.equal(estadoDoDestaque(PEND, lista, false), 'encontrada');
  assert.equal(estadoDoDestaque(REAL, lista, false), 'encontrada');
  assert.equal(estadoDoDestaque(SUMIU, lista, false), 'nao_encontrada');
});

test('lista exibida: sem destaque, segue o filtro normal', () => {
  assert.deepEqual(solicitacoesExibidas(lista, false, null).map((s) => s.id), [PEND]);
  assert.deepEqual(solicitacoesExibidas(lista, true, null).map((s) => s.id), [PEND, REAL]);
});

test('lista exibida: solicitação concluída aberta pelo link aparece mesmo com "Mostrar realizadas" desligado', () => {
  assert.deepEqual(solicitacoesExibidas(lista, false, REAL).map((s) => s.id), [PEND, REAL]);
  assert.equal(destaqueForaDoFiltro(lista, false, REAL), true);
  assert.equal(destaqueForaDoFiltro(lista, true, REAL), false);
  assert.equal(destaqueForaDoFiltro(lista, false, PEND), false);
  assert.equal(destaqueForaDoFiltro(lista, false, SUMIU), false);
});

test('id DOM estável', () => {
  assert.equal(idDomDaSolicitacao(PEND), `solicitacao-${PEND}`);
});
