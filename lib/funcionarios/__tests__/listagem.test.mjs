// Folha de Pagamento > Funcionários (listagem): só APRESENTAÇÃO da tabela
// -- geometria estável (layoutFixo) e o comportamento existente intacto.
// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/funcionarios/__tests__/listagem.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../../../pages/funcionarios.js', import.meta.url), 'utf8');
// Definição da coluna: do `chave: '...'` até a próxima coluna (ou o fim da lista).
const coluna = (chave) => {
  const inicio = fonte.indexOf(`chave: '${chave}'`);
  if (inicio < 0) return '';
  const resto = fonte.slice(inicio + 1);
  const fim = Math.min(...[resto.indexOf("chave: '"), resto.indexOf('];')].filter((i) => i >= 0));
  return fonte.slice(inicio, inicio + 1 + fim);
};

test('listagem: tabela padrão (DataTable) com layout fixo e larguras definidas', () => {
  assert.match(fonte, /<DataTable[\s\S]*?layoutFixo[\s\S]*?\/>/);
  assert.match(fonte, /larguraAcoes="112px"/);
  assert.match(fonte, /cartoesAte=\{1100\}/, 'cartões antes da tabela ficar espremida');
  for (const chave of ['vinculo', 'status', 'cargo', 'chave_pix']) assert.match(coluna(chave), /largura: '\d+(px|%)'/, chave);
  // O Nome fica com o restante da largura (sem largura fixa).
  const nome = fonte.slice(fonte.indexOf("chave: 'nome'"), fonte.indexOf("chave: 'vinculo'"));
  assert.doesNotMatch(nome, /largura:/);
});

test('listagem: busca, filtros persistidos, ordenação, ações e permissões preservados', () => {
  assert.match(fonte, /useFiltrosPersistidos\('funcionarios', FILTROS_FUNCIONARIOS\)/);
  assert.match(fonte, /funcionarioPassaFiltro\(f, \{ termo: busca, status: filtroStatus, vinculo: filtroVinculo \}\)/);
  assert.match(fonte, /useOrdenacao\(\{ aoMudar: \(\) => setPagina\(1\), persistirEm: 'funcionarios' \}\)/);
  for (const chave of ['nome', 'vinculo', 'status', 'cargo']) assert.match(coluna(chave), /ordenavel/, chave);
  assert.doesNotMatch(coluna('chave_pix'), /ordenavel/);
  assert.match(fonte, /\{podeEditar \? 'Editar' : 'Ver'\}/);
  assert.match(fonte, /router\.push\(`\/funcionarios\/\$\{f\.id\}`\)/);
  assert.match(fonte, /RequireAuth permissao=\{PERMISSOES\.FUNCIONARIOS_VISUALIZAR\}/);
  assert.match(fonte, /destaque=\{\(f\) => \(f\.ativo \? null : 'inativo'\)\}/);
  // Chave PIX inteira (quebra dentro da coluna, sem cortar).
  assert.match(coluna('chave_pix'), /render: \(f\) => f\.chave_pix \|\| '—'/);
});
