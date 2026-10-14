// node --test --import ./lib/funcionarios/__tests__/resolverImports.mjs lib/supabase/__tests__/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { lerEmLotes } from '../lerEmLotes.js';

// Consulta falsa no formato do supabase-js: montarConsulta() devolve um
// objeto com .range(a, b) que resolve { data, error }, cortando em
// `maxRows` como o PostgREST faz.
function fonte(total, { maxRows = 1000, erroNoLote = -1 } = {}) {
  const chamadas = [];
  const dados = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  return {
    chamadas,
    montar: () => ({
      range(inicio, fim) {
        chamadas.push([inicio, fim]);
        if (chamadas.length - 1 === erroNoLote) return Promise.resolve({ data: null, error: { message: 'falhou' } });
        const ate = Math.min(fim + 1, inicio + maxRows);
        return Promise.resolve({ data: dados.slice(inicio, ate), error: null });
      },
    }),
  };
}

test('lê tudo além de 1000 linhas, em lotes contíguos, sem repetir nem pular', async () => {
  const f = fonte(2500);
  const { data, error } = await lerEmLotes(f.montar);
  assert.equal(error, null);
  assert.equal(data.length, 2500);
  assert.equal(new Set(data.map((d) => d.id)).size, 2500);
  assert.deepEqual(f.chamadas, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('múltiplo exato do lote: faz uma leitura final vazia e para', async () => {
  const f = fonte(2000);
  const { data } = await lerEmLotes(f.montar);
  assert.equal(data.length, 2000);
  assert.equal(f.chamadas.length, 3);
});

test('tabela vazia: uma leitura, lista vazia', async () => {
  const f = fonte(0);
  const { data, error } = await lerEmLotes(f.montar);
  assert.deepEqual(data, []);
  assert.equal(error, null);
  assert.equal(f.chamadas.length, 1);
});

test('erro em qualquer lote devolve erro (nunca dados parciais)', async () => {
  const f = fonte(2500, { erroNoLote: 1 });
  const { data, error } = await lerEmLotes(f.montar);
  assert.equal(data, null);
  assert.equal(error.message, 'falhou');
});

test('rede de segurança: limite de lotes interrompe com erro, sem loop infinito', async () => {
  const sempreCheio = () => ({ range: (a, b) => Promise.resolve({ data: Array.from({ length: b - a + 1 }, () => ({})), error: null }) });
  const { data, error } = await lerEmLotes(sempreCheio, { tamanho: 10, maxLotes: 5 });
  assert.equal(data, null);
  assert.match(error.message, /limite de 5 lotes/);
});

test('tamanho de lote customizado', async () => {
  const f = fonte(25, { maxRows: 10 });
  const { data } = await lerEmLotes(f.montar, { tamanho: 10 });
  assert.equal(data.length, 25);
  assert.deepEqual(f.chamadas, [[0, 9], [10, 19], [20, 29]]);
});

for (const total of [999, 1000, 1001]) {
  test(`fronteira do lote: ${total} registros -- todos, uma vez cada, na ordem`, async () => {
    const f = fonte(total);
    const { data, error } = await lerEmLotes(f.montar);
    assert.equal(error, null);
    assert.equal(data.length, total);
    assert.deepEqual(data.map((d) => d.id), Array.from({ length: total }, (_, i) => i + 1));
    // 999 -> 1 leitura; 1000 -> 2 (a 2ª vem vazia e encerra); 1001 -> 2.
    assert.equal(f.chamadas.length, total < 1000 ? 1 : 2);
  });
}

test('cada lote é uma consulta NOVA (filtros reaplicados), nunca a mesma instância reaproveitada', async () => {
  let montagens = 0;
  const f = fonte(2500);
  await lerEmLotes(() => {
    montagens += 1;
    return f.montar();
  });
  assert.equal(montagens, 3);
});
