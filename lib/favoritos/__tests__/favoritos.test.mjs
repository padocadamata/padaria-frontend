// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/favoritos/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { telasNavegaveis } from '../../nav/navegacao.js';
import { chaveFavoritoValida, favoritosVisiveis, podeFavoritar, telaDaRota } from '../favoritos.js';
import { PERMISSOES } from '../../auth/permissoes.js';

const telas = telasNavegaveis();
const perms = (...codigos) => new Set(codigos);

test('catálogo: chaves únicas, no formato aceito pelo banco, e cada rota existe em pages/', () => {
  const chaves = telas.map((t) => t.chave);
  assert.equal(new Set(chaves).size, chaves.length);
  for (const t of telas) {
    assert.ok(chaveFavoritoValida(t.chave), t.chave);
    const base = join('pages', t.rota);
    assert.ok(existsSync(`${base}.js`) || existsSync(join(base, 'index.js')), `rota sem página: ${t.rota}`);
  }
});

test('catálogo: Dashboard e Meu perfil não são favoritáveis; abas e módulos sem abas são', () => {
  const chaves = new Set(telas.map((t) => t.chave));
  assert.ok(!chaves.has('dashboard') && !chaves.has('perfil'));
  for (const c of ['producao.hoje', 'pedidos.resumo', 'funcionarios.escala', 'financeiro.contas-pagar', 'agenda', 'fornecedores', 'catalogo', 'usuarios']) {
    assert.ok(chaves.has(c), c);
  }
});

test('telaDaRota: só correspondência exata (detalhes e páginas técnicas ficam sem estrela)', () => {
  assert.equal(telaDaRota('/pedidos/resumo', telas).chave, 'pedidos.resumo');
  assert.equal(telaDaRota('/producao', telas).chave, 'producao.hoje');
  assert.equal(telaDaRota('/agenda?x=1', telas).chave, 'agenda');
  assert.equal(telaDaRota('/catalogo/[id]', telas), null);
  assert.equal(telaDaRota('/funcionarios/novo', telas), null);
  assert.equal(telaDaRota('/', telas), null);
  assert.equal(telaDaRota('/dashboard', telas), null);
  assert.equal(telaDaRota(undefined, telas), null);
});

test('chave: formato estável, nunca URL livre', () => {
  assert.ok(chaveFavoritoValida('pedidos.resumo'));
  assert.ok(chaveFavoritoValida('financeiro.contas-pagar'));
  for (const ruim of ['https://x.com', '/pedidos', 'Pedidos.Resumo', 'a.b.c', '', 'x'.repeat(61), null]) {
    assert.ok(!chaveFavoritoValida(ruim), String(ruim));
  }
});

test('favoritos visíveis: respeitam permissão atual, ignoram chave desconhecida e repetida, mantêm a ordem', () => {
  const p = perms(PERMISSOES.DASHBOARD_VISUALIZAR, PERMISSOES.AGENDA_VISUALIZAR, PERMISSOES.PEDIDOS_SOLICITACOES_VISUALIZAR);
  const r = favoritosVisiveis(['agenda', 'tela_que_sumiu', 'pedidos.pedidos', 'pedidos.solicitacoes', 'agenda'], p, telas);
  // pedidos.pedidos exige pedidos.visualizar (perdeu acesso -> não aparece).
  assert.deepEqual(r.map((t) => t.chave), ['agenda', 'pedidos.solicitacoes']);
  assert.deepEqual(favoritosVisiveis(null, p, telas), []);
});

test('podeFavoritar: precisa abrir a tela E ver o Dashboard (mesma regra da policy)', () => {
  const agenda = telas.find((t) => t.chave === 'agenda');
  assert.equal(podeFavoritar(agenda, perms(PERMISSOES.AGENDA_VISUALIZAR, PERMISSOES.DASHBOARD_VISUALIZAR)), true);
  assert.equal(podeFavoritar(agenda, perms(PERMISSOES.AGENDA_VISUALIZAR)), false);
  assert.equal(podeFavoritar(agenda, perms(PERMISSOES.DASHBOARD_VISUALIZAR)), false);
  assert.equal(podeFavoritar(null, perms(PERMISSOES.DASHBOARD_VISUALIZAR)), false);
});
