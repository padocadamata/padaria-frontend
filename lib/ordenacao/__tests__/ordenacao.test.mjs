// node --test --import ./lib/funcionarios/__tests__/resolverImports.mjs lib/ordenacao/__tests__/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { compararTexto, criarComparador, ordenarLinhas, rotulosDirecao } from '../comparadores.js';
import { ordenarOpcoes } from '../opcoes.js';
import { aplicarOrdenacao, definicaoOrdenacao, proximaOrdenacao } from '../tabela.js';
import { paginarLista } from '../../paginacao/paginarLista.js';
import { nomeExibicaoFornecedor } from '../../fornecedores/nomeExibicao.js';

const nomes = (lista) => lista.map((x) => x.nome);

test('texto pt-BR: acento e caixa não separam; ordem alfabética real', () => {
  const lista = ['pão de queijo', 'Ovo', 'Café', 'abacaxi', 'Éclair', 'cafe', 'Bolo'];
  assert.deepEqual([...lista].sort(compararTexto), ['abacaxi', 'Bolo', 'Café', 'cafe', 'Éclair', 'Ovo', 'pão de queijo']);
});

test('texto: trim antes de comparar (espaço inicial não joga o item para o topo)', () => {
  assert.deepEqual(['Pão', '  Bolo', 'Amanteigado '].sort(compararTexto), ['Amanteigado ', '  Bolo', 'Pão']);
});

test('texto: números dentro do nome em ordem natural', () => {
  assert.deepEqual(['Pão 10', 'Pão 2', 'Pão 1'].sort(compararTexto), ['Pão 1', 'Pão 2', 'Pão 10']);
});

test('texto: vazio/nulo sempre por último', () => {
  assert.deepEqual(['b', '', null, 'a', '   ', undefined].sort(compararTexto).slice(0, 2), ['a', 'b']);
});

test('ordenarLinhas: número asc/desc com vazios no fim nos dois sentidos', () => {
  const linhas = [{ v: 10 }, { v: null }, { v: 2 }, { v: '7' }, { v: '' }, { v: 2.5 }];
  assert.deepEqual(ordenarLinhas(linhas, { valor: (l) => l.v, tipo: 'numero' }).map((l) => l.v), [2, 2.5, '7', 10, null, '']);
  assert.deepEqual(ordenarLinhas(linhas, { valor: (l) => l.v, tipo: 'numero', direcao: 'desc' }).map((l) => l.v), [10, '7', 2.5, 2, null, '']);
});

test('ordenarLinhas: moeda = número (centavos corretos)', () => {
  const r = ordenarLinhas([{ v: 10.5 }, { v: 10.05 }, { v: 9.99 }], { valor: (l) => l.v, tipo: 'moeda' });
  assert.deepEqual(r.map((l) => l.v), [9.99, 10.05, 10.5]);
});

test('ordenarLinhas: datas (YYYY-MM-DD e timestamptz) antiga → recente e o inverso', () => {
  const linhas = [{ d: '2026-10-02' }, { d: '2025-12-31' }, { d: null }, { d: '2026-01-15T10:00:00+00:00' }];
  assert.deepEqual(ordenarLinhas(linhas, { valor: (l) => l.d, tipo: 'data' }).map((l) => l.d), ['2025-12-31', '2026-01-15T10:00:00+00:00', '2026-10-02', null]);
  assert.deepEqual(ordenarLinhas(linhas, { valor: (l) => l.d, tipo: 'data', direcao: 'desc' }).map((l) => l.d), ['2026-10-02', '2026-01-15T10:00:00+00:00', '2025-12-31', null]);
});

test('ordenarLinhas: booleano (verdadeiro primeiro no crescente)', () => {
  const r = ordenarLinhas([{ a: false }, { a: true }, { a: false }], { valor: (l) => l.a, tipo: 'booleano' });
  assert.deepEqual(r.map((l) => l.a), [true, false, false]);
});

test('ordenarLinhas: ordem semântica declarada; desconhecidos depois; vazios no fim', () => {
  const ordem = ['aguardando_entrega', 'recebido', 'cancelado'];
  const linhas = ['cancelado', 'recebido', null, 'xpto', 'aguardando_entrega'].map((s) => ({ s }));
  assert.deepEqual(ordenarLinhas(linhas, { valor: (l) => l.s, ordem }).map((l) => l.s), ['aguardando_entrega', 'recebido', 'cancelado', 'xpto', null]);
  assert.deepEqual(ordenarLinhas(linhas, { valor: (l) => l.s, ordem, direcao: 'desc' }).map((l) => l.s), ['xpto', 'cancelado', 'recebido', 'aguardando_entrega', null]);
});

test('ordenarLinhas: estável (empates mantêm a ordem padrão recebida) e não altera a entrada', () => {
  const linhas = [{ n: 'B', id: 1 }, { n: 'a', id: 2 }, { n: 'b', id: 3 }, { n: 'A', id: 4 }];
  const copia = JSON.parse(JSON.stringify(linhas));
  assert.deepEqual(ordenarLinhas(linhas, { valor: (l) => l.n }).map((l) => l.id), [2, 4, 1, 3]);
  assert.deepEqual(ordenarLinhas(linhas, { valor: (l) => l.n, direcao: 'desc' }).map((l) => l.id), [1, 3, 2, 4]);
  assert.deepEqual(linhas, copia);
});

test('criarComparador: tipo desconhecido falha alto', () => {
  assert.throws(() => criarComparador({ tipo: 'cor' }));
});

test('rotulosDirecao por tipo', () => {
  assert.deepEqual(rotulosDirecao('texto'), { asc: 'A → Z', desc: 'Z → A' });
  assert.deepEqual(rotulosDirecao('moeda'), { asc: 'menor → maior', desc: 'maior → menor' });
  assert.deepEqual(rotulosDirecao('data'), { asc: 'antiga → recente', desc: 'recente → antiga' });
});

test('proximaOrdenacao: coluna nova começa crescente; mesma coluna alterna (sem 3º estado)', () => {
  let o = proximaOrdenacao(null, 'nome');
  assert.deepEqual(o, { chave: 'nome', direcao: 'asc' });
  o = proximaOrdenacao(o, 'nome');
  assert.deepEqual(o, { chave: 'nome', direcao: 'desc' });
  o = proximaOrdenacao(o, 'nome');
  assert.deepEqual(o, { chave: 'nome', direcao: 'asc' });
  assert.deepEqual(proximaOrdenacao(o, 'data'), { chave: 'data', direcao: 'asc' });
});

test('aplicarOrdenacao: sem ordenação devolve a ordem padrão; coluna não ordenável/consulta não reordena', () => {
  const colunas = [
    { chave: 'nome', ordenavel: true },
    { chave: 'acoes' },
    { chave: 'data', ordenavel: { campoConsulta: 'data' } },
  ];
  const linhas = [{ nome: 'b' }, { nome: 'a' }];
  assert.equal(aplicarOrdenacao(linhas, colunas, null), linhas);
  assert.equal(aplicarOrdenacao(linhas, colunas, { chave: 'acoes', direcao: 'asc' }), linhas);
  assert.equal(aplicarOrdenacao(linhas, colunas, { chave: 'data', direcao: 'asc' }), linhas);
  assert.deepEqual(nomes(aplicarOrdenacao(linhas, colunas, { chave: 'nome', direcao: 'asc' })), ['a', 'b']);
  assert.equal(definicaoOrdenacao(colunas[1]), null);
});

test('ordenar ANTES de paginar: a página 1 traz os menores de TODO o conjunto', () => {
  const linhas = Array.from({ length: 45 }, (_, i) => ({ nome: `Item ${45 - i}` }));
  const colunas = [{ chave: 'nome', ordenavel: true }];
  const p1 = paginarLista(aplicarOrdenacao(linhas, colunas, { chave: 'nome', direcao: 'asc' }), 1);
  assert.equal(p1.itens[0].nome, 'Item 1');
  assert.equal(p1.itens[19].nome, 'Item 20');
  const p3desc = paginarLista(aplicarOrdenacao(linhas, colunas, { chave: 'nome', direcao: 'desc' }), 3);
  assert.deepEqual(nomes(p3desc.itens), ['Item 5', 'Item 4', 'Item 3', 'Item 2', 'Item 1']);
});

test('ordenarOpcoes: nominais em pt-BR, sem alterar a entrada; strings e objetos', () => {
  const entrada = [{ id: 1, nome: 'Trigo' }, { id: 2, nome: ' açúcar' }, { id: 3, nome: 'Ovos' }, { id: 4, nome: 'Água' }];
  assert.deepEqual(nomes(ordenarOpcoes(entrada)), [' açúcar', 'Água', 'Ovos', 'Trigo']);
  assert.equal(entrada[0].nome, 'Trigo');
  assert.deepEqual(ordenarOpcoes(['Salgado', 'doce', 'Bebida']), ['Bebida', 'doce', 'Salgado']);
  assert.deepEqual(ordenarOpcoes(null), []);
});

test('ordenarOpcoes: rótulo customizado (fornecedor pelo nome EXIBIDO, não pelo nome_fantasia)', () => {
  const fornecedores = [
    { id: 1, nome_fantasia: 'Moinho Sul' },
    { id: 2, nome_fantasia: null, razao_social: 'Atacado Bom Preço LTDA' },
    { id: 3, nome_fantasia: 'Laticínios Serra' },
  ];
  assert.deepEqual(ordenarOpcoes(fornecedores, nomeExibicaoFornecedor).map((f) => f.id), [2, 3, 1]);
});

test('opções especiais e listas semânticas NÃO passam pelo helper: a ordem declarada continua', () => {
  // "Todos"/"Selecione" ficam escritos antes, no JSX; listas funcionais
  // (status, dias, turnos) são declaradas em ordem semântica e não são
  // ordenadas. Este teste documenta que o helper só deve ser usado em
  // listas nominais: aplicá-lo a dias da semana destruiria a ordem.
  const dias = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  assert.notDeepEqual(ordenarOpcoes(dias), dias);
});

test('nomeExibicaoFornecedor: fantasia > razão social > nome > alternativo', () => {
  assert.equal(nomeExibicaoFornecedor({ nome_fantasia: 'F', razao_social: 'R', nome: 'N' }), 'F');
  assert.equal(nomeExibicaoFornecedor({ nome_fantasia: '', razao_social: 'R', nome: 'N' }), 'R');
  assert.equal(nomeExibicaoFornecedor({ nome: 'N' }), 'N');
  assert.equal(nomeExibicaoFornecedor({ id: 'x' }, 'x'), 'x');
  assert.equal(nomeExibicaoFornecedor(null, '—'), '—');
});

test('vazios por último em ASC e DESC também para texto, data, booleano e ordem semântica', () => {
  const casos = [
    { tipo: 'texto', valores: ['b', null, 'A', '  ', 'c', undefined] },
    { tipo: 'data', valores: ['2026-01-02', null, '2025-12-31', ''] },
    { tipo: 'booleano', valores: [false, null, true, undefined] },
    { tipo: 'texto', ordem: ['pendente', 'realizada'], valores: ['realizada', null, 'pendente', ''] },
  ];
  for (const { tipo, ordem, valores } of casos) {
    for (const direcao of ['asc', 'desc']) {
      const r = ordenarLinhas(valores.map((v) => ({ v })), { valor: (l) => l.v, tipo, ordem, direcao }).map((l) => l.v);
      const primeiroVazio = r.findIndex((v) => v == null || (typeof v === 'string' && v.trim() === ''));
      assert.ok(primeiroVazio > 0, `${tipo}/${direcao}: há preenchidos antes dos vazios`);
      assert.ok(r.slice(primeiroVazio).every((v) => v == null || (typeof v === 'string' && v.trim() === '')), `${tipo}/${direcao}: ${JSON.stringify(r)}`);
    }
  }
});

test('texto DESC é o inverso exato do ASC entre os preenchidos (pt-BR, acento, caixa, trim)', () => {
  const nomes = ['Éclair', ' bolo', 'Açúcar', 'pão 10', 'Pão 2', 'café'];
  const asc = ordenarLinhas(nomes.map((n) => ({ n })), { valor: (l) => l.n }).map((l) => l.n);
  const desc = ordenarLinhas(nomes.map((n) => ({ n })), { valor: (l) => l.n, direcao: 'desc' }).map((l) => l.n);
  assert.deepEqual(asc, ['Açúcar', ' bolo', 'café', 'Éclair', 'Pão 2', 'pão 10']);
  assert.deepEqual(desc, [...asc].reverse());
});
