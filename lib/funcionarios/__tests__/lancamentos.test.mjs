// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/funcionarios/__tests__/lancamentos.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparPendentesPorFuncionaria,
  descreverPendentes,
  idsSelecionados,
  resumirComLancamentos,
  rotuloNatureza,
  sinalNatureza,
  tiposParaSelecao,
  totaisLancamentos,
  validarLancamento,
} from '../lancamentosCalculo.js';
import { resumirValores } from '../pagamentosCalculo.js';

const L = (id, natureza, valor, extra = {}) => ({ id, funcionario_id: 'simone', natureza, valor, data_lancamento: '2026-10-15', ...extra });

test('natureza: rótulo e sinal textual (não depende de cor)', () => {
  assert.equal(rotuloNatureza('desconto'), 'Desconto');
  assert.equal(rotuloNatureza('acrescimo'), 'Acréscimo');
  assert.equal(sinalNatureza('desconto'), '−');
  assert.equal(sinalNatureza('acrescimo'), '+');
});

test('validarLancamento: payload normalizado e erros por campo', () => {
  const ok = validarLancamento({ funcionarioId: 'f', tipoId: 't', natureza: 'desconto', valor: '32,50', data: '2026-10-15', observacao: '  Lanche ' });
  assert.deepEqual(ok, { payload: { funcionarioId: 'f', tipoId: 't', natureza: 'desconto', valor: 32.5, data: '2026-10-15', observacao: 'Lanche' }, erros: {} });
  assert.equal(validarLancamento({ funcionarioId: 'f', tipoId: 't', natureza: 'acrescimo', valor: '1.234,56', data: '2026-10-15' }).payload.valor, 1234.56);
  assert.equal(validarLancamento({ funcionarioId: 'f', tipoId: 't', natureza: 'desconto', valor: '20', data: '2026-10-15', observacao: '   ' }).payload.observacao, null);
  const ruim = validarLancamento({ natureza: 'credito', valor: '0', data: '' });
  assert.equal(ruim.payload, null);
  assert.deepEqual(Object.keys(ruim.erros).sort(), ['data', 'funcionarioId', 'natureza', 'tipoId', 'valor']);
  assert.ok(validarLancamento({ funcionarioId: 'f', tipoId: 't', natureza: 'desconto', valor: '-5', data: '2026-10-15' }).erros.valor);
  assert.ok(validarLancamento({ funcionarioId: 'f', tipoId: 't', natureza: 'desconto', valor: 'abc', data: '2026-10-15' }).erros.valor);
});

test('validarLancamento: data futura recusada; hoje e passado aceitos', () => {
  const base = { funcionarioId: 'f', tipoId: 't', natureza: 'desconto', valor: '10', hoje: '2026-10-15' };
  assert.equal(validarLancamento({ ...base, data: '2026-10-16' }).erros.data, 'A data não pode ser no futuro.');
  assert.equal(validarLancamento({ ...base, data: '2027-01-01' }).payload, null);
  assert.equal(validarLancamento({ ...base, data: '2026-10-15' }).payload.data, '2026-10-15');
  assert.equal(validarLancamento({ ...base, data: '2025-12-31' }).payload.data, '2025-12-31');
});

test('cálculo do líquido: base 570 + acréscimo 20 − desconto 32,50 = 557,50 (exemplo do pedido)', () => {
  const r = resumirComLancamentos(570, [], [L('a', 'acrescimo', 20), L('d', 'desconto', '32.50')]);
  assert.deepEqual(r, { bruto: 570, acrescimos: 20, descontosManuais: 0, descontosLancamentos: 32.5, descontos: 32.5, liquido: 557.5 });
});

test('cálculo combina descontos digitados e de lançamentos, em centavos', () => {
  const r = resumirComLancamentos(0.3, [{ valor: 0.1 }], [L('d', 'desconto', 0.2), L('a', 'acrescimo', 0.1)]);
  assert.equal(r.liquido, 0.1);
  assert.equal(r.descontos, 0.3);
});

test('regressão: sem lançamentos o resumo é o mesmo de antes (resumirValores)', () => {
  const descontos = [{ valor: 5 }, { valor: 7.25 }];
  const antes = resumirValores(160, descontos);
  const depois = resumirComLancamentos(160, descontos, []);
  assert.equal(depois.bruto, antes.bruto);
  assert.equal(depois.descontos, antes.descontos);
  assert.equal(depois.liquido, antes.liquido);
  assert.equal(depois.acrescimos, 0);
});

test('descontos acima do bruto geram líquido negativo (a tela e o banco recusam)', () => {
  assert.ok(resumirComLancamentos(80, [], [L('d', 'desconto', 80.01)]).liquido < 0);
  assert.equal(resumirComLancamentos(80, [], [L('d', 'desconto', 100), L('a', 'acrescimo', 20)]).liquido, 0);
});

test('seleção parcial: só os marcados entram, na ordem da lista', () => {
  const lista = [L('1', 'desconto', 10), L('2', 'acrescimo', 5), L('3', 'desconto', 1)];
  assert.deepEqual(idsSelecionados(lista, new Set(['3', '1'])), ['1', '3']);
  assert.deepEqual(idsSelecionados(lista, new Set()), []);
  assert.deepEqual(totaisLancamentos(lista.filter((l) => new Set(['1', '2']).has(l.id))), { quantidade: 2, acrescimos: 5, descontos: 10 });
});

test('pendentes agrupados por funcionária, ordenados por data, com totais', () => {
  const mapa = agruparPendentesPorFuncionaria([
    L('b', 'desconto', 10, { data_lancamento: '2026-10-16' }),
    L('a', 'acrescimo', 20, { data_lancamento: '2026-10-15' }),
    L('c', 'desconto', 5, { funcionario_id: 'maria' }),
  ]);
  assert.deepEqual(mapa.get('simone').lancamentos.map((l) => l.id), ['a', 'b']);
  assert.deepEqual([mapa.get('simone').quantidade, mapa.get('simone').acrescimos, mapa.get('simone').descontos], [2, 20, 10]);
  assert.equal(mapa.get('maria').quantidade, 1);
  assert.equal(descreverPendentes(mapa.get('simone')), '2 lançamentos pendentes · − R$ 10,00 · + R$ 20,00');
  assert.equal(descreverPendentes(mapa.get('maria')), '1 lançamento pendente · − R$ 5,00');
  assert.equal(descreverPendentes({ quantidade: 0 }), '');
});

test('tipos no seletor: só ativos, exceto o tipo atual da edição (mesmo inativo)', () => {
  const tipos = [
    { id: 'v', nome: 'Vale', ativo: true },
    { id: 'c', nome: 'Compra na Padoca', ativo: true },
    { id: 'x', nome: 'Antigo', ativo: false },
  ];
  assert.deepEqual(tiposParaSelecao(tipos).map((t) => t.id), ['c', 'v']);
  assert.deepEqual(tiposParaSelecao(tipos, 'x').map((t) => t.id), ['x', 'c', 'v']);
});
