// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/importacoes/__tests__/*.test.mjs
// Interface da Central de Importações G3 (migration 0081): menu só para o
// perfil proprietario_admin ATIVO (por perfil, nunca por permissão), rota
// protegida no middleware e todas as páginas atrás de RequireAuth +
// SomenteAdmin. Conferência estrutural (sem renderizar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PERMISSOES } from '../../auth/permissoes.js';
import { navegacaoDoUsuario, destinosMobile, telasNavegaveis } from '../../nav/navegacao.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ler = (p) => readFileSync(join(RAIZ, p), 'utf8');
const TODAS = new Set(Object.values(PERMISSOES));
const temItem = (nav) => nav.admin.some((i) => i.chave === 'importacoes');

test('menu: só proprietario_admin ativo vê "Importações G3"; nem todas as permissões liberam', () => {
  assert.equal(temItem(navegacaoDoUsuario(TODAS, { perfil: 'proprietario_admin', ativo: true })), true);
  assert.equal(temItem(navegacaoDoUsuario(TODAS, { perfil: 'proprietario_admin', ativo: false })), false, 'admin inativo');
  for (const perfil of ['gestao', 'financeiro_administrativo', 'operacional']) {
    assert.equal(temItem(navegacaoDoUsuario(TODAS, { perfil, ativo: true })), false, perfil);
  }
  assert.equal(temItem(navegacaoDoUsuario(TODAS)), false, 'sem perfil: comportamento antigo');
  const { maisAdmin } = destinosMobile(new Set([PERMISSOES.DASHBOARD_VISUALIZAR]), { perfil: 'proprietario_admin', ativo: true });
  assert.ok(maisAdmin.some((i) => i.chave === 'importacoes' && i.href === '/importacoes'), 'aparece no "Mais" do celular');
});

test('sem perfil informado, a navegação é idêntica à anterior (nada muda para os demais)', () => {
  for (const codigo of Object.values(PERMISSOES)) {
    const p = new Set([codigo]);
    assert.deepEqual(navegacaoDoUsuario(p), navegacaoDoUsuario(p, { perfil: 'gestao', ativo: true }));
  }
});

test('Importações G3 não entra nos Favoritos (que decidem por permissão)', () => {
  assert.ok(!telasNavegaveis().some((t) => t.rota.startsWith('/importacoes')));
});

test('middleware protege /importacoes e o shell passa o perfil para a navegação', () => {
  assert.match(ler('middleware.js'), /'\/importacoes'/);
  const shell = ler('components/shell/PageShell.js');
  assert.match(shell, /navegacaoDoUsuario\(permissoes, perfilUsuario\)/);
  assert.match(shell, /destinosMobile\(permissoes, perfilUsuario\)/);
});

test('todas as páginas /importacoes ficam atrás de RequireAuth + SomenteAdmin', () => {
  for (const p of ['pages/importacoes/index.js', 'pages/importacoes/nova.js', 'pages/importacoes/[id].js']) {
    const src = ler(p);
    assert.match(src, /<RequireAuth>\s*<SomenteAdmin>/, p);
  }
  assert.match(ler('components/importacoes/SomenteAdmin.js'), /isAdmin\(perfilUsuario\)/);
});

test('a leitura do arquivo e o SheetJS são carregados só sob demanda (fora do bundle das outras telas)', () => {
  const nova = ler('pages/importacoes/nova.js');
  assert.match(nova, /await import\('\.\.\/\.\.\/lib\/importacoes\/leitorXlsx'\)/);
  assert.doesNotMatch(nova, /^import .*leitorXlsx/m);
  assert.match(ler('lib/importacoes/leitorXlsx.js'), /await import\('xlsx'\)/);
});
