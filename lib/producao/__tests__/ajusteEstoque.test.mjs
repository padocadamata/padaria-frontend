// node --test lib/producao/__tests__/ajusteEstoque.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularAjusteEstoque, formatarComSinal } from '../ajusteEstoque.js';
import { PERMISSOES } from '../../auth/permissoes.js';
import { codigosDoGrupo, MODULOS_MATRIZ, ACAO_LABEL } from '../../auth/matrizPermissoes.js';

test('ajuste = físico − saldo; quem digita nunca escolhe o sinal', () => {
  assert.deepEqual(calcularAjusteEstoque(18, '0', 25), { fisico: 0, ajuste: -18, novoSaldo: 0, ajusteKg: -450, novoSaldoKg: 0, valido: true, erro: '' });
  const mais = calcularAjusteEstoque(3, ' 7 ', 25);
  assert.equal(mais.ajuste, 4);
  assert.equal(mais.valido, true);
});

test('vazio não acusa erro; igual ao saldo, negativo, decimal e texto são inválidos', () => {
  assert.deepEqual(calcularAjusteEstoque(3, '', 25), { valido: false, erro: '' });
  assert.match(calcularAjusteEstoque(3, '3', 25).erro, /nenhum ajuste necessário/);
  assert.equal(calcularAjusteEstoque(3, '3', 25).ajuste, 0);
  for (const v of ['-1', '1.5', '1,5', 'abc', '1e2']) {
    const r = calcularAjusteEstoque(3, v, 25);
    assert.equal(r.valido, false, v);
    assert.equal(r.fisico, undefined, v);
  }
});

test('sinal explícito', () => {
  assert.equal(formatarComSinal(4), '+4');
  assert.equal(formatarComSinal(-18), '−18');
  assert.equal(formatarComSinal(0), '0');
});

test('producao_sacos.ajustar está na matriz de Sacos Fechados, no grupo Produção, com rótulo', () => {
  assert.equal(PERMISSOES.PRODUCAO_SACOS_AJUSTAR, 'producao_sacos.ajustar');
  const sacos = MODULOS_MATRIZ.find((m) => m.chave === 'producao_sacos');
  assert.ok(sacos.itens.some((i) => i.codigo === 'producao_sacos.ajustar' && i.acao === 'ajustar'));
  assert.ok(codigosDoGrupo('producao').includes('producao_sacos.ajustar'));
  assert.equal(ACAO_LABEL.ajustar, 'Ajustar estoque');
});
