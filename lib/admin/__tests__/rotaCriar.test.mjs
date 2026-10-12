// Testa pages/api/admin/usuarios/criar.js com os clientes Supabase
// simulados (sem rede, sem chave real).
//
//   node --experimental-test-module-mocks \
//     --import ./lib/funcionarios/__tests__/resolverImports.mjs \
//     --test lib/admin/__tests__/rotaCriar.test.mjs
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SENHA = 'senha-secreta-123';
const estado = {};

function reiniciar() {
  Object.assign(estado, {
    configurado: true,
    user: { id: 'admin-1' },
    ehAdmin: true,
    erroAdmin: null,
    perfilAtivo: true,
    criarErro: null,
    vincularErro: null,
    chamadas: { createUser: [], deleteUser: [], rpcSessao: [], adminCriado: 0 },
  });
}
reiniciar();

const sessao = {
  auth: { getUser: async () => ({ data: { user: estado.user } }) },
  rpc: async (nome, args) => {
    estado.chamadas.rpcSessao.push({ nome, args });
    if (nome === 'is_admin') return { data: estado.ehAdmin, error: estado.erroAdmin };
    if (nome === 'admin_vincular_usuario_auth') {
      return estado.vincularErro
        ? { data: null, error: estado.vincularErro }
        : { data: { id: args.p_usuario_id, nome: args.p_nome, perfil: args.p_perfil }, error: null };
    }
    throw new Error(`rpc inesperada ${nome}`);
  },
  from: (tabela) => {
    assert.equal(tabela, 'perfis');
    const filtros = {};
    const q = {
      select: () => q,
      eq: (c, v) => { filtros[c] = v; return q; },
      maybeSingle: async () => ({ data: estado.perfilAtivo && filtros.ativo === true ? { nome: filtros.nome } : null }),
    };
    return q;
  },
};

// O cliente service_role simulado só tem auth.admin: qualquer tentativa de
// usá-lo para tabela/RPC quebra o teste.
const admin = {
  auth: {
    admin: {
      createUser: async (args) => {
        estado.chamadas.createUser.push(args);
        return estado.criarErro ? { data: null, error: estado.criarErro } : { data: { user: { id: 'novo-uuid' } }, error: null };
      },
      deleteUser: async (id) => {
        estado.chamadas.deleteUser.push(id);
        return { error: null };
      },
    },
  },
};

mock.module(new URL('../../supabase/serverProps.js', import.meta.url).href, {
  namedExports: { createServerPropsClient: () => sessao },
});
mock.module(new URL('../../supabase/admin.js', import.meta.url).href, {
  namedExports: {
    servidorAdminConfigurado: () => estado.configurado,
    createAdminClient: () => { estado.chamadas.adminCriado += 1; return admin; },
  },
});

const { default: handler } = await import('../../../pages/api/admin/usuarios/criar.js');

function req({ method = 'POST', body, headers = {} } = {}) {
  return {
    method,
    body,
    cookies: {},
    headers: { host: 'padoca.test', origin: 'https://padoca.test', 'content-type': 'application/json', ...headers },
  };
}

function res() {
  const r = { statusCode: 0, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

const CORPO = { nome: 'Nova', email: 'Nova@Padoca.test', perfil: 'operacional', senha: SENHA };

async function chamar(opcoes) {
  const r = res();
  await handler(req(opcoes), r);
  assert.equal(JSON.stringify(r.body).includes(SENHA), false, 'senha vazou na resposta');
  assert.equal(r.headers['Cache-Control'], 'no-store');
  return r;
}

beforeEach(reiniciar);

test('só POST', async () => {
  const r = await chamar({ method: 'GET' });
  assert.equal(r.statusCode, 405);
});

test('recusa outra origem e corpo que não é JSON (CSRF) antes de qualquer coisa', async () => {
  assert.equal((await chamar({ body: CORPO, headers: { origin: 'https://malicioso.test' } })).statusCode, 403);
  assert.equal((await chamar({ body: CORPO, headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode, 403);
  assert.equal(estado.chamadas.rpcSessao.length, 0);
  assert.equal(estado.chamadas.adminCriado, 0);
});

test('sem SUPABASE_SERVICE_ROLE_KEY -> 503, nada criado', async () => {
  estado.configurado = false;
  const r = await chamar({ body: CORPO });
  assert.equal(r.statusCode, 503);
  assert.equal(r.body.codigo, 'nao_configurado');
  assert.equal(estado.chamadas.adminCriado, 0);
});

test('sem sessão -> 401', async () => {
  estado.user = null;
  const r = await chamar({ body: CORPO });
  assert.equal(r.statusCode, 401);
  assert.equal(estado.chamadas.adminCriado, 0);
});

test('sessão não-admin (ou erro ao checar) -> 403 e o cliente service_role nem é criado', async () => {
  for (const [ehAdmin, erroAdmin] of [[false, null], [null, { message: 'x' }], ['true', null]]) {
    reiniciar();
    estado.ehAdmin = ehAdmin;
    estado.erroAdmin = erroAdmin;
    const r = await chamar({ body: CORPO });
    assert.equal(r.statusCode, 403);
    assert.equal(estado.chamadas.adminCriado, 0);
    assert.equal(estado.chamadas.createUser.length, 0);
  }
});

test('dados inválidos -> 400 com erros por campo, nada criado', async () => {
  const r = await chamar({ body: { ...CORPO, email: 'x', senha: '1' } });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(Object.keys(r.body.erros).sort(), ['email', 'senha']);
  assert.equal(estado.chamadas.adminCriado, 0);
});

test('perfil inexistente/inativo -> 400, nada criado', async () => {
  estado.perfilAtivo = false;
  const r = await chamar({ body: CORPO });
  assert.equal(r.statusCode, 400);
  assert.ok(r.body.erros.perfil);
  assert.equal(estado.chamadas.createUser.length, 0);
});

test('sucesso: login confirmado, vínculo feito pela SESSÃO do admin (não pela service_role)', async () => {
  const r = await chamar({ body: CORPO });
  assert.equal(r.statusCode, 201);
  assert.equal(r.body.usuario.id, 'novo-uuid');

  assert.equal(estado.chamadas.createUser.length, 1);
  const criado = estado.chamadas.createUser[0];
  assert.equal(criado.email, 'nova@padoca.test');
  assert.equal(criado.password, SENHA);
  assert.equal(criado.email_confirm, true);
  assert.deepEqual(criado.user_metadata, { nome: 'Nova' });
  assert.equal('app_metadata' in criado, false);

  const vinculo = estado.chamadas.rpcSessao.find((c) => c.nome === 'admin_vincular_usuario_auth');
  assert.deepEqual(vinculo.args, { p_usuario_id: 'novo-uuid', p_nome: 'Nova', p_perfil: 'operacional' });
  assert.equal(estado.chamadas.deleteUser.length, 0);
});

test('vínculo falha -> login recém-criado é excluído', async () => {
  estado.vincularErro = { code: 'PGRST202', message: 'Could not find the function' };
  const r = await chamar({ body: CORPO });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.codigo, 'vinculo_falhou_revertido');
  assert.match(r.body.mensagem, /0072 pendente/);
  assert.deepEqual(estado.chamadas.deleteUser, ['novo-uuid']);
});

test('e-mail já existe no Auth -> 409, sem vincular', async () => {
  estado.criarErro = { code: 'email_exists', message: 'already registered' };
  const r = await chamar({ body: CORPO });
  assert.equal(r.statusCode, 409);
  assert.equal(estado.chamadas.rpcSessao.some((c) => c.nome === 'admin_vincular_usuario_auth'), false);
});
