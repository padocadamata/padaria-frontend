// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/filtros/__tests__/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREFIXO_FILTROS,
  aplicarDefinicao,
  camposParaSanear,
  criarPersistenciaFiltros,
  dataIso,
  extrairSessaoId,
  namespaceFiltros,
  ordenacaoValida,
  sanearValores,
  umDe,
} from '../persistenciaFiltros.js';

// localStorage falso (mesma interface usada pelo módulo).
class StorageFalso {
  constructor() {
    this.dados = new Map();
  }
  get length() {
    return this.dados.size;
  }
  key(i) {
    return Array.from(this.dados.keys())[i] ?? null;
  }
  getItem(k) {
    return this.dados.has(k) ? this.dados.get(k) : null;
  }
  setItem(k, v) {
    this.dados.set(k, String(v));
  }
  removeItem(k) {
    this.dados.delete(k);
  }
}

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const DEF = {
  versao: 1,
  padrao: { busca: '', status: 'ativos', secaoId: 'todas' },
  validadores: { status: umDe(['ativos', 'inativos', 'todos']) },
};

function novo(storage = new StorageFalso()) {
  return { storage, p: criarPersistenciaFiltros({ obterStorage: () => storage }) };
}

function gravarComo(p, tela, valores, def = DEF) {
  const ns = p.obterNamespace();
  assert.equal(p.gravarTela(ns, tela, def.versao, valores), true);
}

// Token NO FORMATO do Supabase, montado aqui com claims fictícias -- nenhum
// token real é usado nem registrado.
function tokenFicticio(claims) {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.assinatura-ficticia`;
}

test('session_id: lido do payload do token; formatos inesperados viram null', () => {
  assert.equal(extrairSessaoId(tokenFicticio({ sub: U1, session_id: S1 })), S1);
  // payload com UTF-8 (user_metadata com acento) continua legível
  assert.equal(extrairSessaoId(tokenFicticio({ sub: U1, session_id: S1, user_metadata: { nome: 'Padoca São João' } })), S1);
  assert.equal(extrairSessaoId(tokenFicticio({ sub: U1 })), null); // sem a claim
  assert.equal(extrairSessaoId(tokenFicticio({ sub: U1, session_id: 'nao-e-uuid' })), null);
  assert.equal(extrairSessaoId(tokenFicticio({ sub: U1, session_id: 123 })), null);
  assert.equal(extrairSessaoId('a.b'), null);
  assert.equal(extrairSessaoId('a.%%%.c'), null);
  assert.equal(extrairSessaoId(null), null);
  assert.equal(extrairSessaoId(undefined), null);
});

test('namespace: usuário E sessão; sem um dos dois não há persistência', () => {
  assert.equal(namespaceFiltros(U1, S1), `${PREFIXO_FILTROS}:${U1}:${S1}:`);
  assert.notEqual(namespaceFiltros(U1, S1), namespaceFiltros(U2, S1));
  assert.notEqual(namespaceFiltros(U1, S1), namespaceFiltros(U1, S2));
  assert.equal(namespaceFiltros(U1, null), null);
  assert.equal(namespaceFiltros(null, S1), null);
});

test('chave por usuário: B nunca lê o estado de A', () => {
  const { p } = novo();
  p.definirSessao(U1, S1);
  gravarComo(p, 'catalogo', { busca: 'pão', status: 'inativos', secaoId: 'x' });
  p.definirSessao(U2, S2);
  const { valores } = p.lerTela(p.obterNamespace(), 'catalogo', DEF);
  assert.deepEqual(valores, DEF.padrao);
});

test('chave por sessão: mesmo usuário em sessão nova começa limpo e o resíduo antigo é apagado', () => {
  const { p, storage } = novo();
  p.definirSessao(U1, S1);
  gravarComo(p, 'catalogo', { busca: 'pão', status: 'inativos', secaoId: 'x' });
  p.definirSessao(U1, S2);
  assert.deepEqual(p.lerTela(p.obterNamespace(), 'catalogo', DEF).valores, DEF.padrao);
  assert.equal([...storage.dados.keys()].some((k) => k.includes(S1)), false);
});

test('mesma sessão após refresh (nova instância, mesmo storage): estado restaurado', () => {
  const storage = new StorageFalso();
  const antes = novo(storage).p;
  antes.definirSessao(U1, S1);
  gravarComo(antes, 'catalogo', { busca: 'pão', status: 'todos', secaoId: 'sec-1' });

  const depois = novo(storage).p; // F5 / reabrir o navegador
  depois.definirSessao(U1, S1);
  const lido = depois.lerTela(depois.obterNamespace(), 'catalogo', DEF);
  assert.deepEqual(lido.valores, { busca: 'pão', status: 'todos', secaoId: 'sec-1' });
  assert.equal(lido.precisaGravar, false);
});

test('mesma sessão (TOKEN_REFRESHED / SIGNED_IN repetido): definirSessao é no-op e não notifica', () => {
  const { p } = novo();
  p.definirSessao(U1, S1);
  gravarComo(p, 'catalogo', { busca: 'x', status: 'ativos', secaoId: 'todas' });
  let notificacoes = 0;
  p.assinar(() => notificacoes++);
  p.definirSessao(U1, S1);
  p.definirSessao(U1, S1);
  assert.equal(notificacoes, 0);
  assert.equal(p.lerTela(p.obterNamespace(), 'catalogo', DEF).valores.busca, 'x');
});

test('defaults: sem namespace, sem registro ou registro corrompido', () => {
  const { p, storage } = novo();
  assert.deepEqual(p.lerTela(null, 'catalogo', DEF), { valores: DEF.padrao, precisaGravar: false });
  p.definirSessao(U1, S1);
  const ns = p.obterNamespace();
  assert.deepEqual(p.lerTela(ns, 'catalogo', DEF), { valores: DEF.padrao, precisaGravar: true });
  storage.setItem(`${ns}catalogo`, '{json quebrado');
  assert.deepEqual(p.lerTela(ns, 'catalogo', DEF).valores, DEF.padrao);
  storage.setItem(`${ns}catalogo`, JSON.stringify({ v: 1, valores: ['lista'] }));
  assert.deepEqual(p.lerTela(ns, 'catalogo', DEF).valores, DEF.padrao);
});

test('merge: campo ausente no salvo vem do padrão; o resto é preservado', () => {
  const { p, storage } = novo();
  p.definirSessao(U1, S1);
  const ns = p.obterNamespace();
  storage.setItem(`${ns}catalogo`, JSON.stringify({ v: 1, valores: { busca: 'bolo' } }));
  const lido = p.lerTela(ns, 'catalogo', DEF);
  assert.deepEqual(lido.valores, { busca: 'bolo', status: 'ativos', secaoId: 'todas' });
  assert.equal(lido.precisaGravar, true);
});

test('versão: outra versão da tela é descartada SEM tocar as demais telas', () => {
  const { p } = novo();
  p.definirSessao(U1, S1);
  const ns = p.obterNamespace();
  gravarComo(p, 'catalogo', { busca: 'pão', status: 'todos', secaoId: 'todas' });
  gravarComo(p, 'pedidos', { busca: 'mantido', status: 'ativos', secaoId: 'todas' });
  const v2 = { ...DEF, versao: 2 };
  assert.deepEqual(p.lerTela(ns, 'catalogo', v2).valores, DEF.padrao);
  assert.equal(p.lerTela(ns, 'pedidos', DEF).valores.busca, 'mantido');
});

test('tipo inválido volta ao padrão só naquele campo; campo desconhecido é descartado', () => {
  const salvo = { busca: 42, status: 'excluidos', secaoId: 'sec-9', modalAberto: true, pagina: 7 };
  assert.deepEqual(sanearValores(salvo, DEF.padrao, DEF.validadores), { busca: '', status: 'ativos', secaoId: 'sec-9' });
  assert.deepEqual(sanearValores(null, DEF.padrao), DEF.padrao);
  assert.deepEqual(sanearValores({ n: NaN }, { n: 1 }), { n: 1 });
  // padrão objeto/null exige validador explícito
  assert.deepEqual(sanearValores({ o: { a: 1 } }, { o: null }), { o: null });
});

test('storage indisponível (getter lança): cai para memória durante a navegação', () => {
  const p = criarPersistenciaFiltros({
    obterStorage: () => {
      throw new Error('SecurityError');
    },
  });
  p.definirSessao(U1, S1);
  const ns = p.obterNamespace();
  assert.equal(p.gravarTela(ns, 'catalogo', 1, { busca: 'pão', status: 'todos', secaoId: 'todas' }), true);
  assert.equal(p.lerTela(ns, 'catalogo', DEF).valores.busca, 'pão');
  p.encerrarSessao();
  p.definirSessao(U1, S1);
  assert.equal(p.lerTela(p.obterNamespace(), 'catalogo', DEF).valores.busca, '');
});

test('storage que falha ao gravar (cota cheia) e ao ler: nada lança', () => {
  const quebrado = {
    length: 0,
    key: () => null,
    getItem: () => {
      throw new Error('falha');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('falha');
    },
  };
  const p = criarPersistenciaFiltros({ obterStorage: () => quebrado });
  p.definirSessao(U1, S1);
  const ns = p.obterNamespace();
  assert.doesNotThrow(() => p.gravarTela(ns, 'catalogo', 1, { busca: 'a', status: 'ativos', secaoId: 'todas' }));
  assert.equal(p.lerTela(ns, 'catalogo', DEF).valores.busca, 'a');
  assert.doesNotThrow(() => p.encerrarSessao());
  // sem window (SSR): instância padrão não quebra
  const semNada = criarPersistenciaFiltros({ obterStorage: () => null });
  semNada.definirSessao(U1, S1);
  assert.deepEqual(semNada.lerTela(semNada.obterNamespace(), 'catalogo', DEF).valores, DEF.padrao);
});

test('limpeza (logout/SIGNED_OUT): só as chaves de filtros; favoritos/dashboard/sidebar intactos', () => {
  const { p, storage } = novo();
  storage.setItem('padoca.favoritos', '["/catalogo"]');
  storage.setItem('dashboard.preferencias', '{"x":1}');
  storage.setItem('sidebar.recolhida', 'true');
  storage.setItem('sb-projeto-auth-token', 'nao-tocar');
  p.definirSessao(U1, S1);
  gravarComo(p, 'catalogo', { busca: 'a', status: 'ativos', secaoId: 'todas' });
  gravarComo(p, 'pedidos', { busca: 'b', status: 'ativos', secaoId: 'todas' });
  storage.setItem(`${PREFIXO_FILTROS}:${U2}:${S2}:escala`, '{}'); // resíduo de outra sessão
  p.encerrarSessao();
  assert.equal(p.obterNamespace(), null);
  assert.deepEqual([...storage.dados.keys()].sort(), ['dashboard.preferencias', 'padoca.favoritos', 'sb-projeto-auth-token', 'sidebar.recolhida']);
});

test('sessão nova remove resíduos de outras sessões/usuários e preserva a atual', () => {
  const { p, storage } = novo();
  storage.setItem(`${PREFIXO_FILTROS}:${U2}:${S2}:catalogo`, '{}');
  storage.setItem('padoca.favoritos', '[]');
  p.definirSessao(U1, S1);
  gravarComo(p, 'catalogo', { busca: 'a', status: 'ativos', secaoId: 'todas' });
  assert.deepEqual([...storage.dados.keys()].sort(), [`${PREFIXO_FILTROS}:${U1}:${S1}:catalogo`, 'padoca.favoritos'].sort());
});

test('sem session_id no token: nenhuma persistência e nada antigo sobra', () => {
  const { p, storage } = novo();
  p.definirSessao(U1, S1);
  gravarComo(p, 'catalogo', { busca: 'a', status: 'ativos', secaoId: 'todas' });
  p.definirSessao(U1, null);
  assert.equal(p.obterNamespace(), null);
  assert.equal(storage.length, 0);
  assert.equal(p.gravarTela(null, 'catalogo', 1, {}), false);
});

test('multiaba/tela antiga: gravação com namespace que não é o atual é ignorada', () => {
  const { p } = novo();
  p.definirSessao(U1, S1);
  const nsAntigo = p.obterNamespace();
  p.definirSessao(U2, S2); // outra pessoa entrou (outra aba)
  assert.equal(p.gravarTela(nsAntigo, 'catalogo', 1, { busca: 'de A', status: 'ativos', secaoId: 'todas' }), false);
  assert.deepEqual(p.lerTela(p.obterNamespace(), 'catalogo', DEF).valores, DEF.padrao);
});

test('multiaba mesma sessão: cada tela tem sua chave; ler sempre traz o estado atual do storage', () => {
  const storage = new StorageFalso();
  const abaA = novo(storage).p;
  const abaB = novo(storage).p;
  abaA.definirSessao(U1, S1);
  abaB.definirSessao(U1, S1);
  abaA.gravarTela(abaA.obterNamespace(), 'catalogo', 1, { busca: 'A', status: 'ativos', secaoId: 'todas' });
  abaB.gravarTela(abaB.obterNamespace(), 'pedidos', 1, { busca: 'B', status: 'ativos', secaoId: 'todas' });
  assert.equal(abaB.lerTela(abaB.obterNamespace(), 'catalogo', DEF).valores.busca, 'A');
  assert.equal(abaA.lerTela(abaA.obterNamespace(), 'pedidos', DEF).valores.busca, 'B');
});

test('normalizar: ajuste estrutural depois da validação por campo', () => {
  const { p } = novo();
  p.definirSessao(U1, S1);
  const def = {
    versao: 1,
    padrao: { a: 1, b: 2 },
    normalizar: (v, padrao) => (v.a > v.b ? { ...v, a: padrao.a, b: padrao.b } : v),
  };
  p.gravarTela(p.obterNamespace(), 't', 1, { a: 9, b: 3 });
  assert.deepEqual(p.lerTela(p.obterNamespace(), 't', def), { valores: { a: 1, b: 2 }, precisaGravar: true });
});

test('saneamento: opções ainda carregando NÃO apagam o valor salvo', () => {
  const regras = { secaoId: { pronto: false, valido: () => false } };
  assert.equal(camposParaSanear({ secaoId: 'sec-1' }, regras, { secaoId: 'todas' }), null);
});

test('saneamento: valor removido volta ao padrão depois do carregamento -- só ele', () => {
  const padrao = { secaoId: 'todas', categoriaId: 'todas', busca: '' };
  const existentes = new Set(['cat-1']);
  const regras = {
    secaoId: { pronto: true, valido: () => false },
    categoriaId: { pronto: true, valido: (id) => existentes.has(id) },
  };
  assert.deepEqual(camposParaSanear({ secaoId: 'sec-x', categoriaId: 'cat-1', busca: 'pão' }, regras, padrao), { secaoId: 'todas' });
  // valor já no padrão nunca é validado (não há o que sanear)
  assert.equal(camposParaSanear({ secaoId: 'todas', categoriaId: 'cat-1', busca: '' }, regras, padrao), null);
});

test('saneamento sequencial: campo seguinte é validado contra o anterior já saneado', () => {
  const padrao = { cargoId: '', funcionarioId: '' };
  const funcionarios = [{ id: 'f1', cargo_id: 'c1' }];
  const regras = {
    cargoId: { pronto: true, valido: (id) => id === 'c1' },
    funcionarioId: { pronto: true, valido: (id, v) => funcionarios.some((f) => f.id === id && (!v.cargoId || f.cargo_id === v.cargoId)) },
  };
  // cargo removido -> volta a '' e a funcionária (compatível com "todos") fica
  assert.deepEqual(camposParaSanear({ cargoId: 'c-removido', funcionarioId: 'f1' }, regras, padrao), { cargoId: '' });
});

test('aplicarDefinicao: campo, função, parcial; ignora campo fora do schema; sem mudança devolve o mesmo objeto', () => {
  const padrao = { a: 1, ordenacao: null };
  const v = { a: 1, ordenacao: null };
  assert.equal(aplicarDefinicao(v, padrao, 'a', 1), v);
  assert.deepEqual(aplicarDefinicao(v, padrao, 'a', 5), { a: 5, ordenacao: null });
  assert.deepEqual(aplicarDefinicao(v, padrao, 'a', (x) => x + 1), { a: 2, ordenacao: null });
  assert.deepEqual(aplicarDefinicao(v, padrao, { a: 3, modal: true }), { a: 3, ordenacao: null });
  assert.equal(aplicarDefinicao(v, padrao, { pagina: 4 }), v);
});

test('validadores: dataIso e ordenacaoValida', () => {
  assert.equal(dataIso('2026-10-23'), true);
  assert.equal(dataIso('2026-02-30'), false);
  assert.equal(dataIso('23/10/2026'), false);
  assert.equal(ordenacaoValida(null), true);
  assert.equal(ordenacaoValida({ chave: 'nome', direcao: 'desc' }), true);
  assert.equal(ordenacaoValida({ chave: 'nome', direcao: 'cima' }), false);
  assert.equal(ordenacaoValida({ chave: '', direcao: 'asc' }), false);
  assert.equal(ordenacaoValida(['nome', 'asc']), false);
  assert.equal(ordenacaoValida('nome'), false);
});
