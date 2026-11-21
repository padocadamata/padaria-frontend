// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/importacoes/__tests__/*.test.mjs
// Reconhecimento de layout, resumo prévio e MASCARAMENTO de clientes (feito
// no navegador, antes de qualquer envio). Relatórios fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarLayout, mascararClientes, normalizar, resumirRelatorio, CLIENTE_MASCARADO } from '../layouts.js';
import { vendasProdutoCliente, faturamentoGeral, vendasPeriodo, cenario, CLIENTE_ANONIMO } from './relatoriosFicticios.mjs';

const VENDAS = [
  { numero: 10, dataHora: '2026-06-03 08:10', itens: [{ produto: 'PAO', codigo: 1, qtd: 1, valor: 9.5 }] },
  { numero: 11, dataHora: '2026-06-03 09:00', itens: [{ produto: 'BOLO', codigo: 3, qtd: 1, valor: 25 }] },
];
const PERIODO = { inicio: '2026-06-01', fim: '2026-06-30', gerado: '2026-07-01 09:00' };
const c = cenario(VENDAS);

test('normalizar: igual ao servidor (sem acento, maiúsculas, espaços, º/ª)', () => {
  assert.equal(normalizar('  Relatório  de Faturamento '), 'RELATORIO DE FATURAMENTO');
  assert.equal(normalizar('Nº Pedido'), 'NO PEDIDO');
  assert.equal(normalizar('Líq. s/ Taxa (R$)'), 'LIQ. S/ TAXA (R$)');
  assert.equal(normalizar(null), '');
});

test('detecta os 3 layouts pelo título; outros relatórios não são reconhecidos', () => {
  assert.equal(detectarLayout(vendasProdutoCliente({ ...PERIODO, itens: c.itens })), 'vendas_produto_cliente');
  assert.equal(detectarLayout(faturamentoGeral({ ...PERIODO, vendas: c.fat })), 'faturamento_geral');
  assert.equal(detectarLayout(vendasPeriodo({ ...PERIODO, dias: c.dias })), 'vendas_periodo');
  assert.equal(detectarLayout([[], ['RELATÓRIO DE VENDAS POR HORA']]), null);
  assert.equal(detectarLayout([]), null);
});

test('mascaramento Vendas_ProdCliente: grupo de cliente identificado vira marcador; anônimo e CNPJ da empresa ficam', () => {
  const linhas = vendasProdutoCliente({ ...PERIODO, itens: c.itens });
  const comCliente = [...linhas.slice(0, 10), ['Cliente: MARIA DA SILVA - CPF/CNPJ: 123.456.789-09'], ...linhas.slice(11)];
  const antes = JSON.stringify(comCliente);
  const r = mascararClientes('vendas_produto_cliente', comCliente);
  assert.equal(JSON.stringify(comCliente), antes, 'não altera a entrada');
  assert.deepEqual(r.linhas[10], [`Cliente: ${CLIENTE_MASCARADO}`]);
  assert.equal(r.mascarados, 1);
  assert.deepEqual(r.linhas[2], ['65214016000142'], 'CNPJ da empresa no cabeçalho permanece');
  assert.ok(!JSON.stringify(r.linhas).includes('MARIA'));
  assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(JSON.stringify(r.linhas)));

  const anonimo = mascararClientes('vendas_produto_cliente', linhas);
  assert.equal(anonimo.mascarados, 0);
  assert.ok(anonimo.linhas.some((l) => l[0] === CLIENTE_ANONIMO));
});

test('mascaramento FaturamGeral: coluna Cliente com nome vira marcador; consumidor anônimo fica', () => {
  const fat = faturamentoGeral({ ...PERIODO, vendas: c.fat });
  const comNome = fat.map((l) => (l[0] === 10 ? [l[0], 'JOÃO PEREIRA', ...l.slice(2)] : l));
  const r = mascararClientes('faturamento_geral', comNome);
  const venda10 = r.linhas.find((l) => l[0] === 10);
  const venda11 = r.linhas.find((l) => l[0] === 11);
  assert.equal(venda10[1], CLIENTE_MASCARADO);
  assert.equal(venda11[1], 'Consumidor Não Identificado');
  assert.equal(r.mascarados, 1);
  assert.ok(!JSON.stringify(r.linhas).includes('JOÃO'));
});

test('rede de segurança: CPF/CNPJ formatados ou soltos em qualquer célula são omitidos', () => {
  const linhas = [['X', '111.444.777-35', '12345678909', 12345678909, '11.222.333/0001-81', '11222333000181', 'cpf 1', 'PÃO 12345']];
  const r = mascararClientes('vendas_periodo', linhas);
  assert.deepEqual(r.linhas[0], ['X', '[documento omitido]', '[documento omitido]', '[documento omitido]', '[documento omitido]',
    '[documento omitido]', '[documento omitido]', 'PÃO 12345']);
  assert.equal(r.mascarados, 6);
});

test('resumo prévio: período, geração e aviso de filtro proibido (relatório filtrado por seção)', () => {
  const filtrado = vendasProdutoCliente({ ...PERIODO, itens: c.itens, filtrosExtras: [['Seção/Categoria', 'SALGADO']] });
  const r = resumirRelatorio('vendas_produto_cliente', filtrado);
  assert.equal(r.periodo, '01/06/2026 a 30/06/2026');
  assert.equal(r.geradoEm, '01/07/2026 09:00');
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /Seção\/Categoria/);
  assert.equal(resumirRelatorio('faturamento_geral', faturamentoGeral({ ...PERIODO, vendas: c.fat })).avisos.length, 0);
});
