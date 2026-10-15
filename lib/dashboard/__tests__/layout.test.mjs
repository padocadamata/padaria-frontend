// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/dashboard/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WIDGETS_DASHBOARD, definirTamanho, ehLayoutPadrao, layoutPadrao, layoutValidoParaBanco, mesclarLayout, moverWidget,
} from '../layout.js';

const ids = (layout) => layout.map((w) => w.id);
const CAT = [
  { id: 'a', tamanhos: ['P', 'M', 'G'], padrao: 'P' },
  { id: 'b', tamanhos: ['P', 'M', 'G'], padrao: 'M' },
  { id: 'c', tamanhos: ['G'], padrao: 'G' },
];

test('sem preferência: ordem e tamanhos padrão (a ordem atual do Dashboard)', () => {
  assert.deepEqual(mesclarLayout(null), layoutPadrao());
  assert.deepEqual(ids(layoutPadrao()), ['agenda_hoje', 'atencao_producao', 'recebimentos_previstos', 'lembretes', 'aniversariantes', 'agenda_pedidos']);
  assert.ok(ehLayoutPadrao(mesclarLayout(undefined)));
});

test('widget NOVO nunca some: entra depois do vizinho da ordem padrão, com tamanho padrão', () => {
  const salvo = [{ id: 'c', tamanho: 'G' }, { id: 'a', tamanho: 'G' }];
  assert.deepEqual(mesclarLayout(salvo, CAT), [
    { id: 'c', tamanho: 'G' },
    { id: 'a', tamanho: 'G' },
    { id: 'b', tamanho: 'M' },
  ]);
  // Novo widget que é o 1º do catálogo entra no início.
  assert.deepEqual(ids(mesclarLayout([{ id: 'b', tamanho: 'P' }], CAT)), ['a', 'b', 'c']);
});

test('widget REMOVIDO e entradas inválidas/repetidas não quebram nada', () => {
  const salvo = [{ id: 'sumiu', tamanho: 'G' }, null, { id: 'b', tamanho: 'G' }, { id: 'b', tamanho: 'P' }, 'lixo', { id: 'a', tamanho: 'XL' }];
  // 'a' (tamanho inválido -> padrão P) fica onde estava; 'c' (não salvo) entra
  // logo depois de 'b', seu vizinho anterior na ordem padrão.
  assert.deepEqual(mesclarLayout(salvo, CAT), [
    { id: 'b', tamanho: 'G' },
    { id: 'c', tamanho: 'G' },
    { id: 'a', tamanho: 'P' },
  ]);
  assert.deepEqual(mesclarLayout({ nao: 'array' }, CAT), layoutPadrao(CAT));
});

test('tamanho fora dos permitidos volta ao padrão (Agenda de pedidos só G)', () => {
  const r = mesclarLayout([{ id: 'agenda_pedidos', tamanho: 'P' }]);
  assert.equal(r.find((w) => w.id === 'agenda_pedidos').tamanho, 'G');
  const l = layoutPadrao();
  assert.equal(definirTamanho(l, 'agenda_pedidos', 'P'), l, 'P não é permitido');
  assert.equal(definirTamanho(l, 'lembretes', 'G').find((w) => w.id === 'lembretes').tamanho, 'G');
  assert.equal(definirTamanho(l, 'inexistente', 'G'), l);
  for (const w of WIDGETS_DASHBOARD) assert.ok(w.tamanhos.includes(w.padrao), w.id);
});

test('mover: troca com o vizinho VISÍVEL, nas bordas não faz nada', () => {
  const l = layoutPadrao(CAT);
  assert.deepEqual(ids(moverWidget(l, 'b', -1)), ['b', 'a', 'c']);
  assert.deepEqual(ids(moverWidget(l, 'a', -1)), ['a', 'b', 'c']);
  assert.deepEqual(ids(moverWidget(l, 'c', 1)), ['a', 'b', 'c']);
  // 'b' invisível: 'a' desce pulando 'b' e troca com 'c'.
  assert.deepEqual(ids(moverWidget(l, 'a', 1, new Set(['a', 'c']))), ['c', 'b', 'a']);
  assert.equal(moverWidget(l, 'x', 1), l);
});

test('validação espelha o CHECK do banco', () => {
  assert.ok(layoutValidoParaBanco(layoutPadrao()));
  assert.ok(layoutValidoParaBanco([]));
  for (const ruim of [
    null,
    {},
    [{ id: 'a', tamanho: 'X' }],
    [{ id: 'a', tamanho: 'P', extra: 1 }],
    [{ id: 'a', tamanho: 'P' }, { id: 'a', tamanho: 'G' }],
    [{ id: 'A-b', tamanho: 'P' }],
    [{ tamanho: 'P' }],
    Array.from({ length: 41 }, (_, i) => ({ id: `w${i}`, tamanho: 'P' })),
  ]) {
    assert.ok(!layoutValidoParaBanco(ruim), JSON.stringify(ruim)?.slice(0, 60));
  }
});
