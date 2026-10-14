// node --test --import ./lib/funcionarios/__tests__/resolverImports.mjs lib/producao/__tests__/operacoesTurno.test.mjs
// Regras de Iniciar/Adicionar/Fechar turno -- as MESMAS usadas pelos modais
// e pela tabela do desktop (lib/producao/operacoesTurno.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validarQuantidadePositiva, calcularFechamento, mensagemErroIniciar, mensagemErroAdicionar } from '../operacoesTurno.js';

test('quantidade de Iniciar/Adicionar: inteiro > 0 (mesmo critério do modal)', () => {
  assert.deepEqual(validarQuantidadePositiva('150'), { valor: 150, erro: '' });
  for (const invalido of ['', '0', '-3', 'abc']) {
    assert.equal(validarQuantidadePositiva(invalido).erro, 'Informe uma quantidade maior que zero.');
  }
  // parseInt, como no modal: "12.7" vira 12.
  assert.equal(validarQuantidadePositiva('12.7').valor, 12);
});

test('mensagens de erro de gravação preservadas', () => {
  assert.equal(mensagemErroIniciar({ code: '23505' }), 'Este turno já tem produção lançada. Atualize a página.');
  assert.match(mensagemErroIniciar({ code: 'x' }), /Não foi possível iniciar/);
  assert.equal(mensagemErroAdicionar({ message: 'registro nao esta status=aberto' }), 'Este turno já foi fechado — atualize a página.');
});

const base = { produzida: '120', sobraTotal: '', aproveitavel: '', perda: '' };

test('fechar: sobra total digitada -> vendido = produzido - sobra; classificação opcional (NULL)', () => {
  const c = calcularFechamento({ ...base, sobraTotal: '16' });
  assert.equal(c.erro, '');
  assert.equal(c.bloqueado, false);
  assert.equal(c.quantidadeVendida, 104);
  assert.equal(c.sobraTotalNum, 16);
  assert.equal(c.aproveitavelNum, null);
  assert.equal(c.perdaNum, null);
  assert.equal(c.sobraNaoClassificada, 16);
});

test('fechar: sobra total em branco é derivada da classificação', () => {
  const c = calcularFechamento({ ...base, aproveitavel: '10', perda: '6' });
  assert.equal(c.sobraTotalNum, 16);
  assert.equal(c.quantidadeVendida, 104);
  assert.equal(c.erro, '');
});

test('fechar: nada preenchido bloqueia ("Informe ao menos a sobra total.")', () => {
  const c = calcularFechamento(base);
  assert.equal(c.bloqueado, true);
  assert.equal(c.erro, 'Informe ao menos a sobra total.');
});

test('fechar: classificação maior que a sobra total bloqueia', () => {
  const c = calcularFechamento({ ...base, sobraTotal: '5', aproveitavel: '4', perda: '3' });
  assert.equal(c.bloqueado, true);
  assert.match(c.erro, /\(7\) não pode ultrapassar a sobra total \(5\)/);
});

test('fechar: sobra maior que o produzido bloqueia', () => {
  const c = calcularFechamento({ ...base, sobraTotal: '121' });
  assert.equal(c.bloqueado, true);
  assert.match(c.erro, /sobra total \(121\) não pode ser maior que a quantidade produzida \(120\)/);
});

test('fechar: números inválidos/negativos bloqueiam com a mensagem do modal', () => {
  for (const campos of [{ sobraTotal: '-1' }, { aproveitavel: 'x' }, { produzida: '0', sobraTotal: '0' }]) {
    const c = calcularFechamento({ ...base, ...campos });
    assert.equal(c.bloqueado, true);
    assert.equal(c.erro, 'Preencha os valores com números válidos (0 ou maior).');
  }
});

test('fechar: "0" explícito é classificação (não NULL); sobra 0 vende tudo', () => {
  const c = calcularFechamento({ ...base, sobraTotal: '0', aproveitavel: '0', perda: '0' });
  assert.equal(c.erro, '');
  assert.equal(c.quantidadeVendida, 120);
  assert.equal(c.aproveitavelNum, 0);
  assert.equal(c.perdaNum, 0);
});
