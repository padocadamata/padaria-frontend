// Payload das RPCs de pagamento com/sem lançamentos (migration 0076), com
// o cliente Supabase simulado (sem rede, sem chave real).
//
//   node --experimental-test-module-mocks \
//     --import ./lib/funcionarios/__tests__/resolverImports.mjs \
//     --test lib/funcionarios/__tests__/pagamentosLancamentosPayload.test.mjs
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const chamadas = [];
beforeEach(() => {
  chamadas.length = 0;
});

mock.module(new URL('../../supabase/client.js', import.meta.url).href, {
  namedExports: {
    createClient: () => ({
      rpc: async (nome, args) => {
        chamadas.push({ nome, args });
        return { data: 'pag-1', error: null };
      },
    }),
  },
});

const { criarPagamentoPorHora, criarPagamentoMensal, criarPagamentoRegularizacaoHistorica } = await import('../pagamentos.js');
const { idsSelecionados } = await import('../lancamentosCalculo.js');

const jornadas = [{ data: '2026-10-13', hora_inicio: '08:00:00', hora_fim: '14:00:00' }];
const base = { funcionarioId: 'simone', jornadas, descontos: [], dataEfetiva: '2026-10-15', observacao: '' };

test('E) nenhum lançamento selecionado: chamada idêntica à de antes (sem p_lancamentos)', async () => {
  const lista = [{ id: 'compra' }];
  const r = await criarPagamentoPorHora({ ...base, lancamentos: idsSelecionados(lista, new Set()) });
  assert.deepEqual(r, { id: 'pag-1', erro: '' });
  assert.equal(chamadas[0].nome, 'folha_criar_pagamento_por_hora');
  assert.deepEqual(Object.keys(chamadas[0].args).sort(), ['p_data_efetiva', 'p_descontos', 'p_funcionario_id', 'p_jornadas', 'p_observacao']);
  // Sem o parâmetro (default no chamador) também vale.
  await criarPagamentoPorHora(base);
  assert.equal('p_lancamentos' in chamadas[1].args, false);
});

test('B/E) com o desconto marcado: p_lancamentos leva só o id escolhido, na mesma chamada da RPC', async () => {
  const lista = [{ id: 'compra' }, { id: 'vale' }];
  await criarPagamentoPorHora({ ...base, lancamentos: idsSelecionados(lista, new Set(['compra'])) });
  assert.equal(chamadas.length, 1, 'uma RPC só (transação única no banco)');
  assert.deepEqual(chamadas[0].args.p_lancamentos, ['compra']);
  assert.equal(chamadas[0].args.p_funcionario_id, 'simone');
});

test('mensal e regularização: mesmo contrato de p_lancamentos', async () => {
  await criarPagamentoMensal({
    funcionarioId: 'maria', competencia: '2026-10-01', tipoLancamento: 'integral', valorBase: 1800, extras: [], descontos: [],
    dataEfetiva: '2026-10-15', observacao: '', lancamentos: ['l4'],
  });
  await criarPagamentoMensal({
    funcionarioId: 'maria', competencia: '2026-10-01', tipoLancamento: 'integral', valorBase: 1800, extras: [], descontos: [],
    dataEfetiva: '2026-10-15', observacao: '',
  });
  await criarPagamentoRegularizacaoHistorica({ ...base, lancamentos: ['a', 'b'] });
  assert.deepEqual(chamadas.map((c) => [c.nome, c.args.p_lancamentos]), [
    ['folha_criar_pagamento_mensal', ['l4']],
    ['folha_criar_pagamento_mensal', undefined],
    ['folha_criar_pagamento_regularizacao_historica', ['a', 'b']],
  ]);
});
