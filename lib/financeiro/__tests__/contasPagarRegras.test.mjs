// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/financeiro/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classificarParcela, totalizarAPagar, dividirEmParcelas, gerarVencimentos, gerarParcelas, valorEfetivo,
  estadoPagamentoInicial, montarPagamento, totalDosItens, competenciaDe, normalizarNomeCurto,
  FORMAS_NO_ATO, FORMAS_A_PRAZO, somaParcelasTexto,
} from '../contasPagarRegras.js';

const HOJE = '2026-10-12';

test('dividirEmParcelas: centavos, diferença na primeira parcela, soma exata', () => {
  assert.deepEqual(dividirEmParcelas(100, 3), [33.34, 33.33, 33.33]);
  assert.deepEqual(dividirEmParcelas(3000, 3), [1000, 1000, 1000]);
  assert.deepEqual(dividirEmParcelas(0.05, 3), [0.03, 0.01, 0.01]);
  assert.deepEqual(dividirEmParcelas(550, 1), [550]);
  for (const [total, n] of [[1234.57, 7], [0.1, 3], [999.99, 12], [10, 6]]) {
    const partes = dividirEmParcelas(total, n);
    assert.equal(partes.length, n);
    assert.equal(Math.round(partes.reduce((s, v) => s + v * 100, 0)), Math.round(total * 100), `${total}/${n}`);
  }
});

test('gerarVencimentos/gerarParcelas: intervalo em dias a partir do primeiro vencimento', () => {
  assert.deepEqual(gerarVencimentos('2026-10-31', 3, 30), ['2026-10-31', '2026-11-30', '2026-12-30']);
  assert.deepEqual(gerarParcelas({ total: 100, quantidade: 3, primeiroVencimento: '2026-11-11', intervaloDias: 28 }), [
    { vencimento: '2026-11-11', valorTexto: '33,34' },
    { vencimento: '2026-12-09', valorTexto: '33,33' },
    { vencimento: '2027-01-06', valorTexto: '33,33' },
  ]);
});

test('classificarParcela: vencida / vence hoje / próximos 7 dias / depois; paga e cancelada vêm do banco', () => {
  const p = (vencimento, situacao = 'pendente') => ({ vencimento, situacao, valor: '10.00' });
  assert.equal(classificarParcela(p('2026-10-11'), HOJE), 'vencida');
  assert.equal(classificarParcela(p('2026-10-12'), HOJE), 'vence_hoje');
  assert.equal(classificarParcela(p('2026-10-13'), HOJE), 'proximos_7');
  assert.equal(classificarParcela(p('2026-10-19'), HOJE), 'proximos_7');
  assert.equal(classificarParcela(p('2026-10-20'), HOJE), 'depois');
  assert.equal(classificarParcela(p('2026-10-01', 'paga'), HOJE), 'paga');
  assert.equal(classificarParcela(p('2026-10-01', 'cancelada'), HOJE), 'cancelada');
});

test('totalizarAPagar: só pendentes, por grupo, em centavos', () => {
  const t = totalizarAPagar([
    { vencimento: '2026-10-01', situacao: 'pendente', valor: '0.10' },
    { vencimento: '2026-10-02', situacao: 'pendente', valor: '0.20' },
    { vencimento: '2026-10-12', situacao: 'pendente', valor: '100.00' },
    { vencimento: '2026-10-15', situacao: 'pendente', valor: '50.55' },
    { vencimento: '2026-12-01', situacao: 'pendente', valor: '1000.00' },
    { vencimento: '2026-10-01', situacao: 'paga', valor: '999.00' },
  ], HOJE);
  assert.deepEqual(t, { geral: 1150.85, vencida: 0.3, vence_hoje: 100, proximos_7: 50.55, depois: 1000, quantidade: 5 });
});

test('valorEfetivo: 1000 + 15 + 5 - 20 = 1000 (sem erro de ponto flutuante)', () => {
  assert.equal(valorEfetivo({ original: 1000, juros: 15, multa: 5, desconto: 20 }), 1000);
  assert.equal(valorEfetivo({ original: 0.1, juros: 0.2 }), 0.3);
  assert.equal(valorEfetivo({ original: 183.33, desconto: 3.33 }), 180);
});

test('formas: cartão só no ato, boleto só a prazo', () => {
  assert.ok(!FORMAS_NO_ATO.some((f) => f.valor === 'boleto'));
  assert.ok(!FORMAS_A_PRAZO.some((f) => f.valor.startsWith('cartao_')));
  assert.ok(FORMAS_NO_ATO.some((f) => f.valor === 'cartao_credito'));
});

test('montarPagamento: não lançar, no ato, a prazo com soma exata', () => {
  const base = estadoPagamentoInicial({ dataBase: HOJE });
  assert.deepEqual(montarPagamento(base, { total: 550, hoje: HOJE }), { semFinanceiro: true });
  assert.match(montarPagamento(base, { total: 550, hoje: HOJE, exigeLancamento: true }).erro, /Pago no ato/);

  const noAto = { ...base, modo: 'no_ato', forma: 'cartao_credito', observacao: '  maquininha ' };
  assert.deepEqual(montarPagamento(noAto, { total: 550, hoje: HOJE }), {
    payload: { condicao: 'no_ato', forma: 'cartao_credito', parcelas: null, pagoEm: HOJE, observacao: 'maquininha' },
  });
  assert.match(montarPagamento({ ...noAto, forma: 'boleto' }, { hoje: HOJE }).erro, /Boleto/);
  assert.match(montarPagamento({ ...noAto, pagoEm: '2026-10-13' }, { hoje: HOJE }).erro, /futuro/);

  const parcelas = gerarParcelas({ total: 550, quantidade: 3, primeiroVencimento: '2026-11-11', intervaloDias: 30 });
  const aPrazo = { ...base, modo: 'a_prazo', forma: 'boleto', parcelas };
  assert.deepEqual(montarPagamento(aPrazo, { total: 550, hoje: HOJE }).payload.parcelas, [
    { vencimento: '2026-11-11', valor: 183.34 }, { vencimento: '2026-12-11', valor: 183.33 }, { vencimento: '2027-01-10', valor: 183.33 },
  ]);
  const errado = { ...aPrazo, parcelas: [...parcelas.slice(0, 2), { ...parcelas[2], valorTexto: '183,32' }] };
  assert.match(montarPagamento(errado, { total: 550 }).erro, /precisa ser exatamente o total/);
  assert.match(montarPagamento({ ...aPrazo, forma: 'cartao_debito' }, { total: 550 }).erro, /Cartão/);
  assert.match(montarPagamento({ ...aPrazo, parcelas: [{ vencimento: '', valorTexto: '550' }] }, { total: 550 }).erro, /vencimento/);
  assert.match(montarPagamento({ ...aPrazo, parcelas: [{ vencimento: HOJE, valorTexto: '0' }] }, { total: null }).erro, /maior que zero/);
  // Despesa manual: o total É a soma (sem conferência contra um total externo).
  assert.equal(montarPagamento({ ...aPrazo, parcelas: [{ vencimento: HOJE, valorTexto: '1.234,56' }] }, { total: null }).payload.parcelas[0].valor, 1234.56);
  assert.equal(somaParcelasTexto(parcelas), 550);
});

test('totalDosItens: soma de round(qtd x valor, 2) por item, como o banco', () => {
  assert.equal(totalDosItens([{ quantidade: '10', valorUnitario: '50' }, { quantidade: '2', valorUnitario: '25' }]), 550);
  assert.equal(totalDosItens([{ quantidade: '1.842', valorUnitario: '10.005' }]), 18.43);
  assert.equal(totalDosItens([{ quantidade: '3', valorUnitario: '0.1' }]), 0.3);
  assert.equal(totalDosItens([{ quantidade: 'x', valorUnitario: '1' }]), null);
});

test('competência e nomes curtos', () => {
  assert.equal(competenciaDe('2026-10-25'), '2026-10-01');
  assert.equal(competenciaDe(''), '');
  assert.equal(normalizarNomeCurto('  imobiliária   são josé '), 'IMOBILIÁRIA SÃO JOSÉ');
});
