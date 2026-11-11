// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/nav/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSOES, MODULOS, moduloVisivel } from '../../auth/permissoes.js';
import { navegacaoDoUsuario, destinosMobile, subitensDoModulo } from '../navegacao.js';

const folha = (perms) => navegacaoDoUsuario(new Set(perms)).principais.find((m) => m.chave === 'funcionarios');

test('só escala.visualizar: Folha aparece e entra direto na Escala', () => {
  const m = folha([PERMISSOES.ESCALA_VISUALIZAR]);
  assert.ok(m);
  assert.equal(m.href, '/funcionarios/escala');
  assert.deepEqual(m.subitens.map((s) => s.chave), ['escala']);
});

test('mobile (Mais/bottom nav) usa a mesma entrada', () => {
  const { diretos, maisModulos } = destinosMobile(new Set([PERMISSOES.ESCALA_VISUALIZAR, PERMISSOES.PRODUCAO_VISUALIZAR]));
  const m = [...diretos, ...maisModulos].find((x) => x.chave === 'funcionarios');
  assert.equal(m.href, '/funcionarios/escala');
});

test('com funcionarios.visualizar: entrada continua /funcionarios (comportamento antigo)', () => {
  assert.equal(folha([PERMISSOES.FUNCIONARIOS_VISUALIZAR, PERMISSOES.ESCALA_VISUALIZAR]).href, '/funcionarios');
});

test('sem nenhuma permissão da Folha: módulo não aparece', () => {
  assert.equal(folha([PERMISSOES.PRODUCAO_VISUALIZAR]), undefined);
});

test('a entrada é sempre uma aba que o usuário pode abrir (nunca concede rota nova)', () => {
  const codigos = Object.values(PERMISSOES);
  for (const codigo of codigos) {
    const perms = new Set([codigo]);
    for (const m of navegacaoDoUsuario(perms).principais) {
      const subs = subitensDoModulo(m.chave, perms);
      if (subs.length && !m.rotaInicial) {
        const permitida = subs.some((s) => s.rota === m.href) || !subs.length;
        const baseNaoEhAba = !subs.some((s) => s.rota === m.rota) && m.href === m.rota;
        assert.ok(permitida || baseNaoEhAba, `${codigo} -> ${m.chave} entra em ${m.href}`);
      }
      assert.ok(moduloVisivel(perms, MODULOS[m.chave]));
    }
  }
});

test('escala.visualizar não libera nenhum outro módulo', () => {
  const chaves = navegacaoDoUsuario(new Set([PERMISSOES.ESCALA_VISUALIZAR])).principais.map((m) => m.chave);
  assert.deepEqual(chaves, ['funcionarios']);
});
