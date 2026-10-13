// Testes da migration 0073 (Financeiro > Contas a Pagar) sobre a cadeia
// REAL de migrations de Pedidos/Compras, Sacos, Folha e 0072 (ver
// ambiente_pedidos.mjs), em PostgreSQL embutido (PGlite). Também roda os
// SQLs PRE/POS da raiz (quando presentes) e confere o _EXECUTAR. Nada aqui
// toca o Supabase real.
//
//   npm i --no-save @electric-sql/pglite
//   node --test supabase/tests/0073_contas_pagar.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  novoBanco, fabricaDeBancos, fecharBancos, como, valor, aplicarMigration, lerMigration, HOJE_TESTE, RAIZ,
  ADMIN, FINANCEIRO, GESTAO, OPERACIONAL, RECEBEDOR, FORNECEDOR_A, FORNECEDOR_B, FORNECEDOR_INATIVO,
} from './ambiente_pedidos.mjs';

const M73 = '0073_contas_pagar.sql';
const PRE = join(RAIZ, '0073_pre_auditoria_contas_pagar_EXECUTAR.sql');
const POS = join(RAIZ, '0073_pos_auditoria_contas_pagar_EXECUTAR.sql');
const EXECUTAR = join(RAIZ, '0073_contas_pagar_EXECUTAR.sql');

const banco = fabricaDeBancos();

const ITENS = [
  { descricao: 'FARINHA', unidade: 'KG', quantidade_pedida: 10, valor_unitario: 5 },
  { descricao: 'SAL', unidade: 'KG', quantidade_pedida: 2, valor_unitario: 3 },
];
// Recebimento padrão: FARINHA 10 x 50,00 = 500,00 + SAL 2 x 25,00 = 50,00 -> 550,00
const RECEBIDO = [[10, 50], [2, 25]];

const hoje = (db) => valor(db, "select ((now() at time zone 'America/Sao_Paulo')::date)::text");
function somarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const negado = (e) => e.code === '42501';
// Colunas date chegam como Date (meia-noite UTC) -- compara pelo dia.
const dia = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

after(fecharBancos);

async function criarPedido(db, { itens = ITENS, fornecedor = FORNECEDOR_A, data } = {}) {
  return valor(db, 'select (public.criar_pedido($1::uuid, $2::date, null, null, $3::jsonb)).id',
    [fornecedor, data ?? (await hoje(db)), JSON.stringify(itens)]);
}

async function payload(db, pedidoId, valores = RECEBIDO) {
  const r = await db.query('select id from public.pedido_itens where pedido_id = $1 order by descricao', [pedidoId]);
  return JSON.stringify(r.rows.map((row, i) => ({
    pedido_item_id: row.id, unidade_recebida: 'KG', quantidade_recebida: valores[i][0], valor_unitario_recebido: valores[i][1],
  })));
}

async function receber(db, pedidoId, { valores = RECEBIDO, data } = {}) {
  return valor(db, 'select (public.receber_pedido($1::uuid, $2::date, $3::jsonb)).status',
    [pedidoId, data ?? (await hoje(db)), await payload(db, pedidoId, valores)]);
}

async function receberComFinanceiro(db, pedidoId, fin, { valores = RECEBIDO, data } = {}) {
  return valor(db, `select (public.receber_pedido_com_financeiro($1::uuid, $2::date, $3::jsonb, $4, $5, $6::jsonb, $7::date, $8)).status`,
    [pedidoId, data ?? (await hoje(db)), await payload(db, pedidoId, valores),
      fin.condicao, fin.forma, fin.parcelas ? JSON.stringify(fin.parcelas) : null, fin.pagoEm ?? null, fin.obs ?? null]);
}

async function lancar(db, pedidoId, fin) {
  return valor(db, 'select public.contas_pagar_lancar_compra($1::uuid, $2, $3, $4::jsonb, $5::date, $6)',
    [pedidoId, fin.condicao, fin.forma, fin.parcelas ? JSON.stringify(fin.parcelas) : null, fin.pagoEm ?? null, fin.obs ?? null]);
}

async function presencial(db, { itens = [{ descricao: 'LEITE', unidade: 'UN', quantidade_pedida: 10, valor_unitario: 55 }], fin, fornecedor = FORNECEDOR_B } = {}) {
  const dia = await hoje(db);
  if (!fin) {
    return valor(db, 'select (public.registrar_compra_presencial($1::uuid, $2::date, $3, null, null, $4::jsonb)).id',
      [fornecedor, dia, 'NF 123', JSON.stringify(itens)]);
  }
  return valor(db, `select (public.registrar_compra_presencial_com_financeiro($1::uuid, $2::date, $3, null, null, $4::jsonb, $5, $6, $7::jsonb, $8::date, $9)).id`,
    [fornecedor, dia, 'NF 123', JSON.stringify(itens), fin.condicao, fin.forma, fin.parcelas ? JSON.stringify(fin.parcelas) : null, fin.pagoEm ?? null, fin.obs ?? null]);
}

async function criarManual(db, d = {}) {
  const dados = {
    descricao: '  aluguel   da loja ', categoria: null, fornecedor: null, credor: 'imobiliária  são josé',
    competencia: '2026-10-15', condicao: 'a_prazo', forma: 'boleto', parcelas: null, pagoEm: null, obs: 'Contrato 2026', ...d,
  };
  const categoria = dados.categoria ?? (await valor(db, "select id from public.contas_pagar_categorias where nome = 'ALUGUEL'"));
  const parcelas = dados.parcelas ?? [{ vencimento: somarDias(await hoje(db), 10), valor: 2500 }];
  return valor(db, 'select public.contas_pagar_criar_manual($1, $2::uuid, $3::uuid, $4, $5::date, $6, $7, $8::jsonb, $9::date, $10)',
    [dados.descricao, categoria, dados.fornecedor, dados.credor, dados.competencia, dados.condicao, dados.forma, JSON.stringify(parcelas), dados.pagoEm, dados.obs]);
}

const parcelasDe = (db, contaId) =>
  db.query('select id, numero, vencimento::text as vencimento, valor::text as valor from public.contas_pagar_parcelas where conta_id = $1 order by numero', [contaId]).then((r) => r.rows);

const resumo = (db, contaId) =>
  db.query('select * from public.contas_pagar_listar_contas() where id = $1', [contaId]).then((r) => r.rows[0]);

const pagar = (db, parcelaId, { pagoEm, forma = 'pix', juros = 0, multa = 0, desconto = 0, valorPago = null, obs = null } = {}) =>
  hoje(db).then((h) => valor(db, 'select public.contas_pagar_pagar_parcela($1::uuid, $2::date, $3, $4, $5, $6, $7, $8)',
    [parcelaId, pagoEm ?? h, forma, juros, multa, desconto, valorPago, obs]));

async function aPrazo3(db) {
  const h = await hoje(db);
  return { condicao: 'a_prazo', forma: 'boleto', parcelas: [
    { vencimento: somarDias(h, 30), valor: 183.34 },
    { vencimento: somarDias(h, 60), valor: 183.33 },
    { vencimento: somarDias(h, 90), valor: 183.33 },
  ] };
}

async function fotografia(db) {
  const r = await db.query(`select
    (select count(*) from public.contas_pagar)::int as contas,
    (select count(*) from public.contas_pagar_parcelas)::int as parcelas,
    (select count(*) from public.contas_pagar_baixas)::int as baixas,
    (select string_agg(id::text || status, ',' order by id) from public.pedidos) as pedidos`);
  return r.rows[0];
}

// ============================================================
// Schema, grants, segurança
// ============================================================

test('schema: parcela sem status (paga = baixa ativa), valor_pago gerado, índices únicos e data de corte gravada', async () => {
  const db = await banco();
  const colunasParcela = (await db.query(`select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'contas_pagar_parcelas' order by ordinal_position`)).rows.map((r) => r.column_name);
  assert.deepEqual(colunasParcela, ['id', 'conta_id', 'numero', 'vencimento', 'valor', 'criado_em', 'atualizado_em']);

  const gerada = await valor(db, `select is_generated from information_schema.columns
    where table_name = 'contas_pagar_baixas' and column_name = 'valor_pago'`);
  assert.equal(gerada, 'ALWAYS');

  const indices = (await db.query(`select indexname, indexdef from pg_indexes where indexname in
    ('contas_pagar_compra_ativa_unica', 'contas_pagar_baixas_ativa_unica')`)).rows;
  assert.equal(indices.length, 2);
  assert.ok(indices.every((i) => /UNIQUE/.test(i.indexdef) && /WHERE/.test(i.indexdef)));

  const corte = (await db.query("select count(*)::int n, bool_and(implantado_em <= now() and implantado_em > now() - interval '1 hour') ok from public.contas_pagar_config")).rows[0];
  assert.deepEqual(corte, { n: 1, ok: true });
  await assert.rejects(db.query("update public.contas_pagar_config set implantado_em = now() - interval '1 year'"), /imutavel/);
  await assert.rejects(db.query('delete from public.contas_pagar_config'), /imutavel/);

  assert.equal(await valor(db, "select data_type from information_schema.columns where table_name = 'pedidos' and column_name = 'data_recebimento'"), 'date');
});

test('grants: RPCs só para authenticated; helpers internos sem EXECUTE para nenhum papel de API; tabelas sem escrita', async () => {
  const db = await banco();
  const publicas = [
    'contas_pagar_lancar_compra(uuid,text,text,jsonb,date,text)',
    'receber_pedido_com_financeiro(uuid,date,jsonb,text,text,jsonb,date,text)',
    'registrar_compra_presencial_com_financeiro(uuid,date,text,date,text,jsonb,text,text,jsonb,date,text)',
    'contas_pagar_criar_manual(text,uuid,uuid,text,date,text,text,jsonb,date,text)',
    'contas_pagar_editar_conta(uuid,text,uuid,uuid,text,date,text)',
    'contas_pagar_replanejar(uuid,text,jsonb)',
    'contas_pagar_pagar_parcela(uuid,date,text,numeric,numeric,numeric,numeric,text)',
    'contas_pagar_estornar_baixa(uuid,text)',
    'contas_pagar_cancelar(uuid,text)',
    'contas_pagar_salvar_categoria(uuid,text)',
    'contas_pagar_definir_categoria_ativa(uuid,boolean)',
    'contas_pagar_listar_contas()', 'contas_pagar_listar_parcelas()',
    'contas_pagar_listar_compras_sem_lancamento()', 'contas_pagar_listar_fornecedores()',
  ];
  const internas = [
    'contas_pagar_exigir_visualizar()', 'pedido_itens_correcao_presencial_autorizada(uuid)',
    'pedido_itens_reabertura_autorizada(uuid)', 'pedido_itens_reabertura_coerente()',
    'contas_pagar_hoje()', 'contas_pagar_normalizar_nome(text)', 'contas_pagar_nome_usuario()',
    'contas_pagar_total_compra(uuid)', 'contas_pagar_data_compra(uuid)', 'contas_pagar_validar_forma(text)',
    'contas_pagar_inserir_parcelas(uuid,jsonb,date)', 'contas_pagar_registrar_baixa(uuid,date,text,numeric,numeric,numeric,numeric,text)',
    'contas_pagar_verificar_conta(uuid)', 'contas_pagar_verificar_trigger_fn()', 'pedidos_financeiro_protecao()',
    'contas_pagar_protecao()', 'contas_pagar_parcelas_protecao()', 'contas_pagar_baixas_protecao()',
    'contas_pagar_config_protecao()', 'contas_pagar_categorias_protecao()',
  ];
  const pode = (papel, f) => valor(db, 'select has_function_privilege($1, $2, \'EXECUTE\')', [papel, `public.${f}`]);
  for (const f of publicas) {
    assert.equal(await pode('authenticated', f), true, f);
    assert.equal(await pode('anon', f), false, f);
    assert.equal(await pode('service_role', f), false, f);
  }
  for (const f of internas) {
    for (const papel of ['authenticated', 'anon', 'service_role']) assert.equal(await pode(papel, f), false, `${papel} ${f}`);
  }
  for (const t of ['contas_pagar', 'contas_pagar_parcelas', 'contas_pagar_baixas', 'contas_pagar_categorias', 'contas_pagar_config']) {
    for (const priv of ['INSERT', 'UPDATE', 'DELETE']) {
      assert.equal(await valor(db, 'select has_table_privilege($1, $2, $3)', ['authenticated', `public.${t}`, priv]), false, `${t} ${priv}`);
    }
    assert.equal(await valor(db, 'select has_table_privilege($1, $2, $3)', ['anon', `public.${t}`, 'SELECT']), false, t);
  }
  // Nenhuma view (nem security definer nem invoker): a leitura cruzada com
  // pedidos/fornecedores é só pelas funções contas_pagar_listar_*.
  assert.equal(await valor(db, "select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v', 'm') and c.relname like 'contas\\_pagar%'"), 0);
  // As tabelas legadas e as de Pedidos/fornecedores não ganharam grant/policy.
  assert.equal(await valor(db, "select count(*)::int from pg_policies where tablename in ('pedidos', 'pedido_itens', 'fornecedores') and (qual like '%contas_pagar%' or with_check like '%contas_pagar%')"), 0);
});

test('todas as funções novas têm search_path vazio; as de escrita/leitura privilegiada são SECURITY DEFINER', async () => {
  const db = await banco();
  const r = await db.query(`select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'contas_pagar%' or p.proname in
      ('receber_pedido_com_financeiro', 'registrar_compra_presencial_com_financeiro', 'pedidos_financeiro_protecao', 'receber_pedido',
       'pedido_itens_protecao', 'pedido_itens_correcao_presencial_autorizada', 'editar_compra_presencial',
       'pedido_itens_reabertura_autorizada', 'pedido_itens_reabertura_coerente', 'reabrir_recebimento_pedido'))`);
  assert.ok(r.rows.length >= 39);
  const invoker = new Set(['contas_pagar_hoje', 'contas_pagar_normalizar_nome', 'contas_pagar_validar_forma']);
  for (const f of r.rows) {
    assert.deepEqual(f.proconfig, ['search_path=""'], f.proname);
    assert.equal(f.prosecdef, !invoker.has(f.proname), f.proname);
  }
});

test('RLS + leitura: sem contas_pagar.visualizar não vê tabelas e as funções de leitura recusam (42501); com a permissão vê; ninguém escreve direto', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  await receberComFinanceiro(db, pedido, await aPrazo3(db));
  await criarManual(db);
  const semLancamento = await criarPedido(db);
  await receber(db, semLancamento);

  const comoAutenticado = async (uid, fn) => {
    await como(db, uid);
    await db.exec('set role authenticated');
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
    }
  };
  const contar = (uid) => comoAutenticado(uid, async () => (await db.query(`select
        (select count(*) from public.contas_pagar)::int a, (select count(*) from public.contas_pagar_parcelas)::int b,
        (select count(*) from public.contas_pagar_baixas)::int c, (select count(*) from public.contas_pagar_categorias)::int d,
        (select count(*) from public.contas_pagar_config)::int g`)).rows[0]);
  const leituras = [
    'select count(*)::int from public.contas_pagar_listar_contas()',
    'select count(*)::int from public.contas_pagar_listar_parcelas()',
    'select count(*)::int from public.contas_pagar_listar_compras_sem_lancamento()',
    'select count(*)::int from public.contas_pagar_listar_fornecedores()',
  ];
  for (const uid of [GESTAO, OPERACIONAL, RECEBEDOR, null]) {
    assert.deepEqual(await contar(uid), { a: 0, b: 0, c: 0, d: 0, g: 0 }, String(uid));
    for (const sql of leituras) {
      await assert.rejects(comoAutenticado(uid, () => db.query(sql)), (e) => negado(e) && /contas_pagar\.visualizar/.test(e.message), `${uid} ${sql}`);
    }
  }
  const fin = await contar(FINANCEIRO);
  assert.equal(fin.a, 2);
  assert.equal(fin.b, 4);
  assert.equal(fin.g, 1);
  // financeiro_administrativo não lê pedidos/fornecedores pela RLS, mas as
  // funções entregam o mínimo de que o Financeiro precisa.
  const [contas, parcelas, fila, forns, pedidosDireto, fornDireto] = await comoAutenticado(FINANCEIRO, async () => Promise.all([
    ...leituras.map((sql) => valor(db, sql)),
    valor(db, 'select count(*)::int from public.pedidos'),
    valor(db, 'select count(*)::int from public.fornecedores'),
  ]));
  assert.deepEqual([contas, parcelas, fila, forns, pedidosDireto, fornDireto], [2, 4, 1, 3, 0, 0]);
  const credor = await comoAutenticado(FINANCEIRO, () => valor(db, "select credor_exibicao from public.contas_pagar_listar_contas() where origem = 'compra'"));
  assert.equal(credor, 'MOINHO A');

  await como(db, ADMIN);
  await db.exec('set role authenticated');
  try {
    await assert.rejects(db.query("insert into public.contas_pagar_categorias (nome) values ('X')"), /permission denied/);
    await assert.rejects(db.query('update public.contas_pagar_parcelas set valor = 1'), /permission denied/);
    await assert.rejects(db.query('delete from public.contas_pagar'), /permission denied/);
  } finally {
    await db.exec('reset role');
  }
});

test('permissões e perfis padrão: admin 4, financeiro_administrativo 3 (sem cancelar), gestão/operacional nenhuma', async () => {
  const db = await banco();
  const r = await db.query(`select perfil, string_agg(permissao, ',' order by permissao) p from public.perfil_permissoes
    where permissao like 'contas_pagar.%' group by perfil order by perfil`);
  assert.deepEqual(r.rows, [
    { perfil: 'financeiro_administrativo', p: 'contas_pagar.editar,contas_pagar.pagar,contas_pagar.visualizar' },
    { perfil: 'proprietario_admin', p: 'contas_pagar.cancelar,contas_pagar.editar,contas_pagar.pagar,contas_pagar.visualizar' },
  ]);
  assert.equal(await valor(db, "select count(*)::int from public.permissoes where codigo like 'contas_pagar.%'"), 4);
  assert.equal(await valor(db, "select string_agg(codigo, ',' order by codigo) from public.permissoes where codigo like 'financeiro.%'"), 'financeiro.visualizar');
});

// ============================================================
// Compra -> financeiro
// ============================================================

test('compra só recebida: grava data_recebimento, entra em "Compras sem lançamento" com total e sem financeiro', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  const ontem = somarDias(await hoje(db), -1);
  await db.query('update public.pedidos set data_pedido = $2 where id = $1', [pedido, somarDias(ontem, -2)]);
  assert.equal(await receber(db, pedido, { data: ontem }), 'recebido');
  assert.equal(await valor(db, 'select data_recebimento::text from public.pedidos where id = $1', [pedido]), ontem);

  const fila = (await db.query('select total::text, elegivel, anterior_implantacao, data_compra::text, fornecedor_nome from public.contas_pagar_listar_compras_sem_lancamento() where pedido_id = $1', [pedido])).rows;
  assert.deepEqual(fila, [{ total: '550.00', elegivel: true, anterior_implantacao: false, data_compra: ontem, fornecedor_nome: 'MOINHO A' }]);
  assert.equal(await valor(db, 'select count(*)::int from public.contas_pagar'), 0);
});

test('recebimento + financeiro a prazo é atômico: 3 parcelas, soma exata, numeradas por vencimento, auditado', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  const fin = await aPrazo3(db);
  fin.parcelas.reverse(); // ordem informada não importa: numeração segue o vencimento
  assert.equal(await receberComFinanceiro(db, pedido, fin), 'recebido');

  const conta = await valor(db, 'select id from public.contas_pagar where pedido_id = $1', [pedido]);
  const parcelas = await parcelasDe(db, conta);
  assert.deepEqual(parcelas.map((p) => [p.numero, p.valor]), [[1, '183.34'], [2, '183.33'], [3, '183.33']]);
  assert.ok(parcelas[0].vencimento < parcelas[1].vencimento && parcelas[1].vencimento < parcelas[2].vencimento);

  const r = await resumo(db, conta);
  assert.equal(r.situacao, 'pendente');
  assert.equal(r.valor_total, '550.00');
  assert.equal(r.credor_exibicao, 'MOINHO A');
  assert.equal(r.fornecedor_id, FORNECEDOR_A);
  assert.equal(await valor(db, 'select count(*)::int from public.contas_pagar_listar_compras_sem_lancamento() where pedido_id = $1', [pedido]), 0);

  const logs = (await db.query(`select entidade, acao, usuario_id from public.logs_auditoria
    where (entidade = 'conta_pagar' and registro_id = $1) or (entidade = 'pedido' and registro_id = $2) order by data_hora, acao`, [conta, pedido])).rows;
  assert.ok(logs.some((l) => l.entidade === 'conta_pagar' && l.acao === 'criou' && l.usuario_id === ADMIN));
  assert.ok(logs.some((l) => l.entidade === 'pedido' && l.acao === 'lancou_financeiro'));
  assert.ok(logs.some((l) => l.entidade === 'pedido' && l.acao === 'recebeu'));
});

test('falha no financeiro desfaz o recebimento inteiro (nada gravado)', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  const antes = await fotografia(db);
  const h = await hoje(db);
  const casos = [
    [{ condicao: 'a_prazo', forma: 'boleto', parcelas: [{ vencimento: somarDias(h, 30), valor: 500 }] }, /precisa ser exatamente o total/],
    [{ condicao: 'a_prazo', forma: 'cartao_credito', parcelas: [{ vencimento: somarDias(h, 30), valor: 550 }] }, /cartao e paga no ato/],
    [{ condicao: 'no_ato', forma: 'boleto' }, /boleto nao e pagamento no ato/],
    [{ condicao: 'a_prazo', forma: 'boleto', parcelas: [{ vencimento: somarDias(h, -400), valor: 550 }] }, /anterior a data minima/],
    [{ condicao: 'a_prazo', forma: 'boleto', parcelas: [{ vencimento: somarDias(h, 30), valor: 549.999 }] }, /2 casas/],
    [{ condicao: 'a_prazo', forma: 'boleto', parcelas: [] }, /ao menos uma parcela/],
    [{ condicao: 'no_ato', forma: 'pix', pagoEm: somarDias(h, 1) }, /futuro/],
    [{ condicao: 'parcelado', forma: 'boleto' }, /condicao invalida/],
  ];
  for (const [fin, erro] of casos) {
    await assert.rejects(receberComFinanceiro(db, pedido, fin), erro);
    assert.deepEqual(await fotografia(db), antes);
  }
  assert.equal(await valor(db, 'select status from public.pedidos where id = $1', [pedido]), 'aguardando_entrega');
});

test('compra paga no ato (presencial): conta + 1 parcela + 1 baixa, situação paga, nunca pendente', async () => {
  const db = await banco();
  const pedido = await presencial(db, { fin: { condicao: 'no_ato', forma: 'cartao_credito' } });
  const conta = await valor(db, 'select id from public.contas_pagar where pedido_id = $1', [pedido]);
  const r = await resumo(db, conta);
  assert.equal(r.situacao, 'paga');
  assert.equal(r.qtd_parcelas, 1);
  assert.equal(r.qtd_pagas, 1);
  assert.equal(r.valor_total, '550.00');
  assert.equal(r.valor_em_aberto, '0');
  assert.equal(dia(r.data_compra), await hoje(db));
  const baixa = (await db.query(`select forma_pagamento, pago_em::text, valor_original::text, valor_pago::text, registrado_por
    from public.contas_pagar_baixas b join public.contas_pagar_parcelas p on p.id = b.parcela_id where p.conta_id = $1`, [conta])).rows;
  assert.deepEqual(baixa, [{ forma_pagamento: 'cartao_credito', pago_em: await hoje(db), valor_original: '550.00', valor_pago: '550.00', registrado_por: ADMIN }]);
  assert.equal(await valor(db, "select count(*)::int from public.contas_pagar_listar_parcelas() where situacao = 'pendente'"), 0);
});

test('idempotência: segundo lançamento ativo da mesma compra é recusado (RPC e índice único)', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  await receber(db, pedido);
  await lancar(db, pedido, { condicao: 'no_ato', forma: 'pix' });
  await assert.rejects(lancar(db, pedido, { condicao: 'no_ato', forma: 'pix' }), /ja tem lancamento financeiro ativo/);
  await assert.rejects(receberComFinanceiro(db, pedido, { condicao: 'no_ato', forma: 'pix' }), /somente pedidos aguardando_entrega/);
  assert.equal(await valor(db, 'select count(*)::int from public.contas_pagar where pedido_id = $1', [pedido]), 1);
});

test('lançar financeiro exige compra recebida com valores completos e total > 0', async () => {
  const db = await banco();
  const aguardando = await criarPedido(db);
  await assert.rejects(lancar(db, aguardando, { condicao: 'no_ato', forma: 'pix' }), /somente compras recebidas/);

  const legado = await criarPedido(db);
  await valor(db, 'select (public.marcar_pedido_recebido($1)).status', [legado]);
  assert.equal(await valor(db, 'select elegivel from public.contas_pagar_listar_compras_sem_lancamento() where pedido_id = $1', [legado]), false);
  await assert.rejects(lancar(db, legado, { condicao: 'no_ato', forma: 'pix' }), /valores recebidos completos/);

  const bonificacao = await criarPedido(db);
  await receber(db, bonificacao, { valores: [[10, 0], [2, 0]] });
  assert.equal(await valor(db, 'select elegivel from public.contas_pagar_listar_compras_sem_lancamento() where pedido_id = $1', [bonificacao]), false);
  await assert.rejects(lancar(db, bonificacao, { condicao: 'no_ato', forma: 'pix' }), /nao tem valor a pagar/);
});

test('arredondamento em centavos: 100,00 em 3 = 33,34 + 33,33 + 33,33 aceito; 33,33 x 3 recusado', async () => {
  const db = await banco();
  const pedido = await criarPedido(db, { itens: [{ descricao: 'OVOS', unidade: 'CX', quantidade_pedida: 1, valor_unitario: 100 }] });
  await receber(db, pedido, { valores: [[1, 100]] });
  const h = await hoje(db);
  await assert.rejects(lancar(db, pedido, { condicao: 'a_prazo', forma: 'pix', parcelas: [1, 2, 3].map((i) => ({ vencimento: somarDias(h, 30 * i), valor: 33.33 })) }), /99.99/);
  const conta = await lancar(db, pedido, { condicao: 'a_prazo', forma: 'pix', parcelas: [
    { vencimento: somarDias(h, 30), valor: 33.34 }, { vencimento: somarDias(h, 60), valor: 33.33 }, { vencimento: somarDias(h, 90), valor: 33.33 },
  ] });
  assert.equal((await resumo(db, conta)).valor_total, '100.00');
});

// ============================================================
// Pagamento, estorno, cancelamento, replanejamento
// ============================================================

test('pagamento com juros/multa/desconto: 1000 + 15 + 5 - 20 = 1000; equação validada; integral; sem data futura; sem pagar duas vezes', async () => {
  const db = await banco();
  const pedido = await criarPedido(db, { itens: [{ descricao: 'MANTEIGA', unidade: 'KG', quantidade_pedida: 1, valor_unitario: 1000 }] });
  await receber(db, pedido, { valores: [[1, 1000]] });
  const conta = await lancar(db, pedido, { condicao: 'a_prazo', forma: 'boleto', parcelas: [{ vencimento: somarDias(await hoje(db), 5), valor: 1000 }] });
  const [parcela] = await parcelasDe(db, conta);

  await assert.rejects(pagar(db, parcela.id, { juros: 15, multa: 5, desconto: 20, valorPago: 999 }), /nao confere/);
  await assert.rejects(pagar(db, parcela.id, { juros: -1 }), /negativos/);
  await assert.rejects(pagar(db, parcela.id, { desconto: 1000 }), /maior que zero/);
  await assert.rejects(pagar(db, parcela.id, { pagoEm: somarDias(await hoje(db), 1) }), /futuro/);
  await assert.rejects(pagar(db, parcela.id, { forma: 'cheque' }), /forma de pagamento invalida/);
  await assert.rejects(pagar(db, parcela.id, { juros: 0.001 }), /2 casas/);

  const baixa = await pagar(db, parcela.id, { forma: 'boleto', juros: 15, multa: 5, desconto: 20, valorPago: 1000, obs: 'Pago no banco' });
  const b = (await db.query('select valor_original::text, juros::text, multa::text, desconto::text, valor_pago::text, registrado_por_nome from public.contas_pagar_baixas where id = $1', [baixa])).rows[0];
  assert.deepEqual(b, { valor_original: '1000.00', juros: '15.00', multa: '5.00', desconto: '20.00', valor_pago: '1000.00', registrado_por_nome: 'ADMIN TESTE' });
  assert.equal((await resumo(db, conta)).situacao, 'paga');
  await assert.rejects(pagar(db, parcela.id), /ja esta paga/);

  // Defesa no banco (mesmo para quem escrevesse direto): valor_pago é gerado,
  // valor_original confere com a parcela e a baixa é imutável.
  await assert.rejects(db.query("update public.contas_pagar_baixas set juros = 0 where id = $1", [baixa]), /imutavel/);
  await assert.rejects(db.query('delete from public.contas_pagar_baixas where id = $1', [baixa]), /exclusao fisica/);
  await assert.rejects(db.query('update public.contas_pagar_parcelas set valor = 900 where id = $1', [parcela.id]), /parcela paga/);
  await assert.rejects(db.query('insert into public.contas_pagar_baixas (parcela_id, pago_em, forma_pagamento, valor_original, valor_pago) values ($1, current_date, $2, 1000, 1000)', [parcela.id, 'pix']), /generated column|cannot insert/i);
});

test('estorno lógico: motivo obrigatório, autoria, baixa preservada, parcela volta a pendente e pode ser paga de novo', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  await receber(db, pedido);
  const conta = await lancar(db, pedido, { condicao: 'no_ato', forma: 'dinheiro' });
  const baixa = await valor(db, 'select b.id from public.contas_pagar_baixas b join public.contas_pagar_parcelas p on p.id = b.parcela_id where p.conta_id = $1', [conta]);

  await assert.rejects(valor(db, 'select public.contas_pagar_estornar_baixa($1, $2)', [baixa, '   ']), /motivo do estorno e obrigatorio/);
  await valor(db, 'select public.contas_pagar_estornar_baixa($1, $2)', [baixa, 'Forma errada']);
  await assert.rejects(valor(db, 'select public.contas_pagar_estornar_baixa($1, $2)', [baixa, 'De novo']), /ja foi estornado/);

  const b = (await db.query('select estornado_por, estornado_por_nome, motivo_estorno, estornado_em is not null as e from public.contas_pagar_baixas where id = $1', [baixa])).rows[0];
  assert.deepEqual(b, { estornado_por: ADMIN, estornado_por_nome: 'ADMIN TESTE', motivo_estorno: 'Forma errada', e: true });
  const r = await resumo(db, conta);
  assert.equal(r.situacao, 'pendente');
  assert.equal(r.valor_pago, '0');

  const [parcela] = await parcelasDe(db, conta);
  await pagar(db, parcela.id, { forma: 'pix' });
  assert.equal(await valor(db, 'select count(*)::int from public.contas_pagar_baixas where parcela_id = $1', [parcela.id]), 2);
  assert.equal((await resumo(db, conta)).situacao, 'paga');
  assert.equal(await valor(db, "select count(*)::int from public.logs_auditoria where registro_id = $1 and acao = 'estornou_pagamento'", [conta]), 1);
});

test('cancelamento: exige estorno antes; motivo obrigatório; histórico preservado; compra volta para a fila e aceita novo lançamento', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  await receber(db, pedido);
  const conta = await lancar(db, pedido, { condicao: 'no_ato', forma: 'pix' });
  await assert.rejects(valor(db, 'select public.contas_pagar_cancelar($1, $2)', [conta, 'Erro']), /estorne/);
  const baixa = await valor(db, 'select b.id from public.contas_pagar_baixas b join public.contas_pagar_parcelas p on p.id = b.parcela_id where p.conta_id = $1', [conta]);
  await valor(db, 'select public.contas_pagar_estornar_baixa($1, $2)', [baixa, 'Lançado errado']);
  await assert.rejects(valor(db, 'select public.contas_pagar_cancelar($1, $2)', [conta, '']), /motivo do cancelamento e obrigatorio/);
  await valor(db, 'select public.contas_pagar_cancelar($1, $2)', [conta, 'Condição errada']);
  await assert.rejects(valor(db, 'select public.contas_pagar_cancelar($1, $2)', [conta, 'De novo']), /ja esta cancelada/);

  const r = await resumo(db, conta);
  assert.equal(r.situacao, 'cancelada');
  assert.equal(r.motivo_cancelamento, 'Condição errada');
  assert.equal(r.cancelada_por_nome, 'ADMIN TESTE');
  assert.equal(await valor(db, "select count(*)::int from public.contas_pagar_listar_parcelas() where conta_id = $1 and situacao = 'cancelada'", [conta]), 1);
  await assert.rejects(pagar(db, (await parcelasDe(db, conta))[0].id), /cancelada/);
  await assert.rejects(db.query("update public.contas_pagar set observacao = 'x' where id = $1", [conta]), /cancelada nao pode ser alterada/);
  await assert.rejects(db.query('delete from public.contas_pagar where id = $1', [conta]), /exclusao fisica/);

  assert.equal(await valor(db, 'select elegivel from public.contas_pagar_listar_compras_sem_lancamento() where pedido_id = $1', [pedido]), true);
  const nova = await lancar(db, pedido, { condicao: 'a_prazo', forma: 'boleto', parcelas: [{ vencimento: somarDias(await hoje(db), 20), valor: 550 }] });
  assert.notEqual(nova, conta);
  assert.equal(await valor(db, 'select count(*)::int from public.contas_pagar where pedido_id = $1', [pedido]), 2);
});

test('replanejamento: altera só parcelas pendentes, mantém a soma da compra, troca forma, audita; parcela paga não muda', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  await receberComFinanceiro(db, pedido, await aPrazo3(db));
  const conta = await valor(db, 'select id from public.contas_pagar where pedido_id = $1', [pedido]);
  const [p1, p2, p3] = await parcelasDe(db, conta);
  await pagar(db, p1.id, { forma: 'boleto' });
  const h = await hoje(db);

  const replanejar = (forma, lista) => valor(db, 'select public.contas_pagar_replanejar($1, $2, $3::jsonb)', [conta, forma, JSON.stringify(lista)]);
  await assert.rejects(replanejar(null, [{ parcela_id: p1.id, vencimento: h, valor: 183.34 }, { parcela_id: p2.id, vencimento: h, valor: 183.33 }, { parcela_id: p3.id, vencimento: h, valor: 183.33 }]), /exatamente as parcelas ainda nao pagas/);
  await assert.rejects(replanejar(null, [{ parcela_id: p2.id, vencimento: h, valor: 183.33 }]), /exatamente as parcelas ainda nao pagas/);
  await assert.rejects(replanejar(null, [{ parcela_id: p2.id, vencimento: h, valor: 200 }, { parcela_id: p3.id, vencimento: h, valor: 183.33 }]), /continuar igual ao total da compra/);
  await assert.rejects(replanejar('cartao_credito', [{ parcela_id: p2.id, vencimento: h, valor: 183.33 }, { parcela_id: p3.id, vencimento: h, valor: 183.33 }]), /cartao/);

  await replanejar('pix', [{ parcela_id: p2.id, vencimento: somarDias(h, 15), valor: 300 }, { parcela_id: p3.id, vencimento: somarDias(h, 45), valor: 66.66 }]);
  const depois = await parcelasDe(db, conta);
  assert.deepEqual(depois.map((p) => p.valor), ['183.34', '300.00', '66.66']);
  assert.equal(depois[0].vencimento, p1.vencimento);
  assert.equal((await resumo(db, conta)).forma_prevista, 'pix');
  assert.equal(await valor(db, "select count(*)::int from public.logs_auditoria where registro_id = $1 and acao = 'replanejou'", [conta]), 5);
});

// ============================================================
// Proteções da compra com financeiro ativo
// ============================================================

test('reabrir recebimento com financeiro ativo é bloqueado; depois de cancelar o financeiro, reabre e limpa data_recebimento', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  await receberComFinanceiro(db, pedido, await aPrazo3(db));
  await assert.rejects(valor(db, 'select (public.reabrir_recebimento_pedido($1)).status', [pedido]), /lancamento financeiro ativo/);
  assert.equal(await valor(db, 'select status from public.pedidos where id = $1', [pedido]), 'recebido');

  const conta = await valor(db, 'select id from public.contas_pagar where pedido_id = $1', [pedido]);
  await valor(db, 'select public.contas_pagar_cancelar($1, $2)', [conta, 'Reabrir recebimento']);
  assert.equal(await valor(db, 'select (public.reabrir_recebimento_pedido($1)).status', [pedido]), 'aguardando_entrega');
  assert.equal(await valor(db, 'select data_recebimento from public.pedidos where id = $1', [pedido]), null);

  // Pedido com histórico financeiro (conta cancelada) não pode ser excluído.
  await assert.rejects(valor(db, 'select public.excluir_pedido($1)', [pedido]), /historico no Financeiro/);
  // Recebe de novo e lança outra vez normalmente.
  await receberComFinanceiro(db, pedido, { condicao: 'no_ato', forma: 'pix' });
  assert.equal(await valor(db, "select count(*)::int from public.contas_pagar where pedido_id = $1 and status = 'ativa'", [pedido]), 1);
});

test('defesa no commit: qualquer escrita que deixe a soma das parcelas diferente do total da compra é desfeita', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  await receberComFinanceiro(db, pedido, await aPrazo3(db));
  const conta = await valor(db, 'select id from public.contas_pagar where pedido_id = $1', [pedido]);
  const [, p2] = await parcelasDe(db, conta);
  // Escrita direta (fora das RPCs) numa parcela pendente: a trigger de
  // imutabilidade deixa (parcela não paga), mas a verificação deferida não.
  await assert.rejects(db.query('update public.contas_pagar_parcelas set valor = 1 where id = $1', [p2.id]), /diverge da soma das parcelas/);
  assert.equal((await parcelasDe(db, conta))[1].valor, '183.33');
  // Conta sem parcela não sobrevive ao commit.
  await assert.rejects(db.query("insert into public.contas_pagar (origem, pedido_id, condicao, forma_prevista) values ('compra', $1, 'a_prazo', 'pix')", [await criarPedido(db)]), /ao menos uma parcela|precisa permanecer recebida/);
  // Pedido recebido sem financeiro não precisa de nada.
  assert.equal(await valor(db, 'select count(*)::int from public.contas_pagar'), 1);
});

// Correção de compra presencial (0037 -> 0051 -> 0073, seção 12b).
const JANELA = 'pedidos.compra_presencial_em_edicao';

const itensDe = (db, pedidoId) =>
  db.query(`select id, descricao, quantidade_pedida::text q, valor_unitario::text v, unidade,
      quantidade_recebida::text qr, valor_unitario_recebido::text vr, unidade_recebida ur, quantidade_sacos_recebidos s
    from public.pedido_itens where pedido_id = $1 order by descricao`, [pedidoId]).then((r) => r.rows);

async function editarPresencial(db, pedidoId, { fornecedor = FORNECEDOR_B, itens, nf = 'NF 123', obs = null } = {}) {
  return valor(db, `select (public.editar_compra_presencial($1, $2, $3::date, $4, null, $5, $6::jsonb)).id`,
    [pedidoId, fornecedor, await hoje(db), nf, obs, JSON.stringify(itens)]);
}

// Executa SQL dentro de uma transação explícita e desfaz no fim (ou deixa
// o COMMIT acontecer, quando commit = true).
async function emTransacao(db, sqls, { commit = false } = {}) {
  await db.exec('begin');
  try {
    for (const [sql, params] of sqls) await db.query(sql, params ?? []);
    if (commit) await db.exec('commit');
  } finally {
    await db.exec('rollback').catch(() => {});
  }
}

const DOIS_ITENS = [
  { descricao: 'LEITE', unidade: 'UN', quantidade_pedida: 10, valor_unitario: 55 },
  { descricao: 'OVOS', unidade: 'DZ', quantidade_pedida: 2, valor_unitario: 30 },
];

test('correção presencial SEM financeiro: fornecedor, itens (incluir/alterar/remover) e valores são editados; janela fechada ao final; auditado', async () => {
  const db = await banco();
  const pedido = await presencial(db, { itens: DOIS_ITENS });
  assert.equal(await valor(db, 'select contas_pagar_total_compra($1)::text', [pedido]), '610.00');
  const [leite] = await itensDe(db, pedido);

  // Dentro de uma transação explícita para provar que a janela fecha antes
  // do fim da própria transação (não vaza para a próxima instrução).
  await db.exec('begin');
  await editarPresencial(db, pedido, {
    fornecedor: FORNECEDOR_A,
    nf: 'NF 999',
    obs: 'corrigido',
    itens: [
      { pedido_item_id: leite.id, descricao: 'LEITE INTEGRAL', unidade: 'UN', quantidade_pedida: 12, valor_unitario: 50 },
      { descricao: 'MANTEIGA', unidade: 'KG', quantidade_pedida: 3, valor_unitario: 20 },
    ],
  });
  assert.equal(await valor(db, `select coalesce(current_setting('${JANELA}', true), '')`), '');
  await db.exec('commit');

  const p = (await db.query('select status, fornecedor_id, numero_nota_fiscal, observacoes, modalidade_compra, data_recebimento from public.pedidos where id = $1', [pedido])).rows[0];
  assert.deepEqual(p, { status: 'recebido', fornecedor_id: FORNECEDOR_A, numero_nota_fiscal: 'NF 999', observacoes: 'corrigido', modalidade_compra: 'compra_presencial', data_recebimento: null });
  // Itens: o novo entrou, o alterado mudou, o removido (OVOS) saiu; campos
  // recebidos = pedidos; sem sacos.
  const itens = (await db.query(`select descricao, unidade, quantidade_pedida::float8 q, valor_unitario::float8 v,
      quantidade_pedida = quantidade_recebida iguais_q, valor_unitario = valor_unitario_recebido iguais_v,
      unidade = unidade_recebida iguais_u, quantidade_sacos_recebidos s
    from public.pedido_itens where pedido_id = $1 order by descricao`, [pedido])).rows;
  assert.deepEqual(itens, [
    { descricao: 'LEITE INTEGRAL', unidade: 'UN', q: 12, v: 50, iguais_q: true, iguais_v: true, iguais_u: true, s: null },
    { descricao: 'MANTEIGA', unidade: 'KG', q: 3, v: 20, iguais_q: true, iguais_v: true, iguais_u: true, s: null },
  ]);
  assert.equal((await itensDe(db, pedido)).find((i) => i.descricao === 'LEITE INTEGRAL').id, leite.id);
  assert.equal(await valor(db, 'select contas_pagar_total_compra($1)::text', [pedido]), '660.00');
  assert.equal(await valor(db, "select count(*)::int from public.logs_auditoria where entidade = 'pedido' and registro_id = $1 and acao = 'compra_presencial_editada'", [pedido]), 1);
  // Continua sem financeiro e aparece na fila com o total novo.
  const fila = (await db.query('select total::text, fornecedor_nome from public.contas_pagar_listar_compras_sem_lancamento() where pedido_id = $1', [pedido])).rows;
  assert.deepEqual(fila, [{ total: '660.00', fornecedor_nome: 'MOINHO A' }]);
  // Sem pedidos.editar a RPC continua recusada.
  await como(db, FINANCEIRO);
  await assert.rejects(editarPresencial(db, pedido, { itens: [{ descricao: 'X', unidade: 'UN', quantidade_pedida: 1, valor_unitario: 1 }] }), negado);
});

test('correção presencial: escrita DIRETA em pedido_itens continua bloqueada (API, contexto elevado sem janela, janela de outro pedido, item incoerente, sem pedidos.editar)', async () => {
  const db = await banco();
  const pedido = await presencial(db, { itens: DOIS_ITENS });
  const outro = await presencial(db);
  const entrega = await criarPedido(db);
  await receber(db, entrega);
  const [leite, ovos] = await itensDe(db, pedido);
  const itemEntrega = (await itensDe(db, entrega))[0];
  const antes = JSON.stringify([await itensDe(db, pedido), await itensDe(db, entrega)]);

  const coerente = 'update public.pedido_itens set quantidade_pedida = 11, quantidade_recebida = 11 where id = $1';
  const inserir = "insert into public.pedido_itens (pedido_id, descricao, quantidade_pedida, unidade, valor_unitario, unidade_recebida, quantidade_recebida, valor_unitario_recebido) values ($1, 'NOVO', 1, 'UN', 1, 'UN', 1, 1)";
  const remover = 'delete from public.pedido_itens where id = $1';

  // 1) Pela API (papel authenticated, quem tem pedidos.editar): bloqueado.
  await como(db, ADMIN);
  await db.exec('set role authenticated');
  try {
    await assert.rejects(db.query(coerente, [leite.id]), /nao e possivel alterar item/);
    await assert.rejects(db.query(inserir, [pedido]), /nao e possivel inserir item/);
    await assert.rejects(db.query(remover, [ovos.id]), /nao e possivel remover item/);
  } finally {
    await db.exec('reset role');
  }

  // 2) Contexto elevado (papel com BYPASSRLS, como dentro de QUALQUER função
  //    SECURITY DEFINER) mas SEM a janela de editar_compra_presencial:
  //    bloqueado -- o gate não depende de rolbypassrls (o da 0037 dependia,
  //    e dentro de uma trigger SECURITY DEFINER ele é sempre verdadeiro).
  assert.equal(await valor(db, 'select rolbypassrls from pg_roles where rolname = current_user'), true);
  await assert.rejects(db.query(coerente, [leite.id]), /nao e possivel alterar item/);
  await assert.rejects(db.query(inserir, [pedido]), /nao e possivel inserir item/);
  await assert.rejects(db.query(remover, [ovos.id]), /nao e possivel remover item/);

  // 3) Janela aberta para OUTRO pedido: não vale para este.
  await assert.rejects(emTransacao(db, [[`select set_config('${JANELA}', $1, true)`, [outro]], [coerente, [leite.id]]]), /nao e possivel alterar item/);
  await assert.rejects(emTransacao(db, [[`select set_config('${JANELA}', $1, true)`, [outro]], [inserir, [pedido]]]), /nao e possivel inserir item/);

  // 4) Janela do próprio pedido, mas item incoerente com o que a RPC grava.
  const abrir = [`select set_config('${JANELA}', $1, true)`, [pedido]];
  await assert.rejects(emTransacao(db, [abrir, ['update public.pedido_itens set quantidade_pedida = 11 where id = $1', [leite.id]]]), /campos recebidos iguais aos pedidos/);
  await assert.rejects(emTransacao(db, [abrir, ['update public.pedido_itens set valor_unitario_recebido = 1 where id = $1', [leite.id]]]), /campos recebidos iguais aos pedidos/);
  await assert.rejects(emTransacao(db, [abrir, ['update public.pedido_itens set quantidade_sacos_recebidos = 1 where id = $1', [leite.id]]]), /campos recebidos iguais aos pedidos/);
  await assert.rejects(emTransacao(db, [abrir, ["insert into public.pedido_itens (pedido_id, descricao, quantidade_pedida, unidade, valor_unitario, unidade_recebida, quantidade_recebida, valor_unitario_recebido) values ($1, 'NOVO', 1, 'UN', 1, 'UN', 2, 1)", [pedido]]]), /campos recebidos iguais aos pedidos/);
  // Imutáveis continuam imutáveis mesmo dentro da janela.
  await assert.rejects(emTransacao(db, [abrir, ['update public.pedido_itens set pedido_id = $2 where id = $1', [leite.id, outro]]]), /pedido_id e imutavel/);

  // 5) Janela do próprio pedido, mas usuário sem pedidos.editar.
  await como(db, FINANCEIRO);
  await assert.rejects(emTransacao(db, [abrir, [coerente, [leite.id]]]), /nao e possivel alterar item/);
  await como(db, ADMIN);

  // 6) Janela com o id de um pedido COM ENTREGA recebido: não é compra
  //    presencial, segue a regra da 0051 (só limpar na reabertura).
  await assert.rejects(emTransacao(db, [[`select set_config('${JANELA}', $1, true)`, [entrega]], [coerente, [itemEntrega.id]]]), /nao e possivel alterar item/);
  await assert.rejects(emTransacao(db, [[`select set_config('${JANELA}', $1, true)`, [entrega]], [inserir, [entrega]]]), /nao e possivel inserir item/);

  // Nada mudou; a função de gate não é executável pela API.
  assert.equal(JSON.stringify([await itensDe(db, pedido), await itensDe(db, entrega)]), antes);
  for (const papel of ['authenticated', 'anon', 'service_role']) {
    assert.equal(await valor(db, "select has_function_privilege($1, 'public.pedido_itens_correcao_presencial_autorizada(uuid)', 'EXECUTE')", [papel]), false, papel);
  }
});

test('fluxo: presencial -> editar antes do financeiro -> lançar -> total/fornecedor bloqueados -> alteração sem impacto financeiro segue coerente', async () => {
  const db = await banco();
  const pedido = await presencial(db); // LEITE 10 x 55 = 550, fornecedor B
  const [leite] = await itensDe(db, pedido);
  const h = await hoje(db);

  // 1) Editar ANTES do financeiro: muda o total livremente.
  await editarPresencial(db, pedido, { itens: [{ pedido_item_id: leite.id, descricao: 'LEITE', unidade: 'UN', quantidade_pedida: 12, valor_unitario: 55 }] });
  assert.equal(await valor(db, 'select contas_pagar_total_compra($1)::text', [pedido]), '660.00');

  // 2) Lançar o financeiro a prazo com o total novo.
  const conta = await lancar(db, pedido, { condicao: 'a_prazo', forma: 'boleto', parcelas: [
    { vencimento: somarDias(h, 15), valor: 330 }, { vencimento: somarDias(h, 45), valor: 330 },
  ] });
  const parcelasAntes = await parcelasDe(db, conta);

  // 3) Com financeiro ativo: total e fornecedor incompatíveis bloqueados.
  const so = (q, v, extra = []) => [{ pedido_item_id: leite.id, descricao: 'LEITE', unidade: 'UN', quantidade_pedida: q, valor_unitario: v }, ...extra];
  await assert.rejects(editarPresencial(db, pedido, { itens: so(13, 55) }), /diverge da soma das parcelas/);
  await assert.rejects(editarPresencial(db, pedido, { itens: so(12, 55, [{ descricao: 'SAL', unidade: 'KG', quantidade_pedida: 1, valor_unitario: 2 }]) }), /diverge da soma das parcelas/);
  await assert.rejects(editarPresencial(db, pedido, { fornecedor: FORNECEDOR_A, itens: so(12, 55) }), /fornecedor nao pode ser alterado/);
  // Qualquer outro caminho de escrita que passe pela trigger dos itens
  // (simulado abrindo a janela à mão) também é desfeito no COMMIT.
  await assert.rejects(emTransacao(db, [
    [`select set_config('${JANELA}', $1, true)`, [pedido]],
    ['update public.pedido_itens set valor_unitario = 99, valor_unitario_recebido = 99 where id = $1', [leite.id]],
  ], { commit: true }), /diverge da soma das parcelas/);
  assert.equal(await valor(db, 'select contas_pagar_total_compra($1)::text', [pedido]), '660.00');
  assert.equal(await valor(db, 'select fornecedor_id from public.pedidos where id = $1', [pedido]), FORNECEDOR_B);

  // 4) Alteração SEM impacto financeiro (mesmo fornecedor, mesmo total):
  //    descrição, quantidade x preço com o mesmo total, nota e observação.
  await editarPresencial(db, pedido, { nf: 'NF 777', obs: 'ajuste', itens: [{ pedido_item_id: leite.id, descricao: 'LEITE INTEGRAL', unidade: 'CX', quantidade_pedida: 6, valor_unitario: 110 }] });
  assert.equal(await valor(db, 'select contas_pagar_total_compra($1)::text', [pedido]), '660.00');
  const r = await resumo(db, conta);
  assert.equal(r.situacao, 'pendente');
  assert.equal(r.valor_total, '660.00');
  assert.equal(r.numero_nota_fiscal, 'NF 777');
  assert.equal(r.credor_exibicao, 'MERCADO B');
  assert.deepEqual(await parcelasDe(db, conta), parcelasAntes);

  // 5) Depois de pagar uma parcela, a regra continua a mesma.
  await pagar(db, parcelasAntes[0].id);
  await editarPresencial(db, pedido, { itens: [{ pedido_item_id: leite.id, descricao: 'LEITE DESNATADO', unidade: 'CX', quantidade_pedida: 6, valor_unitario: 110 }] });
  await assert.rejects(editarPresencial(db, pedido, { itens: [{ pedido_item_id: leite.id, descricao: 'LEITE', unidade: 'CX', quantidade_pedida: 7, valor_unitario: 110 }] }), /diverge da soma das parcelas/);
  assert.equal((await resumo(db, conta)).situacao, 'parcial');

  // 6) Cancelando o financeiro (estorno antes), a edição volta a ser livre.
  const baixa = await valor(db, 'select b.id from public.contas_pagar_baixas b where b.parcela_id = $1 and b.estornado_em is null', [parcelasAntes[0].id]);
  await valor(db, 'select public.contas_pagar_estornar_baixa($1, $2)', [baixa, 'Corrigir compra']);
  await valor(db, 'select public.contas_pagar_cancelar($1, $2)', [conta, 'Corrigir compra']);
  await editarPresencial(db, pedido, { fornecedor: FORNECEDOR_A, itens: [{ pedido_item_id: leite.id, descricao: 'LEITE', unidade: 'CX', quantidade_pedida: 7, valor_unitario: 110 }] });
  assert.equal(await valor(db, 'select contas_pagar_total_compra($1)::text', [pedido]), '770.00');
});

test('compra presencial paga no ato: edição sem impacto passa; total/fornecedor bloqueados; recebimento normal não regrediu', async () => {
  const db = await banco();
  const pedido = await presencial(db, { fin: { condicao: 'no_ato', forma: 'pix' } });
  const [leite] = await itensDe(db, pedido);
  const item = (q, v, d = 'LEITE') => [{ pedido_item_id: leite.id, descricao: d, unidade: 'UN', quantidade_pedida: q, valor_unitario: v }];
  await assert.rejects(editarPresencial(db, pedido, { itens: item(11, 55) }), /diverge da soma das parcelas/);
  await assert.rejects(editarPresencial(db, pedido, { fornecedor: FORNECEDOR_A, itens: item(10, 55) }), /fornecedor nao pode ser alterado/);
  await editarPresencial(db, pedido, { itens: item(5, 110, 'LEITE INTEGRAL') });
  const conta = await valor(db, 'select id from public.contas_pagar where pedido_id = $1', [pedido]);
  assert.equal((await resumo(db, conta)).situacao, 'paga');

  // Recebimento normal (pedido com entrega) com e sem financeiro, e
  // reabertura sem financeiro, seguem iguais.
  const p1 = await criarPedido(db);
  assert.equal(await receber(db, p1), 'recebido');
  assert.equal(await valor(db, 'select (public.reabrir_recebimento_pedido($1)).status', [p1]), 'aguardando_entrega');
  assert.deepEqual((await itensDe(db, p1)).map((i) => [i.qr, i.vr, i.ur]), [[null, null, null], [null, null, null]]);
  assert.equal(await receberComFinanceiro(db, p1, await aPrazo3(db)), 'recebido');
});

// Reabertura de recebimento (0027 -> 0051/0052 -> 0073, seção 12b).
const JANELA_REABERTURA = 'pedidos.reabertura_recebimento_em_curso';
const LIMPAR = 'update public.pedido_itens set unidade_recebida = null, quantidade_recebida = null, valor_unitario_recebido = null, quantidade_sacos_recebidos = null where pedido_id = $1';
const abrirReabertura = (pedidoId) => [`select set_config('${JANELA_REABERTURA}', $1, true)`, [pedidoId]];
const reabrir = (db, pedidoId) => valor(db, 'select (public.reabrir_recebimento_pedido($1)).status', [pedidoId]);
const recebidos = (db, pedidoId) =>
  db.query(`select unidade_recebida ur, quantidade_recebida::float8 qr, valor_unitario_recebido::float8 vr, quantidade_sacos_recebidos s
    from public.pedido_itens where pedido_id = $1 order by descricao`, [pedidoId]).then((r) => r.rows);

test('reabertura autorizada (pedido com entrega): limpa os campos recebidos, volta a aguardando, fecha a janela; recebe de novo', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  await receber(db, pedido);
  assert.deepEqual(await recebidos(db, pedido), [
    { ur: 'KG', qr: 10, vr: 50, s: null },
    { ur: 'KG', qr: 2, vr: 25, s: null },
  ]);

  await db.exec('begin');
  assert.equal(await reabrir(db, pedido), 'aguardando_entrega');
  // G) janela fechada ainda dentro da própria transação.
  assert.equal(await valor(db, `select coalesce(current_setting('${JANELA_REABERTURA}', true), '')`), '');
  await db.exec('commit');

  // B) os 4 campos de recebimento limpos; status, recebido_em e data_recebimento coerentes; auditado.
  assert.deepEqual(await recebidos(db, pedido), [
    { ur: null, qr: null, vr: null, s: null },
    { ur: null, qr: null, vr: null, s: null },
  ]);
  const p = (await db.query('select status, recebido_em, data_recebimento from public.pedidos where id = $1', [pedido])).rows[0];
  assert.deepEqual(p, { status: 'aguardando_entrega', recebido_em: null, data_recebimento: null });
  assert.equal(await valor(db, "select count(*)::int from public.logs_auditoria where entidade = 'pedido' and registro_id = $1 and acao = 'pedido_recebimento_reaberto'", [pedido]), 1);

  // H) recebimento normal depois da reabertura, com outros valores.
  assert.equal(await receber(db, pedido, { valores: [[10, 48], [2, 25]] }), 'recebido');
  assert.equal(await valor(db, 'select contas_pagar_total_compra($1)::text', [pedido]), '530.00');

  // F) sem pedidos.reabrir_recebimento a RPC recusa.
  await como(db, FINANCEIRO);
  await assert.rejects(reabrir(db, pedido), negado);
  await como(db, ADMIN);
});

test('reabertura: escrita direta bloqueada; janela manual não basta; janela de outro pedido e sem permissão não funcionam', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  await receber(db, pedido);
  const outro = await criarPedido(db);
  await receber(db, outro);
  const antes = JSON.stringify([await recebidos(db, pedido), await recebidos(db, outro)]);
  const statusDe = (id) => valor(db, 'select status from public.pedidos where id = $1', [id]);

  // C) pela API (authenticated, com pedidos.editar + pedidos.reabrir_recebimento): bloqueado.
  await como(db, ADMIN);
  await db.exec('set role authenticated');
  try {
    await assert.rejects(db.query(LIMPAR, [pedido]), /nao e possivel alterar item/);
  } finally {
    await db.exec('reset role');
  }
  // C) contexto elevado (BYPASSRLS, como em qualquer SECURITY DEFINER) sem
  //    a janela: bloqueado -- o gate não é mais rolbypassrls.
  assert.equal(await valor(db, 'select rolbypassrls from pg_roles where rolname = current_user'), true);
  await assert.rejects(db.query(LIMPAR, [pedido]), /nao e possivel alterar item/);

  // D) set_config manual feito pelo próprio usuário da API: a trigger deixa
  //    limpar (mesma alteração que a RPC faz), mas sem a transição de status
  //    -- que pedidos_protecao só permite dentro da RPC -- o COMMIT desfaz.
  await assert.rejects(emTransacao(db, [['set local role authenticated'], abrirReabertura(pedido), [LIMPAR, [pedido]]], { commit: true }),
    /campos de recebimento limpos sem reabrir/);
  await assert.rejects(emTransacao(db, [['set local role authenticated'], abrirReabertura(pedido),
    ["update public.pedidos set status = 'aguardando_entrega' where id = $1", [pedido]]]), /so pode ser feita via reabrir_recebimento_pedido/);
  // D) com a janela manual, nada além de limpar os 4 campos é aceito.
  await assert.rejects(emTransacao(db, [['set local role authenticated'], abrirReabertura(pedido),
    ['update public.pedido_itens set valor_unitario_recebido = 1 where pedido_id = $1', [pedido]]]), /deve limpar os campos de recebimento/);
  await assert.rejects(emTransacao(db, [['set local role authenticated'], abrirReabertura(pedido),
    ['update public.pedido_itens set valor_unitario = 1, unidade_recebida = null, quantidade_recebida = null, valor_unitario_recebido = null where pedido_id = $1', [pedido]]]),
    /so pode limpar os campos de recebimento/);
  await assert.rejects(emTransacao(db, [['set local role authenticated'], abrirReabertura(pedido),
    ["insert into public.pedido_itens (pedido_id, descricao, quantidade_pedida, unidade, valor_unitario) values ($1, 'X', 1, 'UN', 1)", [pedido]]]), /nao e possivel inserir item/);
  await assert.rejects(emTransacao(db, [['set local role authenticated'], abrirReabertura(pedido),
    ['delete from public.pedido_itens where pedido_id = $1', [pedido]]]), /nao e possivel remover item/);

  // E) janela aberta para OUTRO pedido.
  await assert.rejects(emTransacao(db, [abrirReabertura(outro), [LIMPAR, [pedido]]]), /nao e possivel alterar item/);
  // A janela de correção presencial não serve para reabertura.
  await assert.rejects(emTransacao(db, [[`select set_config('${JANELA}', $1, true)`, [pedido]], [LIMPAR, [pedido]]]), /nao e possivel alterar item/);

  // F) janela do próprio pedido, mas usuário sem pedidos.reabrir_recebimento.
  await como(db, FINANCEIRO);
  await assert.rejects(emTransacao(db, [abrirReabertura(pedido), [LIMPAR, [pedido]]]), /nao e possivel alterar item/);
  await como(db, ADMIN);

  assert.equal(JSON.stringify([await recebidos(db, pedido), await recebidos(db, outro)]), antes);
  assert.deepEqual([await statusDe(pedido), await statusDe(outro)], ['recebido', 'recebido']);
  for (const papel of ['authenticated', 'anon', 'service_role']) {
    for (const fn of ['pedido_itens_reabertura_autorizada(uuid)', 'pedido_itens_reabertura_coerente()']) {
      assert.equal(await valor(db, 'select has_function_privilege($1, $2, \'EXECUTE\')', [papel, `public.${fn}`]), false, `${papel} ${fn}`);
    }
  }
});

test('compra presencial NUNCA reabre: sem financeiro, a prazo e paga no ato -- erro explícito, nada muda', async () => {
  const db = await banco();
  const h = await hoje(db);
  const casos = [
    await presencial(db),
    await presencial(db, { fin: { condicao: 'a_prazo', forma: 'pix', parcelas: [{ vencimento: somarDias(h, 10), valor: 550 }] } }),
    await presencial(db, { fin: { condicao: 'no_ato', forma: 'dinheiro' } }),
  ];
  const antes = await fotografia(db);
  for (const pedido of casos) {
    const itensAntes = JSON.stringify(await recebidos(db, pedido));
    await assert.rejects(reabrir(db, pedido), /compra presencial nao tem recebimento para reabrir .* use editar_compra_presencial/);
    assert.equal(await valor(db, 'select status from public.pedidos where id = $1', [pedido]), 'recebido');
    assert.equal(JSON.stringify(await recebidos(db, pedido)), itensAntes);
    // Nem com a janela de reabertura aberta à mão os itens podem ser limpos.
    await assert.rejects(emTransacao(db, [abrirReabertura(pedido), [LIMPAR, [pedido]]]), /nao e possivel alterar item/);
  }
  assert.deepEqual(await fotografia(db), antes);
  // Cancelar o financeiro não muda nada: continua não reabrindo.
  const conta = await valor(db, 'select id from public.contas_pagar where pedido_id = $1', [casos[1]]);
  await valor(db, 'select public.contas_pagar_cancelar($1, $2)', [conta, 'Teste']);
  await assert.rejects(reabrir(db, casos[1]), /compra presencial nao tem recebimento para reabrir/);
});

test('fluxo PEDIDO NORMAL: receber -> reabrir -> receber de novo -> lançar financeiro -> tentativas incompatíveis protegidas', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  await receber(db, pedido);
  assert.equal(await reabrir(db, pedido), 'aguardando_entrega');
  assert.equal(await receber(db, pedido, { valores: [[10, 50], [4, 25]] }), 'recebido'); // 600,00
  const h = await hoje(db);
  const conta = await lancar(db, pedido, { condicao: 'a_prazo', forma: 'boleto', parcelas: [
    { vencimento: somarDias(h, 20), valor: 300 }, { vencimento: somarDias(h, 50), valor: 300 },
  ] });
  // I) reabrir com financeiro ativo: recusado, nada muda.
  await assert.rejects(reabrir(db, pedido), /lancamento financeiro ativo/);
  // I) janela de reabertura aberta à mão + limpeza: desfeita no COMMIT.
  await assert.rejects(emTransacao(db, [abrirReabertura(pedido), [LIMPAR, [pedido]]], { commit: true }),
    /campos de recebimento limpos sem reabrir|sem valores recebidos completos|diverge/);
  assert.equal(await valor(db, 'select status from public.pedidos where id = $1', [pedido]), 'recebido');
  assert.equal(await valor(db, 'select contas_pagar_total_compra($1)::text', [pedido]), '600.00');
  assert.equal((await resumo(db, conta)).situacao, 'pendente');
  // Depois de cancelar o financeiro, a reabertura legítima volta a funcionar.
  await valor(db, 'select public.contas_pagar_cancelar($1, $2)', [conta, 'Corrigir recebimento']);
  assert.equal(await reabrir(db, pedido), 'aguardando_entrega');
});

test('fluxo COMPRA PRESENCIAL: registrar -> editar -> lançar -> editar só sem impacto -> reabrir recusado sempre', async () => {
  const db = await banco();
  const pedido = await presencial(db); // 550
  const [leite] = await itensDe(db, pedido);
  const item = (q, v, d = 'LEITE') => [{ pedido_item_id: leite.id, descricao: d, unidade: 'UN', quantidade_pedida: q, valor_unitario: v }];
  await editarPresencial(db, pedido, { itens: item(12, 50) }); // 600
  await assert.rejects(reabrir(db, pedido), /compra presencial nao tem recebimento para reabrir/);
  const conta = await lancar(db, pedido, { condicao: 'a_prazo', forma: 'pix', parcelas: [{ vencimento: somarDias(await hoje(db), 30), valor: 600 }] });
  await editarPresencial(db, pedido, { itens: item(6, 100, 'LEITE INTEGRAL') });
  await assert.rejects(editarPresencial(db, pedido, { itens: item(7, 100) }), /diverge da soma das parcelas/);
  await assert.rejects(editarPresencial(db, pedido, { fornecedor: FORNECEDOR_A, itens: item(6, 100) }), /fornecedor nao pode ser alterado/);
  await assert.rejects(reabrir(db, pedido), /compra presencial nao tem recebimento para reabrir/);
  assert.equal((await resumo(db, conta)).valor_total, '600.00');
  assert.equal(await valor(db, 'select status from public.pedidos where id = $1', [pedido]), 'recebido');
});

// ============================================================
// Despesas manuais e categorias
// ============================================================

test('despesa manual a prazo: maiúsculas, credor livre, competência no mês, várias parcelas; aparece nas mesmas visões', async () => {
  const db = await banco();
  const h = await hoje(db);
  const conta = await criarManual(db, { parcelas: [{ vencimento: somarDias(h, 5), valor: 1200 }, { vencimento: somarDias(h, 35), valor: 1300 }] });
  const r = await resumo(db, conta);
  assert.equal(r.descricao, 'ALUGUEL DA LOJA');
  assert.equal(r.credor_exibicao, 'IMOBILIÁRIA SÃO JOSÉ');
  assert.equal(r.categoria_nome, 'ALUGUEL');
  assert.equal(dia(r.competencia), '2026-10-01');
  assert.equal(r.origem, 'manual');
  assert.equal(r.valor_total, '2500.00');
  assert.equal(r.observacao, 'Contrato 2026');
  assert.equal(await valor(db, "select count(*)::int from public.contas_pagar_listar_parcelas() where conta_id = $1 and situacao = 'pendente'", [conta]), 2);
});

test('despesa manual: fornecedor cadastrado OU credor livre; categoria/fornecedor ativos; no ato já nasce paga', async () => {
  const db = await banco();
  const comFornecedor = await criarManual(db, { fornecedor: FORNECEDOR_A, credor: null });
  assert.equal((await resumo(db, comFornecedor)).credor_exibicao, 'MOINHO A');

  await assert.rejects(criarManual(db, { fornecedor: FORNECEDOR_A }), /OU o credor livre/);
  await assert.rejects(criarManual(db, { credor: '  ' }), /informe o fornecedor ou o credor/);
  await assert.rejects(criarManual(db, { fornecedor: FORNECEDOR_INATIVO, credor: null }), /fornecedor inexistente ou inativo/);
  await assert.rejects(criarManual(db, { descricao: ' ' }), /descricao obrigatoria/);
  await assert.rejects(criarManual(db, { competencia: null }), /competencia obrigatoria/);
  await assert.rejects(criarManual(db, { forma: 'cartao_debito' }), /cartao e sempre pago no ato/);

  const outras = await valor(db, "select id from public.contas_pagar_categorias where nome = 'OUTRAS DESPESAS'");
  await valor(db, 'select public.contas_pagar_definir_categoria_ativa($1, false)', [outras]);
  await assert.rejects(criarManual(db, { categoria: outras }), /categoria inexistente ou inativa/);

  const h = await hoje(db);
  const paga = await criarManual(db, { condicao: 'no_ato', forma: 'dinheiro', parcelas: [{ valor: 180.5 }], pagoEm: somarDias(h, -2), descricao: 'Conserto da masseira', credor: 'joão eletricista' });
  const r = await resumo(db, paga);
  assert.equal(r.situacao, 'paga');
  assert.equal(r.valor_pago, '180.50');
  assert.equal(await valor(db, 'select b.pago_em::text from public.contas_pagar_baixas b join public.contas_pagar_parcelas p on p.id = b.parcela_id where p.conta_id = $1', [paga]), somarDias(h, -2));
  await assert.rejects(criarManual(db, { condicao: 'no_ato', forma: 'pix', parcelas: [{ valor: 1 }, { valor: 2 }] }), /exatamente uma parcela/);
});

test('editar conta: manual altera cabeçalho com auditoria por campo; compra só observação; total manual muda pelo replanejamento', async () => {
  const db = await banco();
  const conta = await criarManual(db);
  const energia = await valor(db, "select id from public.contas_pagar_categorias where nome = 'ENERGIA'");
  await valor(db, 'select public.contas_pagar_editar_conta($1, $2, $3, null, $4, $5::date, $6)', [conta, 'conta de luz', energia, 'distribuidora x', '2026-09-20', null]);
  const r = await resumo(db, conta);
  assert.equal(r.descricao, 'CONTA DE LUZ');
  assert.equal(r.categoria_nome, 'ENERGIA');
  assert.equal(dia(r.competencia), '2026-09-01');
  assert.equal(r.observacao, null);
  assert.equal(await valor(db, "select count(*)::int from public.logs_auditoria where registro_id = $1 and acao = 'editou'", [conta]), 5);

  const [p] = await parcelasDe(db, conta);
  await valor(db, 'select public.contas_pagar_replanejar($1, null, $2::jsonb)', [conta, JSON.stringify([{ parcela_id: p.id, vencimento: p.vencimento, valor: 2650.9 }])]);
  assert.equal((await resumo(db, conta)).valor_total, '2650.90');
  assert.equal(await valor(db, "select valor_novo from public.logs_auditoria where registro_id = $1 and campo = 'total'", [conta]), '2650.90');

  const pedido = await criarPedido(db);
  await receber(db, pedido);
  const contaCompra = await lancar(db, pedido, { condicao: 'no_ato', forma: 'pix' });
  await assert.rejects(valor(db, 'select public.contas_pagar_editar_conta($1, $2, null, null, null, null, null)', [contaCompra, 'X']), /so permite editar a observacao/);
  await valor(db, 'select public.contas_pagar_editar_conta($1, null, null, null, null, null, $2)', [contaCompra, 'Pago na retirada']);
  assert.equal((await resumo(db, contaCompra)).observacao, 'Pago na retirada');
});

test('categorias: criar/renomear em MAIÚSCULAS, duplicada recusada, inativar/reativar, sem exclusão; seed padrão', async () => {
  const db = await banco();
  assert.equal(await valor(db, "select string_agg(nome, ',' order by nome) from public.contas_pagar_categorias"),
    'ALUGUEL,CONTABILIDADE,ENERGIA,IMPOSTOS E TAXAS,INTERNET E TELEFONE,MANUTENÇÃO,OUTRAS DESPESAS,ÁGUA');
  const id = await valor(db, 'select public.contas_pagar_salvar_categoria(null, $1)', ['  segurança   eletrônica ']);
  assert.equal(await valor(db, 'select nome from public.contas_pagar_categorias where id = $1', [id]), 'SEGURANÇA ELETRÔNICA');
  await assert.rejects(valor(db, 'select public.contas_pagar_salvar_categoria(null, $1)', ['Segurança Eletrônica']), /ja existe/);
  await assert.rejects(valor(db, 'select public.contas_pagar_salvar_categoria(null, $1)', ['   ']), /obrigatorio/);
  await valor(db, 'select public.contas_pagar_salvar_categoria($1, $2)', [id, 'monitoramento']);
  await valor(db, 'select public.contas_pagar_definir_categoria_ativa($1, false)', [id]);
  assert.equal(await valor(db, 'select ativo from public.contas_pagar_categorias where id = $1', [id]), false);
  await assert.rejects(db.query('delete from public.contas_pagar_categorias where id = $1', [id]), /exclusao fisica/);
  assert.equal(await valor(db, "select count(*)::int from public.logs_auditoria where entidade = 'conta_pagar_categoria' and registro_id = $1", [id]), 3);
});

// ============================================================
// Usuários sem permissão
// ============================================================

test('usuários sem permissão: gestão/operacional barrados (42501); financeiro não cancela/estorna; nada gravado', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  await receber(db, pedido);
  const manual = await criarManual(db, { condicao: 'no_ato', forma: 'pix', parcelas: [{ valor: 10 }] });
  const baixa = await valor(db, 'select b.id from public.contas_pagar_baixas b join public.contas_pagar_parcelas p on p.id = b.parcela_id where p.conta_id = $1', [manual]);
  const antes = await fotografia(db);

  for (const uid of [GESTAO, OPERACIONAL, RECEBEDOR, null]) {
    await como(db, uid);
    await assert.rejects(lancar(db, pedido, { condicao: 'no_ato', forma: 'pix' }), negado);
    await assert.rejects(criarManual(db), negado);
    await assert.rejects(valor(db, 'select public.contas_pagar_estornar_baixa($1, $2)', [baixa, 'x']), negado);
    await assert.rejects(valor(db, 'select public.contas_pagar_cancelar($1, $2)', [manual, 'x']), negado);
    await assert.rejects(valor(db, 'select public.contas_pagar_salvar_categoria(null, $1)', ['X']), negado);
  }
  await como(db, FINANCEIRO);
  await assert.rejects(valor(db, 'select public.contas_pagar_estornar_baixa($1, $2)', [baixa, 'x']), negado);
  await assert.rejects(valor(db, 'select public.contas_pagar_cancelar($1, $2)', [manual, 'x']), negado);
  assert.deepEqual(await fotografia(db), antes);

  // Financeiro lança e paga normalmente.
  const conta = await lancar(db, pedido, { condicao: 'a_prazo', forma: 'boleto', parcelas: [{ vencimento: somarDias(await hoje(db), 10), valor: 550 }] });
  await pagar(db, (await parcelasDe(db, conta))[0].id, { forma: 'boleto' });
  assert.equal((await resumo(db, conta)).situacao, 'paga');
});

test('editar sem pagar: lança a prazo mas não pode registrar pagamento no ato nem pagar parcela', async () => {
  const db = await banco();
  await db.query("insert into public.usuario_permissoes (usuario_id, permissao, efeito) values ($1, 'contas_pagar.pagar', 'nega')", [FINANCEIRO]);
  const pedido = await criarPedido(db);
  await receber(db, pedido);
  await como(db, FINANCEIRO);
  await assert.rejects(lancar(db, pedido, { condicao: 'no_ato', forma: 'pix' }), negado);
  const conta = await lancar(db, pedido, { condicao: 'a_prazo', forma: 'pix', parcelas: [{ vencimento: somarDias(await hoje(db), 10), valor: 550 }] });
  await assert.rejects(pagar(db, (await parcelasDe(db, conta))[0].id), negado);
});

test('quem só recebe (pedidos.receber sem contas_pagar.editar) continua recebendo, mas não lança financeiro junto', async () => {
  const db = await banco();
  const pedido = await criarPedido(db);
  await como(db, RECEBEDOR);
  await assert.rejects(receberComFinanceiro(db, pedido, { condicao: 'no_ato', forma: 'pix' }), negado);
  assert.equal(await valor(db, 'select status from public.pedidos where id = $1', [pedido]), 'aguardando_entrega');
  assert.equal(await receber(db, pedido), 'recebido');
  await como(db, ADMIN);
  assert.equal(await valor(db, 'select elegivel and not anterior_implantacao from public.contas_pagar_listar_compras_sem_lancamento() where pedido_id = $1', [pedido]), true);
});

// ============================================================
// Data de corte, regressões, guarda, arquivos
// ============================================================

test('data de corte: compra recebida antes da 0073 fica fora da fila (anterior_implantacao), mas pode ser lançada pelo detalhe', async () => {
  const db = await novoBanco({ extras: [] });
  const antiga = await criarPedido(db);
  await receber(db, antiga);
  await aplicarMigration(db, M73);
  await db.exec(HOJE_TESTE);
  const nova = await criarPedido(db);
  await receber(db, nova);

  const linhas = (await db.query('select pedido_id, anterior_implantacao, elegivel, data_compra::text from public.contas_pagar_listar_compras_sem_lancamento() order by recebido_em')).rows;
  assert.deepEqual(linhas.map((l) => [l.pedido_id, l.anterior_implantacao, l.elegivel]), [[antiga, true, true], [nova, false, true]]);
  assert.equal(linhas[0].data_compra, await hoje(db)); // sem data_recebimento: dia do recebido_em em São Paulo
  assert.equal(await valor(db, 'select data_recebimento from public.pedidos where id = $1', [antiga]), null);
  await lancar(db, antiga, { condicao: 'no_ato', forma: 'pix' });
  assert.equal(await valor(db, "select count(*)::int from public.contas_pagar where status = 'ativa'"), 1);
});

test('regressão de Pedidos: criar/editar/cancelar/excluir/receber/reabrir sem financeiro seguem iguais; data_recebimento protegida', async () => {
  const db = await banco();
  const p1 = await criarPedido(db);
  await db.query("update public.pedidos set observacoes = 'editado' where id = $1", [p1]);
  await valor(db, "select (public.cancelar_pedido($1, 'desistência')).status", [p1]);
  const p2 = await criarPedido(db);
  await valor(db, 'select public.excluir_pedido($1)', [p2]);
  assert.equal(await valor(db, 'select count(*)::int from public.pedidos where id = $1', [p2]), 0);

  const p3 = await criarPedido(db);
  await assert.rejects(receber(db, p3, { data: somarDias(await hoje(db), 1) }), /nao pode ser no futuro/);
  await receber(db, p3);
  assert.equal(await valor(db, "select count(*)::int from public.logs_auditoria where registro_id = $1 and acao = 'recebeu'", [p3]), 1);
  await assert.rejects(db.query('update public.pedidos set data_recebimento = current_date - 1 where id = $1', [p3]), /so muda no recebimento/);
  await assert.rejects(db.query("insert into public.pedidos (fornecedor_id, data_pedido, data_recebimento) values ($1, current_date, current_date)", [FORNECEDOR_A]), /so e preenchida no recebimento/);
  assert.equal(await valor(db, 'select (public.reabrir_recebimento_pedido($1)).status', [p3]), 'aguardando_entrega');
  assert.equal(await valor(db, 'select data_recebimento from public.pedidos where id = $1', [p3]), null);
  await receber(db, p3);
  assert.equal(await valor(db, 'select status from public.pedidos where id = $1', [p3]), 'recebido');

  const pres = await presencial(db);
  assert.equal(await valor(db, 'select status from public.pedidos where id = $1', [pres]), 'recebido');
  assert.equal(await valor(db, 'select data_recebimento from public.pedidos where id = $1', [pres]), null);
});

test('regressão Folha/Pedidos: entre as funções existentes a 0073 só redefine receber_pedido, pedido_itens_protecao, editar_compra_presencial e reabrir_recebimento_pedido (ACL/modo intactos); só acrescenta data_recebimento', async () => {
  const db = await novoBanco({ extras: [] });
  const fotografarFuncoes = async () => new Map((await db.query(`select p.oid::regprocedure::text as f, md5(p.prosrc) as h, p.prosecdef, p.proconfig::text as c, p.proacl::text as a
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).rows.map((r) => [r.f, `${r.h}|${r.prosecdef}|${r.c}|${r.a}`]));
  const semCorpo = (v) => v.split('|').slice(1).join('|');
  const fotografarColunas = async () => new Set((await db.query(`select table_name || '.' || column_name || ':' || data_type as c
    from information_schema.columns where table_schema = 'public'`)).rows.map((r) => r.c));
  const fotografarPolicies = async () => (await db.query("select string_agg(tablename || '.' || policyname || ':' || qual, ';' order by tablename, policyname) as p from pg_policies where tablename not like 'contas_pagar%'")).rows[0].p;
  const fotografarPermissoes = async () => (await db.query("select string_agg(perfil || ':' || permissao, ',' order by perfil, permissao) as p from public.perfil_permissoes")).rows[0].p;

  const funcoesAntes = await fotografarFuncoes();
  const colunasAntes = await fotografarColunas();
  const policiesAntes = await fotografarPolicies();
  const permissoesAntes = await fotografarPermissoes();
  await aplicarMigration(db, M73);
  const funcoesDepois = await fotografarFuncoes();
  const colunasDepois = await fotografarColunas();

  const alteradas = [...funcoesAntes.keys()].filter((f) => funcoesDepois.get(f) !== funcoesAntes.get(f));
  assert.deepEqual(alteradas.sort(), [
    'editar_compra_presencial(uuid,uuid,date,text,date,text,jsonb)',
    'pedido_itens_protecao()',
    'reabrir_recebimento_pedido(uuid)',
    'receber_pedido(uuid,date,jsonb)',
  ]);
  // Só o corpo mudou: SECURITY DEFINER, search_path e grants iguais.
  for (const f of alteradas) assert.equal(semCorpo(funcoesDepois.get(f)), semCorpo(funcoesAntes.get(f)), f);
  // Os textos novos são os antigos + só os trechos marcados "0073".
  const corpo = async (f) => valor(db, 'select prosrc from pg_proc where oid = $1::regprocedure', [f]);
  const semMarcados = (s) => s.replace(/\r/g, '');
  const editarDepois = semMarcados(await corpo('public.editar_compra_presencial(uuid,uuid,date,text,date,text,jsonb)'));
  assert.equal((editarDepois.match(/set_config\('pedidos\.compra_presencial_em_edicao'/g) || []).length, 2);
  const itensDepois = semMarcados(await corpo('public.pedido_itens_protecao()'));
  assert.equal((itensDepois.match(/pedido_itens_correcao_presencial_autorizada\(/g) || []).length, 3);
  assert.ok(itensDepois.includes('or new.quantidade_sacos_recebidos is not null then\n        raise exception \'pedido_itens: reabertura de recebimento deve limpar'), 'ramo de reabertura da 0051 preservado');
  assert.ok(!/select rolbypassrls/.test(itensDepois), 'gate rolbypassrls removido de pedido_itens_protecao');
  assert.equal((itensDepois.match(/pedido_itens_reabertura_autorizada\(/g) || []).length, 1);
  const reabrirDepois = semMarcados(await corpo('public.reabrir_recebimento_pedido(uuid)'));
  assert.equal((reabrirDepois.match(/set_config\('pedidos\.reabertura_recebimento_em_curso'/g) || []).length, 2);
  assert.ok(reabrirDepois.includes("if v_pedido.modalidade_compra = 'compra_presencial' then"));
  // pedidos_protecao (INVOKER: o gate rolbypassrls dela funciona) fica intocada.
  assert.ok(!alteradas.includes('pedidos_protecao()'));
  const folha = [...funcoesAntes.keys()].filter((f) => /folha|escala|tarefa|funcionario/.test(f));
  assert.ok(folha.length > 20);

  const removidas = [...colunasAntes].filter((c) => !colunasDepois.has(c));
  assert.deepEqual(removidas, []);
  const novasEmTabelasExistentes = [...colunasDepois].filter((c) => !colunasAntes.has(c) && !c.startsWith('contas_pagar'));
  assert.deepEqual(novasEmTabelasExistentes, ['pedidos.data_recebimento:date']);
  assert.equal(await fotografarPolicies(), policiesAntes);
  const permissoesDepois = await fotografarPermissoes();
  assert.ok(permissoesDepois.length > permissoesAntes.length);
  assert.equal(permissoesDepois.split(',').filter((p) => !p.includes('contas_pagar.')).join(','), permissoesAntes);
});

test('guarda: aborta sem criar nada se receber_pedido não for o da 0051, e não reaplica', async () => {
  const db = await novoBanco({ extras: [] });
  await db.exec(`create or replace function public.receber_pedido(p_pedido_id uuid, p_data_recebimento date, p_itens jsonb)
    returns public.pedidos language plpgsql security definer set search_path = '' as $$ begin return null; end $$;`);
  await assert.rejects(aplicarMigration(db, M73), /difere do publicado na 0051/);
  await db.exec('rollback');
  assert.equal(await valor(db, "select to_regclass('public.contas_pagar')"), null);
  assert.equal(await valor(db, "select count(*)::int from information_schema.columns where table_name = 'pedidos' and column_name = 'data_recebimento'"), 0);

  const ok = await banco();
  await assert.rejects(aplicarMigration(ok, M73), /ja existe|ja parece aplicada/);
});

test('guarda: aborta sem criar nada se pedido_itens_protecao (0051), editar_compra_presencial (0037) ou reabrir_recebimento_pedido (0052) estiverem diferentes, ou a trigger não apontar para a função', async () => {
  const casos = [
    // Corpo de pedido_itens_protecao alterado (ex.: correção manual fora do repositório).
    [`create or replace function public.pedido_itens_protecao() returns trigger language plpgsql security definer set search_path = '' as $$ begin return new; end $$;`,
      /pedido_itens_protecao difere do publicado na 0051/],
    // Corpo de editar_compra_presencial alterado.
    [`create or replace function public.editar_compra_presencial(p_pedido_id uuid, p_fornecedor_id uuid, p_data_compra date, p_numero_nota_fiscal text, p_data_documento_fiscal date, p_observacoes text, p_itens jsonb)
       returns public.pedidos language plpgsql security definer set search_path = '' as $$ begin return null; end $$;`,
      /editar_compra_presencial difere do publicado na 0037/],
    // Trigger removida.
    ['drop trigger pedido_itens_protecao_trigger on public.pedido_itens', /pedido_itens_protecao_trigger ausente/],
    // Corpo de reabrir_recebimento_pedido alterado.
    [`create or replace function public.reabrir_recebimento_pedido(p_pedido_id uuid) returns public.pedidos language plpgsql security definer set search_path = '' as $$ begin return null; end $$;`,
      /reabrir_recebimento_pedido difere do publicado na 0052/],
  ];
  for (const [sql, erro] of casos) {
    const db = await novoBanco({ extras: [] });
    await db.exec(sql);
    await assert.rejects(aplicarMigration(db, M73), erro);
    await db.exec('rollback');
    assert.equal(await valor(db, "select to_regclass('public.contas_pagar')"), null);
    assert.equal(await valor(db, "select to_regprocedure('public.pedido_itens_correcao_presencial_autorizada(uuid)')"), null);
  }
});

test('arquivo _EXECUTAR é idêntico à migration versionada', { skip: !existsSync(EXECUTAR) }, () => {
  assert.equal(readFileSync(EXECUTAR, 'utf8'), lerMigration(M73));
});

test('PRE e POS auditoria: sintaxe válida, um resultset, tudo OK no cenário esperado', { skip: !existsSync(PRE) || !existsSync(POS) }, async () => {
  const pre = readFileSync(PRE, 'utf8');
  const pos = readFileSync(POS, 'utf8');

  const antes = await novoBanco({ extras: [] });
  const r1 = await antes.query(pre);
  assert.ok(r1.rows.length > 5);
  const falhasPre = r1.rows.filter((l) => !['OK', 'INFO'].includes(l.resultado));
  assert.deepEqual(falhasPre, []);
  // PRE acusa corpo divergente das funções que a 0073 redefine.
  await antes.exec(`create or replace function public.pedido_itens_protecao() returns trigger language plpgsql security definer set search_path = '' as $$ begin return new; end $$;`);
  const r1b = await antes.query(pre);
  assert.deepEqual(r1b.rows.filter((l) => l.resultado === 'FALHA').map((l) => l.checagem), ['pedido_itens_protecao = versao publicada na 0051 (md5 normalizado; sera redefinida)']);
  await antes.exec(`create or replace function public.reabrir_recebimento_pedido(p_pedido_id uuid) returns public.pedidos language plpgsql security definer set search_path = '' as $$ begin return null; end $$;`);
  const r1c = await antes.query(pre);
  assert.deepEqual(r1c.rows.filter((l) => l.resultado === 'FALHA').map((l) => l.checagem), [
    'pedido_itens_protecao = versao publicada na 0051 (md5 normalizado; sera redefinida)',
    'reabrir_recebimento_pedido = versao publicada na 0052 (md5 normalizado; sera redefinida)',
  ]);

  const depois = await banco();
  const r2 = await depois.query(pos);
  assert.ok(r2.rows.length > 5);
  const falhasPos = r2.rows.filter((l) => !['OK', 'INFO'].includes(l.resultado));
  assert.deepEqual(falhasPos, []);

  // POS detecta o que deveria detectar (ex.: grant indevido a anon).
  await depois.exec('grant execute on function public.contas_pagar_cancelar(uuid, text) to anon');
  const r3 = await depois.query(pos);
  assert.ok(r3.rows.some((l) => l.resultado === 'FALHA'));
});
