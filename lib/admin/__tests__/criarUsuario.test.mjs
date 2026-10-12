// node --test lib/admin/__tests__/criarUsuario.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITES,
  criarUsuarioCompleto,
  mensagemErroVinculo,
  normalizarEmail,
  validarNovoUsuario,
  validarVinculo,
} from '../criarUsuario.js';

const VALIDO = { nome: '  Viviane  ', email: '  Fulana@Exemplo.COM ', perfil: 'operacional', senha: 'senha-forte-1' };

test('validarNovoUsuario normaliza nome e e-mail e preserva a senha', () => {
  const r = validarNovoUsuario(VALIDO);
  assert.equal(r.ok, true);
  assert.deepEqual(r.dados, { nome: 'Viviane', email: 'fulana@exemplo.com', perfil: 'operacional', senha: 'senha-forte-1' });
});

test('validarNovoUsuario aponta cada campo inválido', () => {
  const r = validarNovoUsuario({ nome: ' ', email: 'sem-arroba', perfil: '', senha: '123' });
  assert.equal(r.ok, false);
  assert.equal(r.dados, null);
  assert.deepEqual(Object.keys(r.erros).sort(), ['email', 'nome', 'perfil', 'senha']);
});

test('validarNovoUsuario: limites de senha e nome', () => {
  assert.equal(validarNovoUsuario({ ...VALIDO, senha: 'a'.repeat(LIMITES.senhaMin - 1) }).erros.senha !== undefined, true);
  assert.equal(validarNovoUsuario({ ...VALIDO, senha: 'a'.repeat(LIMITES.senhaMin) }).ok, true);
  assert.equal(validarNovoUsuario({ ...VALIDO, senha: 'a'.repeat(LIMITES.senhaMax + 1) }).ok, false);
  assert.equal(validarNovoUsuario({ ...VALIDO, senha: ' '.repeat(10) }).ok, false);
  assert.equal(validarNovoUsuario({ ...VALIDO, nome: 'x'.repeat(LIMITES.nomeMax + 1) }).ok, false);
  assert.equal(validarNovoUsuario({ ...VALIDO, senha: 12345678 }).ok, false);
});

test('validarNovoUsuario rejeita perfil com formato estranho (injeção/maiúsculas)', () => {
  assert.equal(validarNovoUsuario({ ...VALIDO, perfil: "operacional'; drop" }).ok, false);
  assert.equal(validarNovoUsuario({ ...VALIDO, perfil: 'Operacional' }).ok, false);
});

test('validarNovoUsuario sem argumento não lança', () => {
  assert.equal(validarNovoUsuario().ok, false);
  assert.equal(validarVinculo().ok, false);
});

test('validarVinculo não exige e-mail nem senha', () => {
  const r = validarVinculo({ nome: 'Ana', perfil: 'gestao' });
  assert.deepEqual(r, { ok: true, erros: {}, dados: { nome: 'Ana', perfil: 'gestao' } });
});

test('normalizarEmail', () => {
  assert.equal(normalizarEmail(' A@B.Com '), 'a@b.com');
  assert.equal(normalizarEmail(null), '');
});

function deps({ criar, vincular, excluir } = {}) {
  const chamadas = { criar: [], vincular: [], excluir: [] };
  return {
    chamadas,
    criarLoginAuth: async (a) => { chamadas.criar.push(a); return criar ? criar(a) : { id: 'uuid-novo' }; },
    vincular: async (a) => { chamadas.vincular.push(a); return vincular ? vincular(a) : { data: { id: a.usuarioId }, error: null }; },
    excluirLoginAuth: async (id) => { chamadas.excluir.push(id); return excluir ? excluir(id) : { error: null }; },
  };
}

const DADOS = validarNovoUsuario(VALIDO).dados;

test('sucesso: cria login, vincula com o id do Auth, não compensa', async () => {
  const d = deps();
  const r = await criarUsuarioCompleto({ dados: DADOS, ...d });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.usuario.id, 'uuid-novo');
  assert.deepEqual(d.chamadas.vincular, [{ usuarioId: 'uuid-novo', nome: 'Viviane', perfil: 'operacional' }]);
  assert.deepEqual(d.chamadas.excluir, []);
});

test('e-mail já existente no Auth -> 409, sem vincular nem excluir', async () => {
  for (const erro of [{ code: 'email_exists' }, { message: 'A user with this email address has already been registered' }]) {
    const d = deps({ criar: () => ({ error: erro }) });
    const r = await criarUsuarioCompleto({ dados: DADOS, ...d });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.codigo, 'email_ja_existe');
    assert.equal(d.chamadas.vincular.length, 0);
    assert.equal(d.chamadas.excluir.length, 0);
  }
});

test('Auth lança exceção genérica -> 502 e nada mais acontece', async () => {
  const d = deps({ criar: () => { throw new Error('rede'); } });
  const r = await criarUsuarioCompleto({ dados: DADOS, ...d });
  assert.equal(r.status, 502);
  assert.equal(d.chamadas.vincular.length, 0);
});

test('Auth recusa a senha -> 400 senha_recusada', async () => {
  const d = deps({ criar: () => ({ error: { code: 'weak_password', message: 'Password is too weak' } }) });
  const r = await criarUsuarioCompleto({ dados: DADOS, ...d });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.codigo, 'senha_recusada');
});

test('Auth sem id -> 502, sem vincular', async () => {
  const d = deps({ criar: () => ({}) });
  const r = await criarUsuarioCompleto({ dados: DADOS, ...d });
  assert.equal(r.status, 502);
  assert.equal(d.chamadas.vincular.length, 0);
});

test('vínculo falha -> exclui o login criado (compensação) e informa que nada ficou', async () => {
  const d = deps({ vincular: () => ({ data: null, error: { message: 'admin_vincular_usuario_auth: e-mail x ja usado por outro usuario do sistema.' } }) });
  const r = await criarUsuarioCompleto({ dados: DADOS, ...d });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.codigo, 'vinculo_falhou_revertido');
  assert.match(r.corpo.mensagem, /já pertence a outro usuário/);
  assert.deepEqual(d.chamadas.excluir, ['uuid-novo']);
});

test('vínculo lança exceção -> também compensa', async () => {
  const d = deps({ vincular: () => { throw new Error('timeout'); } });
  const r = await criarUsuarioCompleto({ dados: DADOS, ...d });
  assert.equal(r.corpo.codigo, 'vinculo_falhou_revertido');
  assert.deepEqual(d.chamadas.excluir, ['uuid-novo']);
});

test('vínculo e compensação falham -> 500 vinculo_pendente com id para recuperar', async () => {
  for (const excluir of [() => ({ error: { message: 'x' } }), () => { throw new Error('y'); }]) {
    const d = deps({ vincular: () => ({ error: { code: '42501' } }), excluir });
    const r = await criarUsuarioCompleto({ dados: DADOS, ...d });
    assert.equal(r.status, 500);
    assert.equal(r.corpo.codigo, 'vinculo_pendente');
    assert.equal(r.corpo.usuario_id, 'uuid-novo');
    assert.equal(r.corpo.email, 'fulana@exemplo.com');
  }
});

test('a senha nunca aparece em nenhuma resposta', async () => {
  const cenarios = [
    deps(),
    deps({ criar: () => ({ error: { code: 'email_exists' } }) }),
    deps({ vincular: () => ({ error: { message: 'boom' } }) }),
    deps({ vincular: () => ({ error: { message: 'boom' } }), excluir: () => ({ error: {} }) }),
  ];
  for (const d of cenarios) {
    const r = await criarUsuarioCompleto({ dados: DADOS, ...d });
    assert.equal(JSON.stringify(r).includes(DADOS.senha), false);
  }
});

test('mensagemErroVinculo: migration ausente, sem permissão, perfil, genérico', () => {
  assert.match(mensagemErroVinculo({ code: 'PGRST202' }), /0072 pendente/);
  assert.match(mensagemErroVinculo({ code: '42501' }), /administrador/);
  assert.match(mensagemErroVinculo({ message: 'perfil "x" nao existe ou nao esta ativo.' }), /Perfil/);
  assert.match(mensagemErroVinculo({ message: 'login 1 ja esta vinculado em usuarios.' }), /já está vinculado/);
  assert.equal(mensagemErroVinculo(null), 'Não foi possível vincular o usuário.');
});
