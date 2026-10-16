// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/funcionarios/__tests__/lancamentos.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparPendentesPorFuncionaria,
  alternarSelecao,
  descreverPendentes,
  idsSelecionados,
  lancamentosSelecionados,
  pendentesDaPessoa,
  pendentesForaDosBlocos,
  resumoDoBloco,
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

// ------------------------------------------------------------
// Seleção DENTRO do cartão da pessoa em A Pagar (rodada pós-smoke 0076).
// ------------------------------------------------------------

// Caso real do smoke: SIMONE, jornadas R$ 570,00, Compra na Padoca R$ 52,59.
const compraSimone = L('compra', 'desconto', 52.59, {
  tipo_nome: 'Compra na Padoca',
  data_lancamento: '2026-10-13',
  observacao: '1 Coca-Cola 2L - R$ 15,90; 0,280g Mussarela - R$ 18,17; 0,206g Peito de Peru - R$ 18,52',
});

test('A) sem lançamento: o resumo do cartão é só o bruto das jornadas (fluxo de antes)', () => {
  const r = resumoDoBloco(570, [], new Set());
  assert.deepEqual([r.bruto, r.acrescimos, r.descontos, r.liquido], [570, 0, 0, 570]);
  // Marcas antigas sem lançamento na lista não mudam nada.
  assert.equal(resumoDoBloco(570, [], new Set(['fantasma'])).liquido, 570);
});

test('B) 1 desconto: nada marcado sozinho; marcar dá 570,00 − 52,59 = 517,41; desmarcar volta a 570,00', () => {
  const lista = [compraSimone];
  let marcados = new Set();
  assert.equal(resumoDoBloco(570, lista, marcados).liquido, 570, 'não seleciona automaticamente');
  marcados = alternarSelecao(marcados, 'compra');
  const r = resumoDoBloco(570, lista, marcados);
  assert.deepEqual([r.bruto, r.acrescimos, r.descontos, r.liquido], [570, 0, 52.59, 517.41]);
  assert.deepEqual(idsSelecionados(lista, marcados), ['compra']);
  marcados = alternarSelecao(marcados, 'compra');
  assert.equal(resumoDoBloco(570, lista, marcados).liquido, 570);
  assert.deepEqual(idsSelecionados(lista, marcados), []);
});

test('B) alternarSelecao devolve um Set novo (estado React imutável)', () => {
  const antes = new Set(['a']);
  const depois = alternarSelecao(antes, 'b');
  assert.notEqual(depois, antes);
  assert.deepEqual([...antes], ['a']);
  assert.deepEqual([...depois].sort(), ['a', 'b']);
});

test('C) desconto + acréscimo: só os marcados afetam o líquido', () => {
  const lista = [compraSimone, L('vale', 'desconto', 50), L('ajuste', 'acrescimo', 20)];
  assert.equal(resumoDoBloco(570, lista, new Set(['ajuste'])).liquido, 590);
  assert.equal(resumoDoBloco(570, lista, new Set(['compra', 'ajuste'])).liquido, 537.41);
  const todos = resumoDoBloco(570, lista, new Set(['compra', 'vale', 'ajuste']));
  assert.deepEqual([todos.acrescimos, todos.descontos, todos.liquido], [20, 102.59, 487.41]);
  assert.deepEqual(idsSelecionados(lista, new Set(['ajuste', 'compra'])), ['compra', 'ajuste'], 'ordem da lista');
});

test('D) lançamento de outra funcionária nunca entra no cartão/pagamento errado', () => {
  const daMaria = L('maria-1', 'desconto', 18.9, { funcionario_id: 'maria' });
  const mapa = agruparPendentesPorFuncionaria([compraSimone, daMaria]);
  const daSimone = mapa.get('simone').lancamentos;
  assert.deepEqual(daSimone.map((l) => l.id), ['compra']);
  // Mesmo que o id da Maria esteja "marcado", ele não está na lista da Simone.
  const marcados = new Set(['compra', 'maria-1']);
  assert.deepEqual(lancamentosSelecionados(daSimone, marcados).map((l) => l.id), ['compra']);
  assert.deepEqual(idsSelecionados(daSimone, marcados), ['compra']);
  assert.equal(resumoDoBloco(570, daSimone, marcados).liquido, 517.41);
});

test('D) lançamento usado/cancelado (sumiu da lista ao recarregar) sai do cálculo e do payload', () => {
  const marcados = new Set(['compra']);
  assert.deepEqual(idsSelecionados([], marcados), []);
  assert.equal(resumoDoBloco(570, [], marcados).liquido, 570);
});

test('descontos acima do bruto no cartão: líquido negativo (a ação fica bloqueada)', () => {
  assert.ok(resumoDoBloco(40, [compraSimone], new Set(['compra'])).liquido < 0);
});

test('pendentes de quem não tem cartão em A Pagar (inativa/sem configuração) continuam visíveis', () => {
  const mapa = agruparPendentesPorFuncionaria([
    compraSimone,
    L('x', 'desconto', 10, { funcionario_id: 'zuleica', funcionario_nome: 'ZULEICA', funcionario_ativo: false }),
    L('y', 'acrescimo', 5, { funcionario_id: 'ana', funcionario_nome: 'ANA', funcionario_ativo: true }),
  ]);
  const fora = pendentesForaDosBlocos(mapa, new Set(['simone']));
  assert.deepEqual(fora.map((g) => [g.nome, g.inativa, g.quantidade]), [
    ['ANA', false, 1],
    ['ZULEICA', true, 1],
  ]);
  assert.deepEqual(pendentesForaDosBlocos(mapa, new Set(['simone', 'zuleica', 'ana'])), []);
});

test('inativa: lançamentos nunca selecionáveis num cartão de pagamento (ficam em "fora de A Pagar")', () => {
  const mapa = agruparPendentesPorFuncionaria([
    compraSimone,
    L('z', 'desconto', 10, { funcionario_id: 'zuleica', funcionario_nome: 'ZULEICA', funcionario_ativo: false }),
  ]);
  const ativos = new Set(['simone']);
  assert.deepEqual(pendentesDaPessoa(mapa, 'simone', ativos).map((l) => l.id), ['compra']);
  // Mesmo com cartão de regularização histórica, a inativa não recebe lançamentos selecionáveis...
  assert.deepEqual(pendentesDaPessoa(mapa, 'zuleica', ativos), []);
  // ...e continua listada (auditável) fora dos cartões.
  assert.deepEqual(pendentesForaDosBlocos(mapa, new Set(['simone'])).map((g) => [g.nome, g.inativa]), [['ZULEICA', true]]);
  assert.deepEqual(pendentesDaPessoa(mapa, 'ninguem', ativos), []);
});
