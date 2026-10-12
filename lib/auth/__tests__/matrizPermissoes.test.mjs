// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/auth/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSOES } from '../permissoes.js';
import {
  ACAO_LABEL,
  CODIGOS_ADMINISTRATIVOS,
  CODIGOS_FORA_DA_MATRIZ,
  GRUPO_LABEL,
  MODULOS_MATRIZ,
  codigosDoGrupo,
} from '../matrizPermissoes.js';

const naMatriz = MODULOS_MATRIZ.flatMap((m) => m.itens.map((i) => i.codigo));
const administrativos = CODIGOS_ADMINISTRATIVOS.map((c) => c.codigo);

test('todo código de PERMISSOES está na matriz, nos administrativos ou na lista de fora', () => {
  const classificados = new Set([...naMatriz, ...administrativos, ...CODIGOS_FORA_DA_MATRIZ]);
  const faltando = Object.values(PERMISSOES).filter((c) => !classificados.has(c));
  assert.deepEqual(faltando, []);
});

test('nenhum código aparece duas vezes nem em duas classificações', () => {
  const todos = [...naMatriz, ...administrativos, ...CODIGOS_FORA_DA_MATRIZ];
  assert.equal(new Set(todos).size, todos.length);
});

test('a matriz só usa códigos reais do catálogo', () => {
  const reais = new Set(Object.values(PERMISSOES));
  assert.deepEqual(naMatriz.filter((c) => !reais.has(c)), []);
});

test('códigos administrativos nunca são editáveis na matriz', () => {
  for (const c of administrativos) assert.equal(naMatriz.includes(c), false);
});

test('Folha > Pagamentos, Clientes e Encomendas agora são administráveis', () => {
  for (const c of [
    'folha_pagamentos.visualizar', 'folha_pagamentos.editar', 'folha_pagamentos.confirmar',
    'folha_pagamentos.cancelar', 'folha_pagamentos.regras',
    'clientes.visualizar', 'clientes.editar', 'encomendas.visualizar', 'encomendas.editar',
  ]) {
    assert.equal(naMatriz.includes(c), true, c);
  }
  assert.deepEqual(codigosDoGrupo('clientes'), [
    'clientes.visualizar', 'clientes.editar', 'encomendas.visualizar', 'encomendas.editar',
  ]);
  assert.ok(codigosDoGrupo('funcionarios').includes('folha_pagamentos.regras'));
});

test('toda ação tem rótulo e todo grupo tem título', () => {
  for (const m of MODULOS_MATRIZ) {
    for (const i of m.itens) assert.ok(ACAO_LABEL[i.acao], `${m.chave}:${i.acao}`);
    if (m.grupo) assert.ok(GRUPO_LABEL[m.grupo], m.grupo);
  }
});

test('chaves de módulo únicas', () => {
  const chaves = MODULOS_MATRIZ.map((m) => m.chave);
  assert.equal(new Set(chaves).size, chaves.length);
});
