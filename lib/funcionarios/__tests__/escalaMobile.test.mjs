// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/funcionarios/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contarFiltrosEscalaAtivos, diaSelecionadoNaLista, semanasDoCalendario } from '../escalaMobile.js';
import { diasDoMes } from '../../data/dataLocal.js';

const semana = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];

test('dia selecionado: mantém a escolha que ainda está na lista', () => {
  assert.equal(diaSelecionadoNaLista(semana, '2026-10-14', '2026-10-17'), '2026-10-17');
});

test('dia selecionado: escolha fora da lista cai para hoje (se na lista) ou para o 1º dia', () => {
  assert.equal(diaSelecionadoNaLista(semana, '2026-10-14', '2026-10-05'), '2026-10-14');
  assert.equal(diaSelecionadoNaLista(semana, '2026-11-02', '2026-10-05'), '2026-10-12');
  assert.equal(diaSelecionadoNaLista(semana, '2026-11-02', ''), '2026-10-12');
  assert.equal(diaSelecionadoNaLista([], '2026-10-14', '2026-10-14'), '');
});

test('calendário: outubro/2026 começa na quinta e termina no sábado (semana segunda-domingo)', () => {
  const semanas = semanasDoCalendario(diasDoMes('2026-10-01'));
  assert.equal(semanas.length, 5);
  assert.deepEqual(semanas[0], [null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.deepEqual(semanas[4], ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', null]);
  assert.equal(semanas.flat().filter(Boolean).length, 31);
});

test('calendário: mês que começa na segunda não cria semana vazia; fevereiro/2027 cabe em 4 semanas', () => {
  const junho = semanasDoCalendario(diasDoMes('2026-06-01'));
  assert.equal(junho[0][0], '2026-06-01');
  const fev = semanasDoCalendario(diasDoMes('2027-02-01'));
  assert.equal(fev.length, 4);
  assert.equal(fev[3][6], '2027-02-28');
});

test('filtros ativos: conta só cargo e funcionária preenchidos', () => {
  assert.equal(contarFiltrosEscalaAtivos({ cargoId: '', funcionarioId: '' }), 0);
  assert.equal(contarFiltrosEscalaAtivos({ cargoId: 'c1', funcionarioId: '' }), 1);
  assert.equal(contarFiltrosEscalaAtivos({ cargoId: 'c1', funcionarioId: 'f1' }), 2);
  assert.equal(contarFiltrosEscalaAtivos(undefined), 0);
});
