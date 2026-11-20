// Testes da migration 0080 (Central de Notificações) sobre as migrations
// REAIS 0001..0075 (ambiente_pedidos.mjs), em PostgreSQL embutido (PGlite).
// RLS e grants exercidos com SET ROLE authenticated/anon. Também roda os SQLs
// PRE/POS da raiz (quando presentes) e confere que o EXECUTAR é byte-idêntico
// à migration. Nada aqui toca o Supabase real.
//
//   npm i --no-save @electric-sql/pglite
//   node --test supabase/tests/0080_central_notificacoes.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADMIN, FINANCEIRO, GESTAO, OPERACIONAL, FORNECEDOR_A, RAIZ,
  como, fabricaDeBancos, fecharBancos, valor, aplicarMigration,
} from './ambiente_pedidos.mjs';

const M80 = '0080_central_notificacoes.sql';
const BASE = ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql', '0075_preferencias_usuario_mensagem_pedido.sql'];
const PRE = join(RAIZ, '0080_pre_auditoria_central_notificacoes_EXECUTAR.sql');
const POS = join(RAIZ, '0080_pos_auditoria_central_notificacoes_EXECUTAR.sql');
const EXECUTAR = join(RAIZ, '0080_central_notificacoes_EXECUTAR.sql');

const TIPO = 'pedidos_solicitacoes.criada';
const VIS = 'pedidos_solicitacoes.visualizar';

// Usuários extras (além de ADMIN/FINANCEIRO/GESTAO/OPERACIONAL do ambiente).
const GESTAO_OK = '00000000-0000-0000-0000-0000000000c1'; // gestao + visualizar (override concede)
const OPER_VIS = '00000000-0000-0000-0000-0000000000c2'; // operacional + visualizar
const FIN_VIS = '00000000-0000-0000-0000-0000000000c3'; // financeiro + visualizar
const INATIVO = '00000000-0000-0000-0000-0000000000c4'; // gestao + visualizar, inativo
const ADMIN_NEGADO = '00000000-0000-0000-0000-0000000000c5'; // proprietario_admin + nega visualizar
const EXPIRADO = '00000000-0000-0000-0000-0000000000c6'; // gestao + visualizar expirado
const AUTORA = '00000000-0000-0000-0000-0000000000c7'; // operacional + inserir/visualizar (quem solicita)
const ADMIN_NEGA_EXPIRADO = '00000000-0000-0000-0000-0000000000c8'; // admin + nega EXPIRADO (volta a ver)

after(fecharBancos);

const banco = fabricaDeBancos({ extras: [...BASE, M80] });
const bancoSem80 = fabricaDeBancos({ extras: BASE });

const negado = (e) => e.code === '42501' || /permission denied|row-level security/i.test(String(e.message));

async function comoAutenticado(db, uid, fn) {
  await como(db, uid);
  await db.exec('set role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

async function comoAnon(db, fn) {
  await como(db, null);
  await db.exec('set role anon');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

async function criarUsuarios(db) {
  await db.exec(`
    insert into auth.users (id, email) values
      ('${GESTAO_OK}', 'g1@padoca.test'), ('${OPER_VIS}', 'o1@padoca.test'), ('${FIN_VIS}', 'f1@padoca.test'),
      ('${INATIVO}', 'i1@padoca.test'), ('${ADMIN_NEGADO}', 'an@padoca.test'), ('${EXPIRADO}', 'ex@padoca.test'),
      ('${AUTORA}', 'autora@padoca.test'), ('${ADMIN_NEGA_EXPIRADO}', 'ane@padoca.test');
    insert into public.usuarios (id, nome, email, perfil, ativo) values
      ('${GESTAO_OK}', 'GESTORA OK', 'g1@padoca.test', 'gestao', true),
      ('${OPER_VIS}', 'OPERACIONAL VIS', 'o1@padoca.test', 'operacional', true),
      ('${FIN_VIS}', 'FINANCEIRO VIS', 'f1@padoca.test', 'financeiro_administrativo', true),
      ('${INATIVO}', 'GESTORA INATIVA', 'i1@padoca.test', 'gestao', false),
      ('${ADMIN_NEGADO}', 'ADMIN NEGADO', 'an@padoca.test', 'proprietario_admin', true),
      ('${EXPIRADO}', 'GESTORA EXPIRADA', 'ex@padoca.test', 'gestao', true),
      ('${AUTORA}', 'FUNCIONARIA AUTORA', 'autora@padoca.test', 'operacional', true),
      ('${ADMIN_NEGA_EXPIRADO}', 'ADMIN NEGA EXPIRADO', 'ane@padoca.test', 'proprietario_admin', true);
    insert into public.usuario_permissoes (usuario_id, permissao, efeito, expira_em) values
      ('${GESTAO_OK}', '${VIS}', 'concede', null),
      ('${GESTAO_OK}', 'pedidos_solicitacoes.inserir', 'concede', null),
      ('${OPER_VIS}', '${VIS}', 'concede', null),
      ('${FIN_VIS}', '${VIS}', 'concede', null),
      ('${INATIVO}', '${VIS}', 'concede', null),
      ('${ADMIN_NEGADO}', '${VIS}', 'nega', null),
      ('${EXPIRADO}', '${VIS}', 'concede', now() - interval '1 day'),
      ('${AUTORA}', 'pedidos_solicitacoes.inserir', 'concede', null),
      ('${AUTORA}', '${VIS}', 'concede', null),
      ('${ADMIN_NEGA_EXPIRADO}', '${VIS}', 'nega', now() - interval '1 hour');
  `);
}

async function novoBancoCom80() {
  const db = await banco();
  await criarUsuarios(db);
  return db;
}

async function criarSolicitacao(db, uid, { descricao = 'FARINHA', quantidade = 2.5, produtoId = null } = {}) {
  return comoAutenticado(db, uid, () =>
    valor(db, 'select (public.criar_solicitacao_pedido($1::uuid, $2, $3::numeric, current_date, null)).id', [
      produtoId, produtoId ? null : descricao, quantidade,
    ])
  );
}

const visiveis = (db, uid) => comoAutenticado(db, uid, async () => (await db.query('select * from public.notificacoes order by criado_em, id')).rows);
const contar = (db, uid) => comoAutenticado(db, uid, () => valor(db, 'select public.notificacoes_contar_nao_lidas()'));
const listar = (db, uid, args = '') => comoAutenticado(db, uid, async () => (await db.query(`select * from public.notificacoes_listar(${args})`)).rows);
const marcar = (db, uid, ids) => comoAutenticado(db, uid, () => valor(db, 'select public.notificacoes_marcar_lidas($1::uuid[])', [ids]));
const pendencia = (db, solicitacaoId) =>
  valor(db, 'select pendencia_status from public.notificacoes where entidade = $1 and registro_id = $2', ['pedidos_solicitacoes', solicitacaoId]);

// ---------------------------------------------------------------------------

test('aplica sobre 0001..0075, liga RLS e não cria/concede nenhuma permissão', async () => {
  const antes = await bancoSem80();
  const depois = await banco();
  for (const t of ['notificacoes', 'notificacoes_leituras', 'notificacoes_pendencia_historico', 'notificacoes_falhas']) {
    assert.equal(await valor(depois, 'select relrowsecurity from pg_class where oid = $1::regclass', [`public.${t}`]), true, `RLS em ${t}`);
  }
  for (const sql of [
    'select count(*)::int from public.permissoes',
    'select count(*)::int from public.perfil_permissoes',
    'select count(*)::int from public.usuario_permissoes',
    'select count(*)::int from public.usuarios',
    "select string_agg(perfil || ':' || permissao, ',' order by perfil, permissao) from public.perfil_permissoes",
  ]) {
    assert.equal(await valor(depois, sql), await valor(antes, sql), `inalterado: ${sql}`);
  }
  assert.equal(
    await valor(depois, "select count(*)::int from pg_trigger where tgrelid = 'public.pedidos_solicitacoes'::regclass and not tgisinternal"),
    (await valor(antes, "select count(*)::int from pg_trigger where tgrelid = 'public.pedidos_solicitacoes'::regclass and not tgisinternal")) + 1,
    'só 1 trigger novo em pedidos_solicitacoes'
  );
});

test('reaplicar aborta pela guarda, sem alterar nada', async () => {
  const db = await novoBancoCom80();
  await criarSolicitacao(db, AUTORA);
  await assert.rejects(aplicarMigration(db, M80), /0080 abortada: objetos desta migration ja existem/);
  await db.exec('rollback');
  assert.equal(await valor(db, 'select count(*)::int from public.notificacoes'), 1);
});

test('1/2. gestão e proprietário/admin ativos com a permissão recebem a notificação, com o conteúdo esperado', async () => {
  const db = await novoBancoCom80();
  const id = await criarSolicitacao(db, AUTORA);

  for (const uid of [GESTAO_OK, ADMIN]) {
    const linhas = await visiveis(db, uid);
    assert.equal(linhas.length, 1, `visível para ${uid}`);
    const n = linhas[0];
    assert.equal(n.tipo, TIPO);
    assert.equal(n.modulo, 'pedidos');
    assert.equal(n.entidade, 'pedidos_solicitacoes');
    assert.equal(n.registro_id, id);
    assert.equal(n.titulo, 'Nova solicitação de produto');
    assert.equal(n.descricao, 'FUNCIONARIA AUTORA solicitou 2,5 de FARINHA.');
    assert.equal(n.autor_id, AUTORA);
    assert.equal(n.autor_nome, 'FUNCIONARIA AUTORA');
    assert.equal(n.permissao_requerida, VIS);
    assert.deepEqual(n.perfis_destinatarios, ['gestao', 'proprietario_admin']);
    assert.equal(n.pendencia_status, 'aberta');
    assert.equal(n.dados.solicitacao_id, id);
    assert.equal(n.dados.solicitante_nome, 'FUNCIONARIA AUTORA');
    assert.equal(await contar(db, uid), 1);
  }

  // Produto do Catálogo: unidade entra no texto; quantidade inteira sem ",000".
  const produto = await valor(db, "insert into public.produtos (nome, unidade_medida) values ('AÇÚCAR', 'KG') returning id");
  await criarSolicitacao(db, AUTORA, { produtoId: produto, quantidade: 10 });
  const ultima = (await visiveis(db, ADMIN)).at(-1);
  assert.equal(ultima.descricao, 'FUNCIONARIA AUTORA solicitou 10 KG de AÇÚCAR.');
  assert.equal(ultima.dados.produto_id, produto);

  assert.equal(await valor(db, 'select count(*)::int from public.notificacoes_pendencia_historico'), 2, 'abertura registrada no histórico');
});

test('3/4. operacional e financeiro NÃO recebem, mesmo com permissão de visualizar; gestão sem permissão também não', async () => {
  const db = await novoBancoCom80();
  await criarSolicitacao(db, AUTORA);
  for (const uid of [OPER_VIS, FIN_VIS, OPERACIONAL, FINANCEIRO, GESTAO]) {
    assert.equal((await visiveis(db, uid)).length, 0, `não visível para ${uid}`);
    assert.equal(await contar(db, uid), 0);
    assert.equal((await listar(db, uid)).length, 0);
  }
  // Conferência: os dois primeiros veem a tela de Solicitações (permissão real).
  for (const uid of [OPER_VIS, FIN_VIS]) {
    assert.equal(await comoAutenticado(db, uid, () => valor(db, 'select count(*)::int from public.pedidos_solicitacoes')), 1);
  }
});

test('5. usuário inativo não acessa notificações (nem conta, lista ou marca)', async () => {
  const db = await novoBancoCom80();
  await criarSolicitacao(db, AUTORA);
  const nid = await valor(db, 'select id from public.notificacoes');
  assert.equal((await visiveis(db, INATIVO)).length, 0);
  assert.equal(await contar(db, INATIVO), 0);
  assert.equal((await listar(db, INATIVO)).length, 0);
  assert.equal(await marcar(db, INATIVO, [nid]), 0);
  assert.equal(await comoAutenticado(db, INATIVO, () => valor(db, 'select public.notificacoes_marcar_todas_lidas()')), 0);
  assert.equal(await valor(db, 'select count(*)::int from public.notificacoes_leituras'), 0);

  // Reativado: passa a ver (a regra é avaliada na leitura).
  await db.query('update public.usuarios set ativo = true where id = $1', [INATIVO]);
  assert.equal(await contar(db, INATIVO), 1);
});

test('6. bloqueio individual (nega) e concessão expirada são respeitados; nega expirado deixa de bloquear', async () => {
  const db = await novoBancoCom80();
  await criarSolicitacao(db, AUTORA);
  assert.equal((await visiveis(db, ADMIN_NEGADO)).length, 0, 'admin com nega não vê');
  assert.equal((await visiveis(db, EXPIRADO)).length, 0, 'concede expirado não vale');
  assert.equal((await visiveis(db, ADMIN_NEGA_EXPIRADO)).length, 1, 'nega expirado não bloqueia mais');

  // Override mudou depois da emissão: vale na hora, sem reprocessar nada.
  await db.query("update public.usuario_permissoes set expira_em = now() + interval '1 day' where usuario_id = $1", [EXPIRADO]);
  assert.equal(await contar(db, EXPIRADO), 1);
  await db.query('delete from public.usuario_permissoes where usuario_id = $1', [ADMIN_NEGADO]);
  assert.equal(await contar(db, ADMIN_NEGADO), 1);
  await db.query("update public.usuario_permissoes set efeito = 'nega' where usuario_id = $1 and permissao = $2", [GESTAO_OK, VIS]);
  assert.equal(await contar(db, GESTAO_OK), 0, 'perdeu a permissão: some na hora');
});

test('7. o autor não recebe a própria notificação', async () => {
  const db = await novoBancoCom80();
  await criarSolicitacao(db, ADMIN);
  await criarSolicitacao(db, GESTAO_OK);
  assert.equal(await contar(db, ADMIN), 1, 'admin vê só a da gestora');
  assert.equal(await contar(db, GESTAO_OK), 1, 'gestora vê só a do admin');
  assert.equal((await visiveis(db, ADMIN))[0].autor_id, GESTAO_OK);
  assert.equal((await visiveis(db, GESTAO_OK))[0].autor_id, ADMIN);
});

test('8. evento duplicado não gera notificação duplicada', async () => {
  const db = await novoBancoCom80();
  const sid = await criarSolicitacao(db, AUTORA);
  const emitir = (chave) =>
    valor(db, `select public.notificacoes_emitir($1, 'pedidos', 'pedidos_solicitacoes', $2, 'Titulo', 'Desc', null, $3, array['gestao'], null, $4, $5, true)`,
      [TIPO, sid, VIS, AUTORA, chave]);
  const original = await valor(db, 'select id from public.notificacoes');
  assert.equal(await emitir(`${TIPO}:${sid}`), original, 'mesma chave devolve a notificação existente');
  assert.equal(await emitir(`${TIPO}:${sid}`), original);
  assert.equal(await valor(db, 'select count(*)::int from public.notificacoes'), 1);
  assert.equal(await valor(db, 'select count(*)::int from public.notificacoes_pendencia_historico'), 1, 'sem histórico duplicado');
  assert.equal(await valor(db, 'select titulo from public.notificacoes'), 'Nova solicitação de produto', 'original preservada');
});

test('9. marcar como lida é individual, idempotente e não alcança notificação/leitura de outros usuários', async () => {
  const db = await novoBancoCom80();
  await criarSolicitacao(db, AUTORA);
  await criarSolicitacao(db, AUTORA, { descricao: 'SAL' });
  const [n1, n2] = (await db.query('select id from public.notificacoes order by criado_em, id')).rows.map((r) => r.id);

  assert.equal(await marcar(db, GESTAO_OK, [n1]), 1);
  assert.equal(await marcar(db, GESTAO_OK, [n1]), 0, 'idempotente');
  assert.equal(await contar(db, GESTAO_OK), 1);
  assert.equal(await contar(db, ADMIN), 2, 'a leitura da gestora não afeta o admin');

  // Quem não vê a notificação não consegue marcá-la.
  assert.equal(await marcar(db, OPER_VIS, [n1, n2]), 0);
  await comoAutenticado(db, OPER_VIS, () =>
    assert.rejects(db.query('insert into public.notificacoes_leituras (notificacao_id) values ($1)', [n2]), negado));

  // usuario_id enviado é ignorado: a leitura fica sempre em nome de quem marca.
  await comoAutenticado(db, GESTAO_OK, () =>
    db.query('insert into public.notificacoes_leituras (usuario_id, notificacao_id) values ($1, $2)', [ADMIN, n2]));
  assert.equal(await valor(db, 'select count(*)::int from public.notificacoes_leituras where usuario_id = $1', [ADMIN]), 0);
  assert.equal(await contar(db, ADMIN), 2);

  await comoAutenticado(db, GESTAO_OK, async () => {
    assert.equal((await db.query('select * from public.notificacoes_leituras')).rows.every((l) => l.usuario_id === GESTAO_OK), true);
    await assert.rejects(db.query('update public.notificacoes_leituras set lida_em = now()'), negado);
    await assert.rejects(db.query('delete from public.notificacoes_leituras'), negado);
    await assert.rejects(db.query("update public.notificacoes set titulo = 'x'"), negado);
    await assert.rejects(db.query('delete from public.notificacoes'), negado);
  });
  // Leituras de outro usuário são invisíveis.
  await marcar(db, ADMIN, [n1]);
  assert.equal(await comoAutenticado(db, GESTAO_OK, () => valor(db, 'select count(*)::int from public.notificacoes_leituras where usuario_id = $1', [ADMIN])), 0);

  assert.equal(await comoAutenticado(db, ADMIN, () => valor(db, 'select public.notificacoes_marcar_todas_lidas()')), 1);
  assert.equal(await contar(db, ADMIN), 0);
  assert.equal(await contar(db, GESTAO_OK), 0, 'gestora já leu n1 (RPC) e n2 (insert direto, em nome dela)');
});

test('10. realizada resolve, reaberta (exclusão do pedido vinculado) reabre, excluída descarta -- histórico preservado', async () => {
  const db = await novoBancoCom80();
  const sid = await criarSolicitacao(db, AUTORA);

  // Realizada COM pedido (fluxo real: criar_pedido + concluir_solicitacao_com_pedido).
  await como(db, ADMIN);
  const pedido = await valor(db, 'select (public.criar_pedido($1::uuid, current_date, null, null, $2::jsonb)).id',
    [FORNECEDOR_A, JSON.stringify([{ descricao: 'FARINHA', unidade: 'KG', quantidade_pedida: 2.5, valor_unitario: 5 }])]);
  await valor(db, 'select (public.concluir_solicitacao_com_pedido($1::uuid, $2::uuid)).status', [sid, pedido]);
  assert.equal(await pendencia(db, sid), 'resolvida');
  const resolvida = (await db.query('select * from public.notificacoes')).rows[0];
  assert.equal(resolvida.resolvida_por, ADMIN);
  assert.equal(resolvida.resolvida_por_nome, 'ADMIN TESTE');
  assert.equal(resolvida.resolucao_motivo, 'Solicitação realizada com pedido vinculado.');

  // Reaberta: excluir o pedido vinculado devolve a solicitação para pendente (0045).
  await valor(db, 'select public.excluir_pedido_com_solicitacoes($1::uuid)', [pedido]);
  assert.equal(await valor(db, 'select status from public.pedidos_solicitacoes where id = $1', [sid]), 'pendente');
  assert.equal(await pendencia(db, sid), 'aberta');
  assert.equal(await valor(db, 'select resolvida_em from public.notificacoes'), null);

  // Realizada SEM pedido, depois... não pode excluir realizada; então: nova
  // solicitação para o ciclo de exclusão.
  await valor(db, 'select (public.marcar_solicitacao_realizada($1::uuid, null)).status', [sid]);
  assert.equal(await pendencia(db, sid), 'resolvida');
  assert.equal(await valor(db, 'select resolucao_motivo from public.notificacoes'), 'Solicitação marcada como realizada.');

  const sid2 = await criarSolicitacao(db, AUTORA, { descricao: 'OVOS' });
  await como(db, ADMIN);
  await db.query('select public.excluir_solicitacao_pendente($1::uuid)', [sid2]);
  assert.equal(await valor(db, 'select count(*)::int from public.pedidos_solicitacoes where id = $1', [sid2]), 0);
  assert.equal(await pendencia(db, sid2), 'descartada', 'notificação continua no histórico, descartada');

  const trilha = (await db.query(
    `select h.status_anterior, h.status_novo from public.notificacoes_pendencia_historico h
       join public.notificacoes n on n.id = h.notificacao_id where n.registro_id = $1 order by h.alterado_em, h.id`, [sid])).rows;
  assert.deepEqual(trilha.map((t) => `${t.status_anterior ?? '-'}>${t.status_novo}`).sort(),
    ['->aberta', 'aberta>resolvida', 'aberta>resolvida', 'resolvida>aberta'].sort());
  assert.equal(await valor(db, 'select count(*)::int from public.notificacoes'), 2, 'nada foi apagado');

  // Edição comum (sem mudar status) não mexe na pendência.
  const sid3 = await criarSolicitacao(db, AUTORA, { descricao: 'LEITE' });
  await como(db, ADMIN);
  await db.query('select public.editar_solicitacao_pedido($1::uuid, null, $2, 3, current_date, null)', [sid3, 'LEITE INTEGRAL']);
  assert.equal(await pendencia(db, sid3), 'aberta');

  // Histórico visível para quem vê a notificação; invisível para os demais.
  assert.ok(await comoAutenticado(db, GESTAO_OK, () => valor(db, 'select count(*)::int from public.notificacoes_pendencia_historico')) > 0);
  assert.equal(await comoAutenticado(db, OPER_VIS, () => valor(db, 'select count(*)::int from public.notificacoes_pendencia_historico')), 0);
});

test('11. falha na emissão/resolução não impede criar, realizar ou excluir a solicitação, e fica registrada', async () => {
  const db = await novoBancoCom80();
  // Sabota a emissão (simula erro inesperado).
  await db.exec(`
    create or replace function public.notificacoes_emitir(
      p_tipo text, p_modulo text, p_entidade text, p_registro_id text, p_titulo text, p_descricao text, p_dados jsonb,
      p_permissao_requerida text, p_perfis_destinatarios text[], p_destinatario_id uuid, p_autor_id uuid,
      p_chave_dedupe text, p_com_pendencia boolean default false)
    returns uuid language plpgsql security definer set search_path = '' as $$
    begin raise exception 'falha simulada na emissao'; end; $$;
  `);
  const sid = await criarSolicitacao(db, AUTORA);
  assert.ok(sid, 'solicitação criada');
  assert.equal(await valor(db, 'select status from public.pedidos_solicitacoes where id = $1', [sid]), 'pendente');
  assert.equal(await valor(db, 'select count(*)::int from public.notificacoes'), 0);
  const falha = (await db.query('select * from public.notificacoes_falhas')).rows;
  assert.equal(falha.length, 1);
  assert.equal(falha[0].origem, 'pedidos_solicitacoes_notificar:insert');
  assert.equal(falha[0].registro_id, sid);
  assert.match(falha[0].mensagem, /falha simulada na emissao/);
  assert.equal(falha[0].usuario_id, AUTORA);

  // Sabota a resolução: realizar continua funcionando.
  await db.exec(`
    create or replace function public.notificacoes_atualizar_pendencia(
      p_entidade text, p_registro_id text, p_tipo text, p_status text, p_motivo text, p_por uuid)
    returns integer language plpgsql security definer set search_path = '' as $$
    begin raise exception 'falha simulada na resolucao'; end; $$;
  `);
  await como(db, ADMIN);
  assert.equal(await valor(db, 'select (public.marcar_solicitacao_realizada($1::uuid, null)).status', [sid]), 'realizada');
  assert.equal(await valor(db, 'select count(*)::int from public.notificacoes_falhas'), 2);

  // Diagnóstico: só proprietário/admin lê.
  assert.equal(await comoAutenticado(db, ADMIN, () => valor(db, 'select count(*)::int from public.notificacoes_falhas')), 2);
  assert.equal(await comoAutenticado(db, GESTAO_OK, () => valor(db, 'select count(*)::int from public.notificacoes_falhas')), 0);
});

test('12. authenticated/anon não emitem nem resolvem notificações e não escrevem nas tabelas', async () => {
  const db = await novoBancoCom80();
  const sid = await criarSolicitacao(db, AUTORA);
  await comoAutenticado(db, ADMIN, async () => {
    await assert.rejects(
      db.query(`select public.notificacoes_emitir('x.y', 'pedidos', 'e', '1', 'T', null, null, $1, null, null, null, 'k', false)`, [VIS]), negado);
    await assert.rejects(
      db.query(`select public.notificacoes_atualizar_pendencia('pedidos_solicitacoes', $1, $2, 'resolvida', 'x', null)`, [sid, TIPO]), negado);
    await assert.rejects(db.query(`select public.notificacoes_registrar_falha('o', 'e', '1', 's', 'm', 'd')`), negado);
    await assert.rejects(
      db.query(`insert into public.notificacoes (tipo, modulo, entidade, registro_id, titulo, permissao_requerida, chave_dedupe)
                values ('x', 'pedidos', 'e', '1', 'T', $1, 'k2')`, [VIS]), negado);
    await assert.rejects(db.query(`insert into public.notificacoes_falhas (origem) values ('x')`), negado);
    await assert.rejects(db.query(`insert into public.notificacoes_pendencia_historico (notificacao_id, status_novo)
                                   select id, 'resolvida' from public.notificacoes limit 1`), negado);
  });
  assert.equal(await pendencia(db, sid), 'aberta');
  assert.equal(await valor(db, 'select count(*)::int from public.notificacoes'), 1);

  await comoAnon(db, async () => {
    await assert.rejects(db.query('select public.notificacoes_contar_nao_lidas()'), negado);
    await assert.rejects(db.query('select * from public.notificacoes_listar()'), negado);
    await assert.rejects(db.query('select * from public.notificacoes'), negado);
  });

  // Nem o superusuário consegue apagar ou reescrever o conteúdo (histórico permanente).
  await assert.rejects(db.query('delete from public.notificacoes'), /historico permanente/);
  await assert.rejects(db.query("update public.notificacoes set titulo = 'x'"), /somente os campos de pendencia/);
});

test('13. notificação de solicitação concluída/excluída continua listável com registro_id para o link', async () => {
  const db = await novoBancoCom80();
  const concluida = await criarSolicitacao(db, AUTORA, { descricao: 'FARINHA' });
  const excluida = await criarSolicitacao(db, AUTORA, { descricao: 'SAL' });
  await como(db, ADMIN);
  await valor(db, 'select (public.marcar_solicitacao_realizada($1::uuid, null)).status', [concluida]);
  await db.query('select public.excluir_solicitacao_pendente($1::uuid)', [excluida]);

  const linhas = await listar(db, GESTAO_OK);
  const porRegistro = Object.fromEntries(linhas.map((l) => [l.registro_id, l]));
  assert.equal(porRegistro[concluida].pendencia_status, 'resolvida');
  assert.equal(porRegistro[excluida].pendencia_status, 'descartada');
  assert.equal(porRegistro[excluida].tipo, TIPO);
});

test('listar: paginação por cursor, filtros de leitura e de pendências abertas', async () => {
  const db = await novoBancoCom80();
  const ids = [];
  for (const d of ['A', 'B', 'C']) {
    ids.push(await criarSolicitacao(db, AUTORA, { descricao: d }));
  }
  // criado_em pode empatar (mesma transação/relógio): o cursor desempata por id.
  const p1 = await listar(db, ADMIN, 'p_limite => 2');
  assert.equal(p1.length, 2);
  const ultimo = p1.at(-1);
  const p2 = await comoAutenticado(db, ADMIN, async () =>
    (await db.query('select * from public.notificacoes_listar(p_limite => 2, p_antes_em => $1, p_antes_id => $2)', [ultimo.criado_em, ultimo.id])).rows);
  assert.equal(p2.length, 1);
  assert.equal(new Set([...p1, ...p2].map((l) => l.id)).size, 3, 'sem repetir nem pular');

  await marcar(db, ADMIN, [p1[0].id]);
  assert.equal((await listar(db, ADMIN, "p_leitura => 'nao_lidas'")).length, 2);
  const lidas = await listar(db, ADMIN, "p_leitura => 'lidas'");
  assert.equal(lidas.length, 1);
  assert.ok(lidas[0].lida_em);

  await como(db, ADMIN);
  await valor(db, 'select (public.marcar_solicitacao_realizada($1::uuid, null)).status', [ids[0]]);
  assert.equal((await listar(db, ADMIN, 'p_somente_pendencias_abertas => true')).length, 2);
  assert.equal((await listar(db, ADMIN, 'p_limite => 1000')).length, 3, 'limite é limitado a 100, não falha');
  await comoAutenticado(db, ADMIN, () => assert.rejects(db.query("select * from public.notificacoes_listar(p_leitura => 'x')"), /filtro de leitura invalido/));
});

test('SQLs PRE/POS da raiz rodam e o EXECUTAR é byte-idêntico à migration', async (t) => {
  if (!existsSync(PRE) || !existsSync(POS) || !existsSync(EXECUTAR)) {
    t.skip('arquivos PRE/POS/EXECUTAR ausentes nesta cópia (não versionados)');
    return;
  }
  assert.ok(readFileSync(EXECUTAR).equals(readFileSync(join(RAIZ, 'supabase', 'migrations', M80))), 'EXECUTAR difere da migration');
  const antes = await bancoSem80();
  const pre = (await antes.query(readFileSync(PRE, 'utf8'))).rows;
  assert.ok(pre.length > 0, 'PRE devolve linhas');
  assert.deepEqual(pre.filter((l) => l.status === 'FALHA').map((l) => l.verificacao), [], 'PRE: nenhuma FALHA antes da 0080');
  const depois = await banco();
  const pos = (await depois.query(readFileSync(POS, 'utf8'))).rows;
  assert.ok(pos.length > 0, 'POS devolve linhas');
  assert.deepEqual(pos.filter((l) => l.status === 'FALHA').map((l) => l.verificacao), [], 'POS: nenhuma FALHA depois da 0080');
});
