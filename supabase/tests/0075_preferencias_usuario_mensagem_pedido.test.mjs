// Testes da migration 0075 (Favoritos, layout do Dashboard e modelo global da
// mensagem de pedido) sobre as migrations REAIS 0001..0074
// (ambiente_pedidos.mjs), em PostgreSQL embutido (PGlite). As políticas são
// exercidas com SET ROLE authenticated/anon. Também roda os SQLs PRE/POS da
// raiz (quando presentes) e confere que o EXECUTAR é byte-idêntico à
// migration. Nada aqui toca o Supabase real.
//
//   npm i --no-save @electric-sql/pglite
//   node --test supabase/tests/0075_preferencias_usuario_mensagem_pedido.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN, GESTAO, OPERACIONAL, RECEBEDOR, RAIZ, como, fabricaDeBancos, fecharBancos, lerMigration, valor, aplicarMigration } from './ambiente_pedidos.mjs';
import { TEMPLATE_PADRAO } from '../../lib/pedidos/mensagemPedido.js';

const M75 = '0075_preferencias_usuario_mensagem_pedido.sql';
const PRE = join(RAIZ, '0075_pre_auditoria_preferencias_usuario_mensagem_pedido_EXECUTAR.sql');
const POS = join(RAIZ, '0075_pos_auditoria_preferencias_usuario_mensagem_pedido_EXECUTAR.sql');
const EXECUTAR = join(RAIZ, '0075_preferencias_usuario_mensagem_pedido_EXECUTAR.sql');

// Usuário sem dashboard.visualizar (override "nega").
const SEM_DASHBOARD = '00000000-0000-0000-0000-0000000000d1';

after(fecharBancos);

const banco = fabricaDeBancos({ extras: ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql', M75] });
const bancoSem75 = fabricaDeBancos({ extras: ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql'] });

async function comoAutenticado(db, uid, fn) {
  await como(db, uid);
  await db.exec('set role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

async function falha(promessa, padrao) {
  await assert.rejects(promessa, (e) => {
    assert.match(String(e.message), padrao);
    return true;
  });
}

async function criarSemDashboard(db) {
  await db.exec(`
    insert into auth.users (id, email) values ('${SEM_DASHBOARD}', 'semdash@padoca.test');
    insert into public.usuarios (id, nome, email, perfil, ativo) values ('${SEM_DASHBOARD}', 'SEM DASH', 'semdash@padoca.test', 'gestao', true);
    insert into public.usuario_permissoes (usuario_id, permissao, efeito) values ('${SEM_DASHBOARD}', 'dashboard.visualizar', 'nega');
  `);
}

test('aplica sobre 0001..0074 e cria só os objetos esperados, com o modelo padrão igual ao do frontend', async () => {
  const db = await banco();
  for (const t of ['usuario_favoritos', 'usuario_dashboard_layout', 'pedidos_mensagem_config']) {
    assert.equal(await valor(db, 'select relrowsecurity from pg_class where oid = $1::regclass', [`public.${t}`]), true, `RLS em ${t}`);
  }
  assert.equal(await valor(db, 'select count(*)::int from public.pedidos_mensagem_config'), 1);
  assert.equal(await valor(db, 'select template from public.pedidos_mensagem_config'), TEMPLATE_PADRAO);
  assert.equal(await valor(db, "select count(*)::int from public.permissoes where codigo like '%favorit%' or codigo like '%mensagem%'"), 0, 'nenhuma permissão nova');
});

test('reaplicar aborta pela guarda, sem alterar nada', async () => {
  const db = await banco();
  await db.query("update public.pedidos_mensagem_config set template = 'X {{itens}}'");
  await falha(aplicarMigration(db, M75), /0075 abortada: objetos desta migration ja existem/);
  // A guarda aborta dentro do BEGIN da migration: encerra a transação.
  await db.exec('rollback');
  assert.equal(await valor(db, 'select template from public.pedidos_mensagem_config'), 'X {{itens}}');
});

test('favoritos: dono forçado para auth.uid(), cada um vê e apaga só os seus', async () => {
  const db = await banco();
  await comoAutenticado(db, OPERACIONAL, async () => {
    // usuario_id enviado de outro usuário é ignorado pelo trigger.
    await db.query(`insert into public.usuario_favoritos (usuario_id, chave) values ($1, 'producao.hoje')`, [ADMIN]);
    await db.query(`insert into public.usuario_favoritos (chave) values ('agenda')`);
    assert.equal(await valor(db, 'select count(*)::int from public.usuario_favoritos'), 2);
  });
  assert.equal(await valor(db, 'select count(*)::int from public.usuario_favoritos where usuario_id = $1', [OPERACIONAL]), 2);
  await comoAutenticado(db, ADMIN, async () => {
    assert.equal(await valor(db, 'select count(*)::int from public.usuario_favoritos'), 0, 'admin não vê favoritos alheios');
    const r = await db.query("delete from public.usuario_favoritos where chave = 'agenda'");
    assert.equal(r.affectedRows ?? 0, 0);
  });
  assert.equal(await valor(db, 'select count(*)::int from public.usuario_favoritos'), 2);
  await comoAutenticado(db, OPERACIONAL, async () => {
    await db.query("delete from public.usuario_favoritos where chave = 'agenda'");
    assert.equal(await valor(db, 'select count(*)::int from public.usuario_favoritos'), 1);
    await falha(db.query("update public.usuario_favoritos set chave = 'agenda'"), /permission denied/);
  });
});

test('favoritos: chave inválida, duplicada, limite de 40 e usuário sem dashboard.visualizar', async () => {
  const db = await banco();
  await criarSemDashboard(db);
  await comoAutenticado(db, GESTAO, async () => {
    await falha(db.query("insert into public.usuario_favoritos (chave) values ('https://x.com')"), /usuario_favoritos_chave_formato/);
    await falha(db.query("insert into public.usuario_favoritos (chave) values ('Pedidos.Resumo')"), /usuario_favoritos_chave_formato/);
    await db.query("insert into public.usuario_favoritos (chave) values ('pedidos.resumo')");
    await falha(db.query("insert into public.usuario_favoritos (chave) values ('pedidos.resumo')"), /duplicate key|usuario_favoritos_pkey/);
    for (let i = 1; i < 40; i++) await db.query('insert into public.usuario_favoritos (chave) values ($1)', [`tela${i}`]);
    await falha(db.query("insert into public.usuario_favoritos (chave) values ('tela40')"), /limite de favoritos atingido/);
  });
  await comoAutenticado(db, SEM_DASHBOARD, async () => {
    await falha(db.query("insert into public.usuario_favoritos (chave) values ('agenda')"), /row-level security/);
  });
});

test('layout do Dashboard: validação, upsert da própria linha, isolamento entre usuários', async () => {
  const db = await banco();
  const ok = JSON.stringify([{ id: 'lembretes', tamanho: 'G' }, { id: 'agenda_hoje', tamanho: 'P' }]);
  await comoAutenticado(db, OPERACIONAL, async () => {
    await db.query('insert into public.usuario_dashboard_layout (usuario_id, widgets) values ($1, $2::jsonb)', [ADMIN, ok]);
    await db.query(
      'insert into public.usuario_dashboard_layout (usuario_id, widgets) values ($1, $2::jsonb) on conflict (usuario_id) do update set widgets = excluded.widgets',
      [OPERACIONAL, JSON.stringify([{ id: 'lembretes', tamanho: 'M' }])]
    );
    assert.equal(await valor(db, "select widgets->0->>'tamanho' from public.usuario_dashboard_layout"), 'M');
    for (const ruim of [
      [{ id: 'lembretes', tamanho: 'X' }],
      [{ id: 'lembretes', tamanho: 'P', extra: 1 }],
      [{ id: 'lembretes', tamanho: 'P' }, { id: 'lembretes', tamanho: 'G' }],
      [{ id: 'Lembretes!', tamanho: 'P' }],
      [{ tamanho: 'P' }],
      { id: 'lembretes', tamanho: 'P' },
      Array.from({ length: 41 }, (_, i) => ({ id: `w${i}`, tamanho: 'P' })),
    ]) {
      await falha(db.query('update public.usuario_dashboard_layout set widgets = $1::jsonb', [JSON.stringify(ruim)]), /usuario_dashboard_layout_widgets_validos/);
    }
    await falha(db.query('update public.usuario_dashboard_layout set usuario_id = $1', [ADMIN]), /usuario_id nao pode ser alterado/);
  });
  assert.equal(await valor(db, 'select usuario_id::text from public.usuario_dashboard_layout'), OPERACIONAL, 'linha criada para o próprio usuário');
  await comoAutenticado(db, ADMIN, async () => {
    assert.equal(await valor(db, 'select count(*)::int from public.usuario_dashboard_layout'), 0);
    const r = await db.query('update public.usuario_dashboard_layout set widgets = $1::jsonb', [ok]);
    assert.equal(r.affectedRows ?? 0, 0);
  });
  await comoAutenticado(db, OPERACIONAL, async () => {
    await db.query('delete from public.usuario_dashboard_layout');
    assert.equal(await valor(db, 'select count(*)::int from public.usuario_dashboard_layout'), 0, 'restaurar padrão = apagar a linha');
  });
});

test('modelo global: lê quem vê Pedidos; só proprietario_admin altera; autoria vem do servidor', async () => {
  const db = await banco();
  await comoAutenticado(db, OPERACIONAL, async () => {
    assert.equal(await valor(db, 'select count(*)::int from public.pedidos_mensagem_config'), 0, 'sem pedidos.visualizar não lê');
  });
  await comoAutenticado(db, RECEBEDOR, async () => {
    assert.equal(await valor(db, 'select template from public.pedidos_mensagem_config'), TEMPLATE_PADRAO, 'pedidos.visualizar lê');
    const r = await db.query("update public.pedidos_mensagem_config set template = 'HACK {{itens}}'");
    assert.equal(r.affectedRows ?? 0, 0, 'não-admin não altera');
    await falha(db.query('update public.pedidos_mensagem_config set atualizado_por_nome = $1', ['x']), /permission denied/);
    await falha(db.query("insert into public.pedidos_mensagem_config (id, template) values (false, 'x')"), /permission denied/);
    await falha(db.query('delete from public.pedidos_mensagem_config'), /permission denied/);
  });
  assert.equal(await valor(db, 'select template from public.pedidos_mensagem_config'), TEMPLATE_PADRAO);
  await comoAutenticado(db, ADMIN, async () => {
    await db.query("update public.pedidos_mensagem_config set template = 'Novo {{itens}}'");
    await falha(db.query("update public.pedidos_mensagem_config set template = '   '"), /pedidos_mensagem_config_template_valido/);
    await falha(db.query('update public.pedidos_mensagem_config set template = $1', ['x'.repeat(4001)]), /pedidos_mensagem_config_template_valido/);
  });
  const linha = (await db.query('select template, atualizado_por::text as por, atualizado_por_nome as nome from public.pedidos_mensagem_config')).rows[0];
  assert.deepEqual(linha, { template: 'Novo {{itens}}', por: ADMIN, nome: 'ADMIN TESTE' });
});

test('anon não acessa nenhuma das tabelas novas', async () => {
  const db = await banco();
  await como(db, null);
  await db.exec('set role anon');
  try {
    for (const t of ['usuario_favoritos', 'usuario_dashboard_layout', 'pedidos_mensagem_config']) {
      await falha(db.query(`select * from public.${t}`), /permission denied/);
    }
  } finally {
    await db.exec('reset role');
  }
});

test('SQLs PRE/POS da raiz rodam e o EXECUTAR é byte-idêntico à migration', async (t) => {
  if (!existsSync(PRE) || !existsSync(POS) || !existsSync(EXECUTAR)) {
    t.skip('arquivos PRE/POS/EXECUTAR ausentes nesta cópia (não versionados)');
    return;
  }
  assert.ok(readFileSync(EXECUTAR).equals(readFileSync(join(RAIZ, 'supabase', 'migrations', M75))), 'EXECUTAR difere da migration');
  const antes = await bancoSem75();
  const pre = (await antes.query(readFileSync(PRE, 'utf8'))).rows;
  assert.ok(pre.length > 0, 'PRE devolve linhas');
  // Critério dos auditores: FALHA reprova; OK e INFO (só informativo) passam.
  assert.deepEqual(pre.filter((l) => l.status === 'FALHA').map((l) => l.verificacao), [], 'PRE: nenhuma FALHA antes da 0075');
  const depois = await banco();
  const pos = (await depois.query(readFileSync(POS, 'utf8'))).rows;
  assert.ok(pos.length > 0, 'POS devolve linhas');
  assert.deepEqual(pos.filter((l) => l.status === 'FALHA').map((l) => l.verificacao), [], 'POS: nenhuma FALHA depois da 0075');
  assert.ok(lerMigration(M75).includes('BEGIN;'));
});
