// Pagos (paginação) e A Pagar (layout responsivo) -- Folha > Pagamentos.
// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/funcionarios/__tests__/pagamentosTelas.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paginarLista, TAMANHO_PAGINA_PADRAO } from '../../paginacao/paginarLista.js';
import { aplicarOrdenacao } from '../../ordenacao/tabela.js';

// 45 pagamentos na ordem da consulta (data efetiva mais recente primeiro).
const pagamentos = Array.from({ length: 45 }, (_, i) => ({
  id: `p${String(i + 1).padStart(2, '0')}`,
  data_efetiva: `2026-${String(10 - Math.floor(i / 28)).padStart(2, '0')}-${String(28 - (i % 28)).padStart(2, '0')}`,
  status: i % 5 === 0 ? 'cancelado' : 'confirmado',
  valor_liquido: 100 + i,
}));

test('F) Pagos usa o mesmo tamanho de página dos outros módulos (20)', () => {
  assert.equal(TAMANHO_PAGINA_PADRAO, 20);
  const fonte = readFileSync(new URL('../../../components/funcionarios/PagamentosPagosVisao.js', import.meta.url), 'utf8');
  assert.match(fonte, /import Paginacao, \{ paginarLista \} from '\.\.\/Paginacao'/);
  assert.match(fonte, /paginarLista\(ordenacao\.ordenar\(pagamentos, colunas\), pagina\)/, 'ordena o filtro inteiro e só depois fatia');
  assert.match(fonte, /linhas=\{paginacao\.itens\}/);
});

test('F) primeira, próxima e última página; sem duplicidade nem perda', () => {
  const p1 = paginarLista(pagamentos, 1);
  const p2 = paginarLista(pagamentos, 2);
  const p3 = paginarLista(pagamentos, 3);
  assert.deepEqual([p1.totalPaginas, p1.itens.length, p2.itens.length, p3.itens.length], [3, 20, 20, 5]);
  assert.deepEqual([p1.primeiro, p1.ultimo, p3.primeiro, p3.ultimo], [1, 20, 41, 45]);
  const ids = [...p1.itens, ...p2.itens, ...p3.itens].map((p) => p.id);
  assert.equal(new Set(ids).size, 45);
  assert.deepEqual(ids, pagamentos.map((p) => p.id), 'mantém a ordem atual');
  // Fora do intervalo: nunca página vazia.
  assert.equal(paginarLista(pagamentos, 0).paginaAtual, 1);
  assert.equal(paginarLista(pagamentos, 99).paginaAtual, 3);
});

test('F) filtro reduz o resultado: a página cai para a última válida', () => {
  const confirmados = pagamentos.filter((p) => p.status === 'confirmado');
  assert.equal(confirmados.length, 36);
  const r = paginarLista(confirmados, 3);
  assert.deepEqual([r.paginaAtual, r.totalPaginas, r.itens.length], [2, 2, 16]);
  const vazio = paginarLista([], 2);
  assert.deepEqual([vazio.paginaAtual, vazio.total, vazio.primeiro, vazio.ultimo], [1, 0, 0, 0]);
});

test('F) ordenação pelo cabeçalho vale para o conjunto inteiro (não só a página)', () => {
  const colunas = [{ chave: 'liquido', ordenavel: { tipo: 'moeda', valor: (p) => p.valor_liquido } }];
  const ordenados = aplicarOrdenacao(pagamentos, colunas, { chave: 'liquido', direcao: 'desc' });
  const p1 = paginarLista(ordenados, 1);
  assert.equal(p1.itens[0].valor_liquido, 144, 'maior líquido de todos na página 1');
  assert.equal(paginarLista(ordenados, 3).itens.at(-1).valor_liquido, 100);
});

test('G) A Pagar: um só DOM responsivo -- cartão por pessoa, quebra em 900px, sem tabela larga', () => {
  const css = readFileSync(new URL('../../../components/funcionarios/pagamentos.module.css', import.meta.url), 'utf8');
  const visao = readFileSync(new URL('../../../components/funcionarios/PagamentosAPagarVisao.js', import.meta.url), 'utf8');
  const limite = Number(visao.match(/PAGAMENTOS_CARTOES_ATE = (\d+)/)[1]);
  assert.equal(limite, 900);
  assert.ok(css.includes(`@media (max-width: ${limite}px)`), 'media query no mesmo limite do Pagos');
  assert.ok(!/min-width:\s*860px/.test(css), 'sem a tabela de 860px que forçava rolagem lateral');
  assert.ok(!visao.includes('<table'), 'A Pagar não usa mais tabela');
  assert.ok(!visao.includes('useMediaQuery'), 'sem troca de árvore por largura (nada remonta ao girar o tablet)');
  assert.ok(!visao.includes('LancamentosPendentesPainel'), 'sem o painel geral no topo');
  // Desktop: rótulos compactos escondidos; celular: cabeçalho de colunas some.
  assert.match(css, /\.rotuloCompacto,\s*\.selecionarTudoCompacto \{\s*display: none;/);
  const mobile = css.slice(css.indexOf(`@media (max-width: ${limite}px) {\n  .pessoaCabecalho`.replace(/\n/g, css.includes('\r\n') ? '\r\n' : '\n')));
  assert.match(mobile, /\.jornadasCabecalho \{\s*display: none;/);
  assert.match(mobile, /\.rotuloCompacto \{\s*display: inline;/);
});

test('semântica dos valores: cabeçalho = total pendente (bruto); resumo = líquido; mensal = previsão', () => {
  const visao = readFileSync(new URL('../../../components/funcionarios/PagamentosAPagarVisao.js', import.meta.url), 'utf8');
  assert.match(visao, />Total pendente</, 'cabeçalho do cartão não se chama mais "A pagar"');
  assert.ok(!/rotuloTotalCabecalho\}>A pagar</.test(visao));
  assert.match(visao, /rotuloLiquido = 'Líquido a pagar'/, 'por hora: líquido final');
  assert.match(visao, /rotuloLiquido="Líquido previsto"/, 'mensal: base só é escolhida no modal');
  // Mensal: o botão do cartão não mostra valor (o líquido final fica no botão do modal)
  // e a prévia nunca trava a abertura do modal por líquido negativo.
  const mensal = visao.slice(visao.indexOf('function BlocoMensal'), visao.indexOf('function LancamentosForaDaLista'));
  assert.ok(!/Incluir pagamento · /.test(mensal));
  assert.match(mensal, /const podeIncluir = temBase && \(Number\(resumo\?\.saldo_base\) > 0 \|\| extrasDisponiveis\.length > 0\) && faltamValores === 0;/);
  // Pessoas ativas: só elas têm lançamentos selecionáveis.
  assert.match(visao, /pendentesDaPessoa\(pendentesPorPessoa, id, idsAtivos\)/);
});
