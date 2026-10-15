// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/pedidos/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PLACEHOLDERS, TEMPLATE_PADRAO, formatarQuantidade, gerarMensagemPedido, linhasDeItens, placeholdersDesconhecidos, validarTemplate,
} from '../mensagemPedido.js';

const PEDIDO = {
  data_pedido: '2026-10-15',
  previsao_entrega: '2026-10-18',
  modalidade_compra: 'pedido_com_entrega',
  observacoes: 'Entregar pela manhã',
  status: 'recebido',
};
const ITENS = [
  // descricao = snapshot gravado no pedido (pode diferir do nome atual do catálogo)
  { descricao: 'FARINHA DE TRIGO T1 (25KG)', produto_id: 'p1', quantidade_pedida: 10, unidade: 'SC', quantidade_recebida: 8 },
  { descricao: 'Fermento biológico', produto_id: null, quantidade_pedida: 2.5, unidade: 'kg' },
  { descricao: 'Ovos', produto_id: 'p3', quantidade_pedida: '0.125', unidade: '' },
];
const dados = (extra = {}) => ({ pedido: { ...PEDIDO, ...extra }, itens: ITENS, fornecedorNome: 'Moinho Sul' });

test('modelo padrão gera a mensagem completa com os dados reais do pedido', () => {
  const { texto, desconhecidos } = gerarMensagemPedido(TEMPLATE_PADRAO, dados());
  assert.deepEqual(desconhecidos, []);
  assert.equal(
    texto,
    [
      'Olá, Moinho Sul!',
      '',
      'Gostaria de fazer o seguinte pedido:',
      '',
      '- FARINHA DE TRIGO T1 (25KG): 10 SC',
      '- Fermento biológico: 2,5 kg',
      '- Ovos: 0,125',
      '',
      'Previsão de entrega: 18/10/2026',
      'Observações: Entregar pela manhã',
      '',
      'Obrigado!',
    ].join('\n')
  );
});

test('itens: nome efetivo do pedido (descricao), quantidade PEDIDA e unidade do item -- nunca a recebida', () => {
  const linhas = linhasDeItens(ITENS);
  assert.equal(linhas[0], '- FARINHA DE TRIGO T1 (25KG): 10 SC');
  assert.ok(!linhas[0].includes('8'), 'não usa quantidade_recebida');
  assert.deepEqual(linhasDeItens([]), []);
});

test('quantidade em pt-BR sem zeros à direita', () => {
  assert.equal(formatarQuantidade(10), '10');
  assert.equal(formatarQuantidade('2.500'), '2,5');
  assert.equal(formatarQuantidade(1234.5), '1.234,5');
  assert.equal(formatarQuantidade('abc'), 'abc');
});

test('dado opcional ausente remove a linha inteira (sem rótulo vazio); retirada não tem previsão', () => {
  const { texto } = gerarMensagemPedido(TEMPLATE_PADRAO, dados({ observacoes: '   ', modalidade_compra: 'compra_presencial' }));
  assert.ok(!texto.includes('Observações'));
  assert.ok(!texto.includes('Previsão de entrega'));
  assert.ok(!/\n{3,}/.test(texto), 'sem sequência de linhas em branco');
  assert.ok(texto.endsWith('Obrigado!'));
});

test('linha com texto fixo e campo vazio misturado com campo preenchido é mantida', () => {
  const t = 'Pedido de {{data_pedido}} ({{observacoes}})';
  assert.equal(gerarMensagemPedido(t, dados({ observacoes: null })).texto, 'Pedido de 15/10/2026 ()');
});

test('placeholder desconhecido fica no texto e é informado; nunca some calado', () => {
  const { texto, desconhecidos } = gerarMensagemPedido('Pedido {{numero_pedido}} de {{fornecedor}}\n{{itens}}', dados());
  assert.ok(texto.startsWith('Pedido {{numero_pedido}} de Moinho Sul'));
  assert.deepEqual(desconhecidos, ['numero_pedido']);
  assert.deepEqual(placeholdersDesconhecidos('{{ itens }} {{x}} {{x}} {{modalidade}}'), ['x']);
});

test('modalidade e espaços dentro das chaves', () => {
  assert.equal(gerarMensagemPedido('{{ modalidade }}', dados()).texto, 'Entrega');
  assert.equal(gerarMensagemPedido('{{modalidade}}', dados({ modalidade_compra: 'compra_presencial' })).texto, 'Retirada');
});

test('validação do editor: vazio, tamanho, desconhecido e {{itens}} obrigatório', () => {
  assert.equal(validarTemplate(TEMPLATE_PADRAO), '');
  assert.match(validarTemplate('   '), /vazio/);
  assert.match(validarTemplate('x'.repeat(4001)), /4000/);
  assert.match(validarTemplate('{{itens}} {{preco}}'), /\{\{preco\}\}/);
  assert.match(validarTemplate('Olá {{fornecedor}}'), /\{\{itens\}\}/);
  assert.equal(PLACEHOLDERS.length, 6);
});

test('modelo padrão do frontend é o mesmo inserido pela migration 0075', () => {
  const sql = readFileSync('supabase/migrations/0075_preferencias_usuario_mensagem_pedido.sql', 'utf8');
  const literal = sql.match(/insert into public\.pedidos_mensagem_config \(id, template\)\s*values \(\s*true,\s*E'([^']*)'/);
  assert.ok(literal, 'literal do modelo não encontrado na migration');
  assert.equal(literal[1].replace(/\\n/g, '\n'), TEMPLATE_PADRAO);
});
