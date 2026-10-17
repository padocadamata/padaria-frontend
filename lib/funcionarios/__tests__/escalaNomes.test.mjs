// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/funcionarios/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomeCompactoEscala, capitalizarNome, rotulosFuncionariasFiltro } from '../escalaNomes.js';

test('grades: primeiro nome + último sobrenome, grafia cadastrada preservada', () => {
  assert.equal(nomeCompactoEscala('LETICIA DANIELE RIBEIRO DE SOUZA'), 'LETICIA SOUZA');
  assert.equal(nomeCompactoEscala('GABRIELLY MARCOLINO RAMIRO'), 'GABRIELLY RAMIRO');
  assert.equal(nomeCompactoEscala('ELIANE NASCIMENTO DA CRUZ'), 'ELIANE CRUZ');
  assert.equal(nomeCompactoEscala('ESTHER MAZZUCO'), 'ESTHER MAZZUCO'); // duas palavras
  assert.equal(nomeCompactoEscala('ESTHER'), 'ESTHER'); // uma palavra
  assert.equal(nomeCompactoEscala('  ana   paula   lima  '), 'ana lima'); // espaços extras
  assert.equal(nomeCompactoEscala(''), '');
  assert.equal(nomeCompactoEscala(null), '');
});

test('capitalização pt-BR (acentos preservados)', () => {
  assert.equal(capitalizarNome('LETICIA'), 'Leticia');
  assert.equal(capitalizarNome('ÉRICA ÁVILA'), 'Érica Ávila');
  assert.equal(capitalizarNome('maria souza'), 'Maria Souza');
});

const f = (id, nome) => ({ id, nome });

test('filtro: primeiro nome quando único; homônimos ganham o último sobrenome; value continua o id', () => {
  const lista = [
    f('a', 'LETICIA DANIELE RIBEIRO DE SOUZA'),
    f('b', 'MARIA APARECIDA SILVA'),
    f('c', 'MARIA EDUARDA SOUZA'),
    f('d', 'ESTHER MAZZUCO'),
    f('e', 'GABRIELLY'),
  ];
  const rotulos = rotulosFuncionariasFiltro(lista);
  assert.deepEqual([...rotulos], [
    ['a', 'Leticia'],
    ['b', 'Maria Silva'],
    ['c', 'Maria Souza'],
    ['d', 'Esther'],
    ['e', 'Gabrielly'],
  ]);
  // chave do Map = id (o select usa o id como value, nunca o rótulo)
  assert.ok(lista.every((x) => rotulos.has(x.id)));
});

test('filtro: homônimo considerado só entre as DISPONÍVEIS (ex.: dentro do cargo filtrado)', () => {
  const daAtendente = [f('b', 'MARIA APARECIDA SILVA'), f('d', 'ESTHER MAZZUCO')];
  assert.deepEqual([...rotulosFuncionariasFiltro(daAtendente)], [['b', 'Maria'], ['d', 'Esther']]);
});

test('filtro: mesmo primeiro nome E mesmo último sobrenome -> nome completo (nunca ambíguo)', () => {
  const rotulos = rotulosFuncionariasFiltro([f('x', 'MARIA APARECIDA SILVA'), f('y', 'MARIA JOSE SILVA'), f('z', 'MARIA SOUZA')]);
  assert.deepEqual([...rotulos], [['x', 'Maria Aparecida Silva'], ['y', 'Maria Jose Silva'], ['z', 'Maria Souza']]);
  // comparação sem diferenciar maiúsculas
  assert.deepEqual([...rotulosFuncionariasFiltro([f('1', 'ana lima'), f('2', 'ANA COSTA')])], [['1', 'Ana Lima'], ['2', 'Ana Costa']]);
  assert.equal(rotulosFuncionariasFiltro(null).size, 0);
});
