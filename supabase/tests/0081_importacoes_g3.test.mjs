// Testes da migration 0081 (Central de Importações do G3ERP) sobre as
// migrations REAIS 0001..0080 (ambiente_pedidos.mjs), em PostgreSQL embutido
// (PGlite). RLS e grants exercidos com SET ROLE authenticated/anon. Também
// roda os SQLs PRE/POS da raiz (quando presentes) e confere que o EXECUTAR é
// byte-idêntico à migration. Relatórios 100% FICTÍCIOS (repositório público).
// Nada aqui toca o Supabase real.
//
//   npm i --no-save @electric-sql/pglite
//   node --test --test-concurrency=1 supabase/tests/0081_importacoes_g3.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADMIN, FINANCEIRO, GESTAO, OPERACIONAL, RAIZ,
  como, fabricaDeBancos, fecharBancos, valor, aplicarMigration,
} from './ambiente_pedidos.mjs';
import {
  vendasProdutoCliente, faturamentoGeral, vendasPeriodo, cenario, vendasEmMassa, CLIENTE_ANONIMO,
} from '../../lib/importacoes/__tests__/relatoriosFicticios.mjs';

const M81 = '0081_importacoes_g3.sql';
const BASE = ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql', '0075_preferencias_usuario_mensagem_pedido.sql', '0080_central_notificacoes.sql'];
const PRE = join(RAIZ, '0081_pre_auditoria_importacoes_g3_EXECUTAR.sql');
const POS = join(RAIZ, '0081_pos_auditoria_importacoes_g3_EXECUTAR.sql');
const EXECUTAR = join(RAIZ, '0081_importacoes_g3_EXECUTAR.sql');

const ADMIN_INATIVO = '00000000-0000-0000-0000-0000000000d1';
const GESTAO_TUDO = '00000000-0000-0000-0000-0000000000d2'; // gestao + TODAS as permissões concedidas individualmente

after(fecharBancos);

const banco = fabricaDeBancos({ extras: [...BASE, M81] });
const bancoSem81 = fabricaDeBancos({ extras: BASE });

const negado = (e) => e.code === '42501' || /permission denied|row-level security|proprietario_admin/i.test(String(e.message));

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
    insert into auth.users (id, email) values ('${ADMIN_INATIVO}', 'ai@padoca.test'), ('${GESTAO_TUDO}', 'gt@padoca.test');
    insert into public.usuarios (id, nome, email, perfil, ativo) values
      ('${ADMIN_INATIVO}', 'ADMIN INATIVO', 'ai@padoca.test', 'proprietario_admin', false),
      ('${GESTAO_TUDO}', 'GESTAO COM TUDO', 'gt@padoca.test', 'gestao', true);
  `);
  // TODAS as permissões que um override individual consegue conceder (os
  // códigos administrativos já são barrados por design desde a 0016/0072).
  await db.exec(`
    do $$ declare r record; begin
      for r in select codigo from public.permissoes loop
        begin
          insert into public.usuario_permissoes (usuario_id, permissao, efeito) values ('${GESTAO_TUDO}', r.codigo, 'concede');
        exception when others then null;
        end;
      end loop;
    end $$;
  `);
  assert.ok(await valor(db, `select count(*)::int from public.usuario_permissoes where usuario_id = '${GESTAO_TUDO}'`) > 20);
}

async function novoBanco() {
  const db = await banco();
  await criarUsuarios(db);
  return db;
}

const sha = (texto) => createHash('sha256').update(texto).digest('hex');

// Fluxo completo via RPC, como o navegador faz: iniciar -> enviar em blocos -> prévia.
async function importar(db, layout, linhas, { nome, original = true, metadados = {}, bloco = 2000, uid = ADMIN } = {}) {
  const conteudo = JSON.stringify([layout, linhas, nome || '']);
  return comoAutenticado(db, uid, async () => {
    const id = await valor(db, 'select public.g3_iniciar_importacao($1, $2, $3, $4, $5::jsonb, $6)', [
      layout, nome || `${layout}.xlsx`, 1000, sha(conteudo),
      JSON.stringify({ abas: 1, formulas: 0, macros: false, original, produtor: original ? 'SheetJS' : 'Microsoft Excel', ...metadados }),
      linhas.length,
    ]);
    for (let i = 0; i < linhas.length; i += bloco) {
      await db.query('select public.g3_enviar_linhas($1, $2, $3::jsonb)', [id, i + 1, JSON.stringify(linhas.slice(i, i + bloco))]);
    }
    const previa = await valor(db, 'select public.g3_gerar_previa($1)', [id]);
    return { id, previa };
  });
}

async function confirmar(db, lote, { reconhecer = false, uid = ADMIN } = {}) {
  return comoAutenticado(db, uid, async () => {
    const base = await valor(db, 'select estado_base from public.g3_importacoes where id = $1', [lote.id]);
    return valor(db, 'select public.g3_confirmar_importacao($1, $2, $3)', [lote.id, base, reconhecer]);
  });
}

async function importarEConfirmar(db, layout, linhas, opcoes = {}) {
  const lote = await importar(db, layout, linhas, opcoes);
  assert.equal(lote.previa.status, 'previa', `prévia de ${layout}: ${JSON.stringify(lote.previa.erros)}`);
  await confirmar(db, lote, opcoes);
  return lote;
}

async function reverter(db, id, motivo = 'teste de reversao') {
  return comoAutenticado(db, ADMIN, () => valor(db, 'select public.g3_reverter_importacao($1, $2)', [id, motivo]));
}

async function listarLote(db, id, acao = null) {
  return comoAutenticado(db, ADMIN, async () =>
    (await db.query('select * from public.g3_listar_lote($1, $2, 500, 0)', [id, acao])).rows);
}

const errosDe = (lote) => (lote.previa.erros || []).map((e) => e.codigo);
const acoes = (lote) => lote.previa.resumo?.por_acao || {};

// Cenário base fictício: 3 vendas em 2 dias de junho/2026.
const VENDAS_BASE = [
  { numero: 10, dataHora: '2026-06-03 08:10', itens: [{ produto: 'PAO FRANCES', codigo: 1, qtd: 0.5, valor: 9.5 }, { produto: 'CAFE', codigo: 2, qtd: 1, valor: 6 }] },
  { numero: 11, dataHora: '2026-06-03 09:00', itens: [{ produto: 'BOLO', codigo: 3, qtd: 1, valor: 25 }], descontoRateado: 2.5 },
  { numero: 12, dataHora: '2026-06-04 10:30', itens: [{ produto: 'CAFE', codigo: 2, qtd: 1, valor: 6 }, { produto: 'CAFE', codigo: 2, qtd: 1, valor: 6 }] },
];
const PERIODO = { inicio: '2026-06-01', fim: '2026-06-30', gerado: '2026-07-01 09:00' };

function relatorios(vendas = VENDAS_BASE, periodo = PERIODO) {
  const c = cenario(vendas);
  return {
    vpc: vendasProdutoCliente({ ...periodo, itens: c.itens }),
    fat: faturamentoGeral({ ...periodo, vendas: c.fat }),
    vp: vendasPeriodo({ ...periodo, dias: c.dias }),
  };
}

async function conciliacao(db, inicio, fim) {
  return comoAutenticado(db, ADMIN, async () =>
    (await db.query('select * from public.g3_conciliacao_diaria($1::date, $2::date)', [inicio, fim])).rows);
}

async function cobertura(db, inicio, fim) {
  return comoAutenticado(db, ADMIN, async () =>
    (await db.query('select * from public.g3_cobertura($1::date, $2::date)', [inicio, fim])).rows);
}

// Retrato do estado derivado, independente de ids (para comparar bancos).
async function retrato(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    estado: await q(`select e.faceta, e.chave, e.estado, e.data, c.hash, l.arquivo_sha256 as lote
                     from public.g3_estado e join public.g3_conteudos c on c.id = e.conteudo_id
                     join public.g3_importacoes l on l.id = e.lote_id order by 1, 2`),
    vendas: await q(`select numero, itens_estado, itens_data, itens_total, itens_linhas, fat_estado, fat_data, data_hora,
                            prod, liquido, desconto_rateado, conciliacao from public.g3_vendas order by numero`),
    itens: await q('select numero, codigo, ordinal, descricao, quantidade, desconto, valor from public.g3_venda_itens order by 1, 2, 3'),
    dias: await q('select dia, estado, venda, liquido_sem_taxa from public.g3_vendas_diarias order by dia'),
  };
}

// ---------------------------------------------------------------------------
// Instalação, acesso e proteção
// ---------------------------------------------------------------------------

test('aplica sobre 0001..0080: RLS em todas as g3_*, nada existente alterado, nenhuma permissão criada', async () => {
  const antes = await bancoSem81();
  const depois = await banco();
  const tabelas = (await depois.query("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r' and relname like 'g3\\_%' order by 1")).rows.map((r) => r.relname);
  assert.deepEqual(tabelas, ['g3_atestados', 'g3_configuracao', 'g3_conteudos', 'g3_estado', 'g3_importacao_linhas', 'g3_importacoes',
    'g3_pendencias', 'g3_previa', 'g3_venda_itens', 'g3_vendas', 'g3_vendas_diarias']);
  for (const t of tabelas) {
    assert.equal(await valor(depois, 'select relrowsecurity from pg_class where oid = $1::regclass', [`public.${t}`]), true, `RLS em ${t}`);
    const pols = (await depois.query('select polname, polcmd from pg_policy where polrelid = $1::regclass', [`public.${t}`])).rows;
    assert.deepEqual(pols.map((p) => p.polcmd), ['r'], `${t}: só policy de SELECT`);
  }
  for (const sql of [
    'select count(*)::int from public.permissoes',
    'select count(*)::int from public.perfil_permissoes',
    'select count(*)::int from public.usuario_permissoes',
    'select count(*)::int from public.usuarios',
    "select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname not like 'g3\\_%'",
    "select string_agg(p.oid::regprocedure::text || md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname not like 'g3\\_%'",
    "select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname not like 'g3\\_%'",
    "select string_agg(table_name || '.' || column_name, ',' order by table_name, column_name) from information_schema.columns where table_schema = 'public' and table_name not like 'g3\\_%'",
  ]) {
    assert.equal(await valor(depois, sql), await valor(antes, sql), `inalterado: ${sql.slice(0, 80)}`);
  }
  assert.equal(await valor(depois, "select count(*)::int from public.permissoes where codigo ilike '%g3%' or codigo ilike '%import%' or codigo ilike 'bi.%'"), 0);
});

test('reaplicar aborta pela guarda, sem alterar nada', async () => {
  const db = await novoBanco();
  await assert.rejects(aplicarMigration(db, M81), /ja parece aplicada/);
  await db.exec('rollback');
  assert.equal(await valor(db, 'select count(*)::int from public.g3_configuracao'), 1);
});

test('acesso: só proprietario_admin ATIVO; overrides não concedem; anon nada; DML direto negado', async () => {
  const db = await novoBanco();
  const { vpc } = relatorios();
  const lote = await importarEConfirmar(db, 'vendas_produto_cliente', vpc);

  // admin ativo lê tudo
  await comoAutenticado(db, ADMIN, async () => {
    assert.equal(await valor(db, 'select count(*)::int from public.g3_importacoes'), 1);
    assert.equal(await valor(db, 'select count(*)::int from public.g3_vendas'), 3);
    assert.ok((await db.query("select * from public.g3_cobertura('2026-06-01', '2026-06-30')")).rows.length > 0);
  });

  for (const uid of [GESTAO, FINANCEIRO, OPERACIONAL, ADMIN_INATIVO, GESTAO_TUDO]) {
    await comoAutenticado(db, uid, async () => {
      for (const t of ['g3_importacoes', 'g3_importacao_linhas', 'g3_vendas', 'g3_venda_itens', 'g3_vendas_diarias', 'g3_conteudos',
        'g3_atestados', 'g3_pendencias', 'g3_estado', 'g3_previa', 'g3_configuracao']) {
        assert.equal(await valor(db, `select count(*)::int from public.${t}`), 0, `${uid} não vê ${t}`);
      }
      for (const sql of [
        "select public.g3_iniciar_importacao('vendas_periodo', 'a.xlsx', 10, repeat('a', 64), '{\"abas\":1}'::jsonb, 10)",
        `select public.g3_enviar_linhas('${lote.id}', 1, '[[]]'::jsonb)`,
        `select public.g3_gerar_previa('${lote.id}')`,
        `select * from public.g3_listar_lote('${lote.id}')`,
        `select public.g3_confirmar_importacao('${lote.id}', 0, true)`,
        `select public.g3_descartar_importacao('${lote.id}')`,
        `select public.g3_reverter_importacao('${lote.id}', 'motivo qualquer')`,
        'select * from public.g3_listar_pendencias()',
        "select * from public.g3_cobertura('2026-06-01', '2026-06-30')",
        "select * from public.g3_conciliacao_diaria('2026-06-01', '2026-06-30')",
        'select * from public.g3_espaco_ocupado()',
        'select public.g3_limpar()',
      ]) {
        await assert.rejects(db.query(sql), negado, `${uid}: ${sql.slice(0, 60)}`);
      }
    });
  }

  await comoAnon(db, async () => {
    await assert.rejects(db.query('select * from public.g3_vendas'), negado);
    await assert.rejects(db.query("select public.g3_iniciar_importacao('vendas_periodo', 'a.xlsx', 10, repeat('a', 64), '{}'::jsonb, 10)"), negado);
  });

  // nem o admin escreve direto nas tabelas (sem grant), nem chama funções internas
  await comoAutenticado(db, ADMIN, async () => {
    await assert.rejects(db.query("update public.g3_importacoes set status = 'descartado'"), negado);
    await assert.rejects(db.query('delete from public.g3_vendas'), negado);
    await assert.rejects(db.query("insert into public.g3_pendencias (lote_id, faceta, chave, motivo) values (gen_random_uuid(), 'itens', '1', 'conflito_numero')"), negado);
    await assert.rejects(db.query(`select public.g3_analisar('${lote.id}')`), negado);
    await assert.rejects(db.query("select public.g3_recalcular('itens', array['1'])"), negado);
    await assert.rejects(db.query('select public.g3_limpar_interno()'), negado);
    await assert.rejects(db.exec("select set_config('g3.operacao', 'on', false); delete from public.g3_vendas"), negado);
  });
  assert.equal(await valor(db, 'select count(*)::int from public.g3_vendas'), 3);
});

test('proteção: nem o dono altera direto; atestados/conteúdos/pendências são imutáveis; TRUNCATE bloqueado', async () => {
  const db = await novoBanco();
  const { vpc } = relatorios();
  await importarEConfirmar(db, 'vendas_produto_cliente', vpc);
  await como(db, ADMIN);
  await assert.rejects(db.query("update public.g3_importacoes set status = 'descartado'"), /alteracao direta nao permitida/);
  await assert.rejects(db.query('delete from public.g3_venda_itens'), /alteracao direta nao permitida/);
  await assert.rejects(db.query('update public.g3_configuracao set cnpj = $1', ['11111111111111']), /alteracao direta nao permitida/);
  await db.exec('begin');
  await db.query("select set_config('g3.operacao', 'on', true)");
  await assert.rejects(db.query('delete from public.g3_atestados'), /imutavel/);
  await db.exec('rollback');
  await db.exec('begin');
  await db.query("select set_config('g3.operacao', 'on', true)");
  await assert.rejects(db.query("update public.g3_conteudos set hash = repeat('0', 64)"), /imutavel/);
  await db.exec('rollback');
  for (const t of ['g3_vendas', 'g3_atestados', 'g3_importacoes', 'g3_importacao_linhas']) {
    await assert.rejects(db.query(`truncate public.${t} cascade`), /imutavel/, `truncate ${t}`);
  }
  assert.equal(await valor(db, 'select count(*)::int from public.g3_atestados'), 3);
});

// ---------------------------------------------------------------------------
// Fluxo, prévia, confirmação
// ---------------------------------------------------------------------------

test('fluxo completo dos 3 relatórios: prévia, confirmação, fatos e conciliação cruzada', async () => {
  const db = await novoBanco();
  const { vpc, fat, vp } = relatorios();

  const lv = await importar(db, 'vendas_produto_cliente', vpc);
  assert.equal(lv.previa.status, 'previa', JSON.stringify(lv.previa.erros));
  assert.deepEqual(acoes(lv), { nova: 3 });
  assert.equal(lv.previa.resumo.chaves, 3);
  assert.equal(lv.previa.resumo.linhas_dados, 5);
  const imp = await valor(db, 'select row_to_json(i) from public.g3_importacoes i where id = $1', [lv.id]);
  assert.equal(imp.periodo_inicio, '2026-06-01');
  assert.equal(imp.cobertura_completa_fim, '2026-06-30');
  assert.equal(imp.dia_parcial, null);
  assert.equal(imp.usuario_g3, 'PADOCA DA MATA');
  assert.equal(await valor(db, "select count(*)::int from public.g3_vendas"), 0, 'nada vira fato antes de confirmar');

  await confirmar(db, lv);
  await importarEConfirmar(db, 'faturamento_geral', fat);
  await importarEConfirmar(db, 'vendas_periodo', vp);

  const vendas = (await db.query('select numero, conciliacao, itens_total, prod, liquido, desconto_rateado from public.g3_vendas order by numero')).rows;
  assert.deepEqual(vendas.map((v) => [Number(v.numero), v.conciliacao]), [[10, 'conciliada'], [11, 'conciliada'], [12, 'conciliada']]);
  assert.equal(Number(vendas[1].liquido), 22.5, 'líquido com desconto rateado');
  assert.equal(Number(vendas[1].prod), 25, 'bruto preservado');

  // linhas idênticas legítimas na mesma venda: ordinais 1 e 2
  const itens12 = (await db.query("select codigo, ordinal from public.g3_venda_itens where numero = 12 order by ordinal")).rows;
  assert.deepEqual(itens12.map((i) => [i.codigo, i.ordinal]), [['2', 1], ['2', 2]]);

  const conc = await conciliacao(db, '2026-06-03', '2026-06-05');
  assert.deepEqual(conc.map((d) => d.estado), ['conciliado', 'conciliado', 'conciliado'], JSON.stringify(conc));
  assert.equal(Number(conc[0].soma_liquido), 38, 'líquido do dia 03 = 15,50 + 22,50');
  assert.equal(Number(conc[0].periodo_liquido), 38);
  assert.equal(Number(conc[0].soma_prod), 40.5);

  const cob = await cobertura(db, '2026-06-01', '2026-06-01');
  assert.deepEqual(cob.map((c) => c.estado), ['completo', 'completo', 'completo'], 'dia sem vendas coberto = completo');

  // auditoria sem dados pessoais
  const logs = (await db.query("select acao, valor_novo from public.logs_auditoria where entidade = 'g3_importacao' order by data_hora")).rows;
  assert.deepEqual(logs.map((l) => l.acao), ['confirmou', 'confirmou', 'confirmou']);
  assert.ok(logs.every((l) => !/cpf|consumidor/i.test(l.valor_novo)));
});

test('confirmação é idempotente e o mesmo arquivo não é importado duas vezes', async () => {
  const db = await novoBanco();
  const { vpc } = relatorios();
  const lote = await importarEConfirmar(db, 'vendas_produto_cliente', vpc);
  await assert.rejects(confirmar(db, lote), /ja foi confirmado/);
  await assert.rejects(importar(db, 'vendas_produto_cliente', vpc), /ja foi importado e confirmado/);
  assert.equal(await valor(db, 'select count(*)::int from public.g3_atestados'), 3);
});

test('reenvio de bloco é idempotente; bloco com conteúdo diferente é recusado; prévia exige todas as linhas', async () => {
  const db = await novoBanco();
  const { vp } = relatorios();
  await comoAutenticado(db, ADMIN, async () => {
    const id = await valor(db, "select public.g3_iniciar_importacao('vendas_periodo', 'vp.xlsx', 100, $1, '{\"abas\":1}'::jsonb, $2)", [sha('vp'), vp.length]);
    await db.query('select public.g3_enviar_linhas($1, 1, $2::jsonb)', [id, JSON.stringify(vp.slice(0, 5))]);
    await assert.rejects(db.query('select public.g3_gerar_previa($1)', [id]), /Faltam linhas/);
    assert.equal(await valor(db, 'select public.g3_enviar_linhas($1, 1, $2::jsonb)', [id, JSON.stringify(vp.slice(0, 5))]), 5, 'reenvio igual não duplica');
    const alterado = vp.slice(0, 5).map((l) => [...l]);
    alterado[0] = ['OUTRO TITULO'];
    await assert.rejects(db.query('select public.g3_enviar_linhas($1, 1, $2::jsonb)', [id, JSON.stringify(alterado)]), /ja recebida com conteudo diferente/);
    await assert.rejects(db.query('select public.g3_enviar_linhas($1, $2, $3::jsonb)', [id, vp.length, JSON.stringify(vp.slice(0, 2))]), /Faixa de linhas/);
    await db.query('select public.g3_enviar_linhas($1, 6, $2::jsonb)', [id, JSON.stringify(vp.slice(5))]);
    const previa = await valor(db, 'select public.g3_gerar_previa($1)', [id]);
    assert.equal(previa.status, 'previa');
  });
});

test('validações de entrada do início: layout, extensão, abas, fórmulas, macros, limite de linhas', async () => {
  const db = await novoBanco();
  await comoAutenticado(db, ADMIN, async () => {
    const iniciar = (layout, nome, meta, linhas = 10) =>
      db.query('select public.g3_iniciar_importacao($1, $2, 100, $3, $4::jsonb, $5)', [layout, nome, sha(nome + JSON.stringify(meta)), JSON.stringify(meta), linhas]);
    await assert.rejects(iniciar('estoque', 'a.xlsx', { abas: 1 }), /Layout invalido/);
    await assert.rejects(iniciar('vendas_periodo', 'a.csv', { abas: 1 }), /xlsx/);
    await assert.rejects(iniciar('vendas_periodo', 'a.xlsx', { abas: 2 }), /exatamente uma aba/);
    await assert.rejects(iniciar('vendas_periodo', 'a.xlsx', { abas: 1, formulas: 3 }), /formulas/);
    await assert.rejects(iniciar('vendas_periodo', 'a.xlsx', { abas: 1, macros: true }), /macros/);
    await assert.rejects(iniciar('vendas_periodo', 'a.xlsx', { abas: 1 }, 500000), /limite/);
    const id = await valor(db, "select public.g3_iniciar_importacao('vendas_periodo', 'C:\\pasta\\Relatorio.XLSX', 100, $1, '{\"abas\":1}'::jsonb, 10)", [sha('x')]);
    assert.equal(await valor(db, 'select arquivo_nome from public.g3_importacoes where id = $1', [id]), 'Relatorio.XLSX', 'só o nome, sem caminho');
  });
});

// ---------------------------------------------------------------------------
// Rejeições fatais
// ---------------------------------------------------------------------------

test('rejeita: layout trocado, filtro de seção (SALGADO), situação, empresa/CNPJ, agrupamento', async () => {
  const db = await novoBanco();
  const c = cenario(VENDAS_BASE);
  const casos = [
    ['vendas_periodo', vendasProdutoCliente({ ...PERIODO, itens: c.itens }), 'layout_nao_reconhecido'],
    ['vendas_produto_cliente', vendasProdutoCliente({ ...PERIODO, itens: c.itens, filtrosExtras: [['Seção/Categoria', 'SALGADO']] }), 'filtro_nao_permitido'],
    ['vendas_produto_cliente', vendasProdutoCliente({ ...PERIODO, itens: c.itens, situacoes: 'CANCELADO' }), 'filtro_nao_permitido'],
    ['vendas_produto_cliente', vendasProdutoCliente({ ...PERIODO, itens: c.itens, cnpj: '11222333000181' }), 'empresa_divergente'],
    ['vendas_produto_cliente', vendasProdutoCliente({ ...PERIODO, itens: c.itens, razao: 'OUTRA PADARIA LTDA' }), 'empresa_divergente'],
    ['faturamento_geral', faturamentoGeral({ ...PERIODO, vendas: c.fat, empresas: 'OUTRA - OUTRA LTDA' }), 'empresa_divergente'],
    ['faturamento_geral', faturamentoGeral({ ...PERIODO, vendas: c.fat, empresaColuna: 'OUTRA' }), 'empresa_divergente'],
    ['faturamento_geral', faturamentoGeral({ ...PERIODO, vendas: c.fat, filtrosExtras: [['Vendedor', 'FULANO']] }), 'filtro_nao_permitido'],
    ['vendas_periodo', vendasPeriodo({ ...PERIODO, dias: c.dias, agrupado: 'MENSAL' }), 'filtro_nao_permitido'],
  ];
  for (const [layout, linhas, codigo] of casos) {
    const lote = await importar(db, layout, linhas);
    assert.equal(lote.previa.status, 'rejeitado', `${codigo}: ${JSON.stringify(lote.previa)}`);
    assert.ok(errosDe(lote).includes(codigo), `${codigo} em ${JSON.stringify(lote.previa.erros)}`);
    assert.equal(await valor(db, 'select count(*)::int from public.g3_previa where lote_id = $1', [lote.id]), 0);
    await comoAutenticado(db, ADMIN, () => assert.rejects(db.query('select public.g3_confirmar_importacao($1, 0, true)', [lote.id]), /Somente lotes em previa/));
  }
  assert.equal(await valor(db, 'select count(*)::int from public.g3_vendas'), 0);
});

test('rejeita: rodapés que não fecham (FaturamGeral/Vendas_Periodo/total geral), repetidos, data fora do período, célula ilegível, linha estranha', async () => {
  const db = await novoBanco();
  const c = cenario(VENDAS_BASE);
  const vpc = vendasProdutoCliente({ ...PERIODO, itens: c.itens });
  const comLinhaEstranha = [...vpc.slice(0, 12), ['TEXTO SOLTO NO MEIO'], ...vpc.slice(12)];
  comLinhaEstranha.splice(14, 0, []); // linha vazia + texto fora da estrutura depois do subtotal
  const vpcFora = vendasProdutoCliente({ ...PERIODO, itens: [{ ...c.itens[0], data: '2026-07-02' }] });
  const vpcIlegivel = vendasProdutoCliente({ ...PERIODO, itens: c.itens }).map((l, i) => (i === 12 ? [...l.slice(0, 6), '9,50'] : l));
  const casos = [
    ['faturamento_geral', faturamentoGeral({ ...PERIODO, vendas: c.fat, ajusteRodape: { 'Total Líquido': 1 } }), 'rodape_divergente'],
    ['faturamento_geral', faturamentoGeral({ ...PERIODO, vendas: c.fat, ajusteRodape: { Vendas: 4 } }), 'rodape_divergente'],
    ['faturamento_geral', faturamentoGeral({ ...PERIODO, vendas: [...c.fat, c.fat[0]] }), 'venda_repetida'],
    ['vendas_periodo', vendasPeriodo({ ...PERIODO, dias: c.dias, ajusteRodape: { 'Total Vendas': 1 } }), 'rodape_divergente'],
    ['vendas_periodo', vendasPeriodo({ ...PERIODO, dias: [...c.dias, c.dias[0]] }), 'dia_repetido'],
    ['vendas_produto_cliente', vendasProdutoCliente({ ...PERIODO, itens: c.itens, ajusteTotal: 0.01 }), 'rodape_divergente'],
    ['vendas_produto_cliente', vpcFora, 'data_fora_periodo'],
    ['vendas_produto_cliente', vpcIlegivel, 'celula_ilegivel'],
    ['vendas_produto_cliente', [...vpc.slice(0, 13), ['X', 'abc', '10', '03/06/2026', 1, 0, 1], ...vpc.slice(13)], 'celula_ilegivel'],
  ];
  for (const [layout, linhas, codigo] of casos) {
    const lote = await importar(db, layout, linhas);
    assert.equal(lote.previa.status, 'rejeitado', `${codigo}: ${JSON.stringify(lote.previa)}`);
    assert.ok(errosDe(lote).includes(codigo), `${codigo} em ${JSON.stringify(lote.previa.erros)}`);
  }
  // texto solto depois do subtotal (fora da área de dados)
  const estranho = [...vpc];
  estranho.splice(vpc.length - 3, 0, ['ANOTACAO MANUAL']);
  const lote = await importar(db, 'vendas_produto_cliente', estranho);
  assert.ok(errosDe(lote).includes('linha_nao_reconhecida') || errosDe(lote).includes('estrutura_invalida'), JSON.stringify(lote.previa.erros));
});

test('rodapé dos itens: subtotal diferente da soma das linhas é ALERTA (não rejeita); total geral é exato', async () => {
  const db = await novoBanco();
  const c = cenario(VENDAS_BASE);
  const linhas = vendasProdutoCliente({ ...PERIODO, itens: c.itens, ajusteSubtotal: -1.41 });
  const lote = await importar(db, 'vendas_produto_cliente', linhas);
  assert.equal(lote.previa.status, 'previa', JSON.stringify(lote.previa.erros));
  const alerta = lote.previa.alertas.find((a) => a.codigo === 'rodape_itens_divergente');
  assert.ok(alerta, JSON.stringify(lote.previa.alertas));
  assert.match(alerta.mensagem, /1\.41/);
});

test('Vendas_Periodo: custo/ganho arredondados pelo G3 (até R$ 0,01 por dia) é alerta; diferença maior rejeita', async () => {
  const db = await novoBanco();
  const c = cenario(VENDAS_BASE);
  const base = vendasPeriodo({ ...PERIODO, dias: c.dias });
  const custo = base.find((l) => l[0] === 'Total Custo')[1];
  const ganho = base.find((l) => l[0] === 'Total Ganho')[1];
  const ok = await importar(db, 'vendas_periodo', vendasPeriodo({ ...PERIODO, dias: c.dias,
    ajusteRodape: { 'Total Custo': Math.round((custo - 0.02) * 100) / 100, 'Total Ganho': Math.round((ganho + 0.02) * 100) / 100 } }));
  assert.equal(ok.previa.status, 'previa', JSON.stringify(ok.previa.erros));
  assert.equal(ok.previa.alertas.filter((a) => a.codigo === 'rodape_custo_arredondado').length, 2);
  const ruim = await importar(db, 'vendas_periodo', vendasPeriodo({ ...PERIODO, dias: c.dias, ajusteRodape: { 'Total Custo': custo - 5 } }));
  assert.ok(errosDe(ruim).includes('rodape_divergente'));
  const venda = await importar(db, 'vendas_periodo', vendasPeriodo({ ...PERIODO, dias: c.dias, ajusteRodape: { 'Total Vendas': 0.01 } }));
  assert.ok(errosDe(venda).includes('rodape_divergente'), 'venda continua exata');
});

test('limite de 80 mil linhas de dados (configurável) e arquivo regravado aceito com alerta (datas/códigos convertidos)', async () => {
  const db = await novoBanco();
  await db.exec("begin; select set_config('g3.operacao', 'on', true); update public.g3_configuracao set max_linhas_dados = 1000; commit;");
  const muitas = cenario(vendasEmMassa({ quantidade: 400, itensPorVenda: 3 }));
  const lote = await importar(db, 'vendas_produto_cliente', vendasProdutoCliente({ ...PERIODO, itens: muitas.itens }));
  assert.ok(errosDe(lote).includes('limite_linhas'), JSON.stringify(lote.previa.erros));
  await db.exec("begin; select set_config('g3.operacao', 'on', true); update public.g3_configuracao set max_linhas_dados = 80000; commit;");

  // "regravado no Excel": códigos/pedidos como número, data como serial, CNPJ numérico
  const c = cenario(VENDAS_BASE);
  const linhas = vendasProdutoCliente({ ...PERIODO, itens: c.itens }).map((l) => [...l]);
  linhas[2] = [65214016000142];
  for (const l of linhas) {
    if (l.length === 7 && /^\d+$/.test(String(l[1])) && /^\d{2}\/\d{2}\/\d{4}$/.test(String(l[3]))) {
      const [d, m, a] = l[3].split('/').map(Number);
      l[1] = Number(l[1]);
      l[2] = Number(l[2]);
      l[3] = Math.round((Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
    }
  }
  const regravado = await importar(db, 'vendas_produto_cliente', linhas, { original: false });
  assert.equal(regravado.previa.status, 'previa', JSON.stringify(regravado.previa.erros));
  const codigos = regravado.previa.alertas.map((a) => a.codigo);
  assert.ok(codigos.includes('arquivo_regravado') && codigos.includes('datas_convertidas'), JSON.stringify(codigos));
  await confirmar(db, regravado);
  // mesmo conteúdo do original: reimportar o original dá "igual"
  const original = await importar(db, 'vendas_produto_cliente', vendasProdutoCliente({ ...PERIODO, itens: c.itens }), { nome: 'original.xlsx' });
  assert.deepEqual(acoes(original), { igual: 3 });
});

// ---------------------------------------------------------------------------
// Dados pessoais
// ---------------------------------------------------------------------------

test('dados pessoais: bloco com nome/CPF/CNPJ de cliente é recusado ANTES de gravar; nada fica no banco', async () => {
  const db = await novoBanco();
  const c = cenario(VENDAS_BASE);
  const vpc = vendasProdutoCliente({ ...PERIODO, itens: c.itens });
  const fat = faturamentoGeral({ ...PERIODO, vendas: c.fat });
  const casos = [
    ['vendas_produto_cliente', vpc.map((l) => (l[0] === CLIENTE_ANONIMO ? ['Cliente: MARIA DA SILVA - CPF/CNPJ: 123.456.789-09'] : l))],
    ['vendas_produto_cliente', vpc.map((l) => (l[0] === CLIENTE_ANONIMO ? ['Cliente: JOAO PEREIRA - CPF/CNPJ: Não informado'] : l))],
    ['vendas_produto_cliente', vpc.map((l, i) => (i === 12 ? [l[0], l[1], l[2], l[3], l[4], l[5], l[6], '12345678909'] : l))],
    ['faturamento_geral', fat.map((l) => (typeof l[0] === 'number' ? [l[0], 'MARIA DA SILVA', ...l.slice(2)] : l))],
    ['faturamento_geral', fat.map((l, i) => (i === 10 ? [...l, '11.222.333/0001-81'] : l))],
    ['faturamento_geral', fat.map((l, i) => (i === 10 ? [...l, 12345678909] : l))],
  ];
  for (const [layout, linhas] of casos) {
    await assert.rejects(importar(db, layout, linhas), /dado pessoal de cliente/);
  }
  assert.equal(await valor(db, 'select count(*)::int from public.g3_importacao_linhas'), 0, 'nenhuma linha gravada');

  // formas mascaradas permitidas
  const mascarado = vpc.map((l) => (l[0] === CLIENTE_ANONIMO ? ['Cliente: [cliente identificado]'] : l));
  const lote = await importar(db, 'vendas_produto_cliente', mascarado);
  assert.equal(lote.previa.status, 'previa', JSON.stringify(lote.previa.erros));
  const fatMasc = fat.map((l) => (typeof l[0] === 'number' ? [l[0], '[cliente identificado]', ...l.slice(2)] : l));
  assert.equal((await importar(db, 'faturamento_geral', fatMasc)).previa.status, 'previa');

  const textos = await valor(db, `select string_agg(celulas::text, ' ') from public.g3_importacao_linhas`);
  assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}|MARIA|JOAO/.test(textos));
});

// ---------------------------------------------------------------------------
// Sobreposição, versões, ausências, pendências
// ---------------------------------------------------------------------------

test('sobreposição: reenvio do mesmo período não duplica; correção gera nova versão preservando a anterior', async () => {
  const db = await novoBanco();
  const { vpc } = relatorios();
  await importarEConfirmar(db, 'vendas_produto_cliente', vpc);

  // export posterior, período sobreposto (01/06 a 15/07), venda 12 corrigida e venda nova 13
  const vendas2 = [
    VENDAS_BASE[0], VENDAS_BASE[1],
    { ...VENDAS_BASE[2], itens: [{ produto: 'CAFE', codigo: 2, qtd: 1, valor: 6 }, { produto: 'CAFE', codigo: 2, qtd: 1, valor: 6.5 }] },
    { numero: 13, dataHora: '2026-07-02 07:00', itens: [{ produto: 'SUCO', codigo: 4, qtd: 1, valor: 8 }] },
  ];
  const c2 = cenario(vendas2);
  const l2 = await importar(db, 'vendas_produto_cliente',
    vendasProdutoCliente({ inicio: '2026-06-01', fim: '2026-07-15', gerado: '2026-07-10 08:00', itens: c2.itens.reverse() }));
  assert.deepEqual(acoes(l2), { igual: 2, alterada: 1, nova: 1 });
  await confirmar(db, l2);

  assert.equal(await valor(db, 'select count(*)::int from public.g3_vendas'), 4, 'sem duplicar');
  assert.equal(Number(await valor(db, 'select itens_total from public.g3_vendas where numero = 12')), 12.5);
  assert.equal(await valor(db, "select count(*)::int from public.g3_conteudos where faceta = 'itens' and chave = '12'"), 2, 'duas versões da venda 12');
  // retenção: as linhas "iguais" do 2o lote não guardam células
  assert.ok(await valor(db, 'select count(*)::int from public.g3_importacao_linhas where lote_id = $1 and celulas is null', [l2.id]) >= 3);
});

test('ausência: venda sumida em dia COMPLETO é sinalizada e exige reconhecimento; dia parcial e saltos de numeração não', async () => {
  const db = await novoBanco();
  // gerado 04/06 10:00: dia 03 completo, dia 04 parcial
  const vendas = [
    { numero: 1, dataHora: '2026-06-03 08:00', itens: [{ produto: 'PAO', codigo: 1, qtd: 1, valor: 1 }] },
    { numero: 2, dataHora: '2026-06-03 09:00', itens: [{ produto: 'PAO', codigo: 1, qtd: 2, valor: 2 }] },
    { numero: 5, dataHora: '2026-06-04 07:00', itens: [{ produto: 'PAO', codigo: 1, qtd: 3, valor: 3 }] }, // salto 3,4
  ];
  const fat1 = faturamentoGeral({ inicio: '2026-06-01', fim: '2026-06-30', gerado: '2026-06-04 10:00', vendas: cenario(vendas).fat });
  const l1 = await importarEConfirmar(db, 'faturamento_geral', fat1);
  const imp = await valor(db, 'select row_to_json(i) from public.g3_importacoes i where id = $1', [l1.id]);
  assert.equal(imp.cobertura_completa_fim, '2026-06-03');
  assert.equal(imp.dia_parcial, '2026-06-04');
  assert.equal(l1.previa.resumo.ausentes, 0, 'saltos de numeração nunca viram ausência');

  // novo export (gerado 06/06): venda 2 sumiu (dia 03, completo) e venda 5 também (dia 04, agora completo)
  const fat2 = faturamentoGeral({ inicio: '2026-06-01', fim: '2026-06-30', gerado: '2026-06-06 10:00', vendas: cenario([vendas[0]]).fat });
  const l2 = await importar(db, 'faturamento_geral', fat2);
  assert.deepEqual(acoes(l2), { igual: 1, ausente: 2 });
  await assert.rejects(confirmar(db, l2), /reconhece as ausencias/);
  await confirmar(db, l2, { reconhecer: true });
  const est = (await db.query("select numero, fat_estado, conciliacao from public.g3_vendas order by numero")).rows;
  assert.deepEqual(est.map((v) => [Number(v.numero), v.fat_estado, v.conciliacao]), [[1, 'presente', 'sem_itens'], [2, 'ausente', 'ausente'], [5, 'ausente', 'ausente']]);

  // export parcial do dia 06 que NÃO cobre o dia 03 por completo não mexe em nada
  const fat3 = faturamentoGeral({ inicio: '2026-06-06', fim: '2026-06-06', gerado: '2026-06-06 12:00', vendas: [] });
  const l3 = await importar(db, 'faturamento_geral', fat3);
  assert.equal(l3.previa.resumo.ausentes, 0);
  assert.ok(l3.previa.alertas.some((a) => a.codigo === 'sem_dias_completos'));

  // reaparecimento: export posterior volta a trazer a venda 2
  const fat4 = faturamentoGeral({ inicio: '2026-06-03', fim: '2026-06-03', gerado: '2026-06-07 10:00', vendas: cenario(vendas.slice(0, 2)).fat });
  const l4 = await importar(db, 'faturamento_geral', fat4);
  assert.deepEqual(acoes(l4), { igual: 1, reaparecida: 1 });
  await confirmar(db, l4);
  assert.equal(await valor(db, 'select fat_estado from public.g3_vendas where numero = 2'), 'presente');
  assert.equal(await valor(db, 'select fat_estado from public.g3_vendas where numero = 5'), 'ausente');
});

test('pendência: valor zero/negativo bloqueia a venda inteira, preserva a última versão válida e impede "completo" até ser resolvida', async () => {
  const db = await novoBanco();
  const { vpc, fat, vp } = relatorios();
  await importarEConfirmar(db, 'vendas_produto_cliente', vpc);
  await importarEConfirmar(db, 'faturamento_geral', fat);
  await importarEConfirmar(db, 'vendas_periodo', vp);

  // novo export de itens: venda 10 com item zerado (devolução ainda não definida)
  const c = cenario(VENDAS_BASE);
  const itens = c.itens.map((i) => (i.numero === 10 && i.codigo === 1 ? { ...i, valor: 0 } : i));
  const l2 = await importar(db, 'vendas_produto_cliente', vendasProdutoCliente({ ...PERIODO, gerado: '2026-07-02 09:00', itens }));
  assert.deepEqual(acoes(l2), { igual: 2, bloqueada: 1 });
  const bloq = (await listarLote(db, l2.id, 'bloqueada'))[0];
  assert.equal(bloq.chave, '10');
  assert.equal(bloq.motivo, 'valor_nao_positivo');
  assert.equal(bloq.linhas.length, 2, 'as 2 linhas da venda');
  assert.equal(l2.previa.resumo.ausentes, 0, 'venda bloqueada não é tratada como ausente');
  await confirmar(db, l2);

  assert.equal(Number(await valor(db, 'select itens_total from public.g3_vendas where numero = 10')), 15.5, 'versão válida anterior preservada');
  const pend = await comoAutenticado(db, ADMIN, async () => (await db.query('select * from public.g3_listar_pendencias()')).rows);
  assert.deepEqual(pend.map((p) => [p.chave, p.motivo, new Date(p.data).toISOString().slice(0, 10)]), [['10', 'valor_nao_positivo', '2026-06-03']]);
  const cob = await cobertura(db, '2026-06-03', '2026-06-04');
  assert.deepEqual(cob.filter((x) => x.layout === 'vendas_produto_cliente').map((x) => x.estado), ['com_pendencias', 'completo']);
  const conc = await conciliacao(db, '2026-06-03', '2026-06-04');
  assert.deepEqual(conc.map((d) => d.estado), ['com_pendencias', 'conciliado']);

  // não há como "ignorar": só um lote posterior válido resolve
  const l3 = await importar(db, 'vendas_produto_cliente', vendasProdutoCliente({ ...PERIODO, gerado: '2026-07-03 09:00', itens: c.itens }));
  assert.deepEqual(acoes(l3), { igual: 3 });
  await confirmar(db, l3);
  assert.equal((await comoAutenticado(db, ADMIN, async () => (await db.query('select * from public.g3_listar_pendencias()')).rows)).length, 0);
  assert.deepEqual((await conciliacao(db, '2026-06-03', '2026-06-03')).map((d) => d.estado), ['conciliado']);
});

test('pendências: aritmética da linha (FaturamGeral/Vendas_Periodo) e mesmo número com outra data (conflito) nunca sobrescrevem', async () => {
  const db = await novoBanco();
  const c = cenario(VENDAS_BASE);
  // FaturamGeral com líquido inconsistente na venda 11 (rodapé coerente com as linhas)
  const fatRuim = faturamentoGeral({ ...PERIODO, vendas: c.fat.map((v) => (v.numero === 11 ? { ...v, liquido: 30 } : v)) });
  const l1 = await importar(db, 'faturamento_geral', fatRuim);
  assert.equal(l1.previa.status, 'previa', JSON.stringify(l1.previa.erros));
  assert.deepEqual(acoes(l1), { nova: 2, bloqueada: 1 });
  assert.equal((await listarLote(db, l1.id, 'bloqueada'))[0].motivo, 'aritmetica_linha');

  const vpRuim = vendasPeriodo({ ...PERIODO, dias: c.dias.map((d, i) => (i === 0 ? { ...d, ganho: 999 } : d)) });
  const l2 = await importar(db, 'vendas_periodo', vpRuim);
  assert.deepEqual(acoes(l2), { nova: 1, bloqueada: 1 });

  await confirmar(db, l1);
  // export posterior traz a venda 10 com OUTRA data: conflito, não sobrescreve
  const fatConflito = faturamentoGeral({ ...PERIODO, gerado: '2026-07-05 09:00',
    vendas: c.fat.map((v) => (v.numero === 10 ? { ...v, dataHora: '2026-06-20 10:00' } : v)) });
  const l3 = await importar(db, 'faturamento_geral', fatConflito);
  const bloqueadas = await listarLote(db, l3.id, 'bloqueada');
  assert.deepEqual(bloqueadas.map((b) => [b.chave, b.motivo]), [['10', 'conflito_numero']]);
  assert.equal(bloqueadas[0].detalhe.data_atual, '2026-06-03');
  await confirmar(db, l3);
  assert.equal(await valor(db, 'select fat_data::text from public.g3_vendas where numero = 10'), '2026-06-03');
});

test('arquivo mais antigo confirmado depois não sobrescreve o mais novo (precedência pela geração no G3)', async () => {
  const db = await novoBanco();
  const novo = cenario([{ ...VENDAS_BASE[0], itens: [{ produto: 'PAO FRANCES', codigo: 1, qtd: 1, valor: 19 }] }]);
  const antigo = cenario([VENDAS_BASE[0]]);
  await importarEConfirmar(db, 'vendas_produto_cliente', vendasProdutoCliente({ ...PERIODO, gerado: '2026-07-10 09:00', itens: novo.itens }));
  const l2 = await importar(db, 'vendas_produto_cliente', vendasProdutoCliente({ ...PERIODO, gerado: '2026-07-01 09:00', itens: antigo.itens }));
  assert.deepEqual(acoes(l2), { superada: 1 });
  await confirmar(db, l2);
  assert.equal(Number(await valor(db, 'select itens_total from public.g3_vendas where numero = 10')), 19);
});

test('prévia desatualizada: confirmar outra importação depois da prévia obriga a gerar a prévia de novo', async () => {
  const db = await novoBanco();
  const { vpc, fat } = relatorios();
  const a = await importar(db, 'vendas_produto_cliente', vpc);
  const b = await importar(db, 'faturamento_geral', fat);
  await confirmar(db, b);
  await assert.rejects(confirmar(db, a), /Previa desatualizada/);
  await comoAutenticado(db, ADMIN, () => db.query('select public.g3_gerar_previa($1)', [a.id]));
  await confirmar(db, a);
  assert.equal(await valor(db, "select count(*)::int from public.g3_vendas where conciliacao = 'conciliada'"), 3);
});

// ---------------------------------------------------------------------------
// Reversão por atestados
// ---------------------------------------------------------------------------

test('reversão: último lote, lote anterior e lote de outro relatório, em qualquer ordem', async () => {
  const db = await novoBanco();
  const { vpc, fat } = relatorios();
  const l1 = await importarEConfirmar(db, 'vendas_produto_cliente', vpc);
  const l2 = await importarEConfirmar(db, 'faturamento_geral', fat);
  const c2 = cenario([{ ...VENDAS_BASE[2], itens: [{ produto: 'CAFE', codigo: 2, qtd: 3, valor: 18 }] }]);
  const l3 = await importarEConfirmar(db, 'vendas_produto_cliente',
    vendasProdutoCliente({ inicio: '2026-06-04', fim: '2026-06-04', gerado: '2026-07-05 09:00', itens: c2.itens }));
  assert.equal(Number(await valor(db, 'select itens_total from public.g3_vendas where numero = 12')), 18);

  // reverter o lote ANTERIOR (l1): a venda 12 continua com a versão de l3; 10 e 11 perdem os itens
  await reverter(db, l1.id);
  const v = (await db.query('select numero, itens_estado, itens_total, conciliacao from public.g3_vendas order by numero')).rows;
  assert.deepEqual(v.map((x) => [Number(x.numero), x.itens_estado, x.conciliacao]),
    [[10, null, 'sem_itens'], [11, null, 'sem_itens'], [12, 'presente', 'divergente']]);
  assert.equal(Number(v[2].itens_total), 18);

  await reverter(db, l3.id);
  assert.equal(await valor(db, "select count(*)::int from public.g3_vendas where itens_estado is not null"), 0);
  await reverter(db, l2.id);
  assert.equal(await valor(db, 'select count(*)::int from public.g3_vendas'), 0);
  assert.equal(await valor(db, 'select count(*)::int from public.g3_estado'), 0);
  assert.equal(await valor(db, 'select count(*)::int from public.g3_atestados'), 3 + 3 + 1, 'histórico preservado');
  await assert.rejects(reverter(db, l2.id), /Somente lotes confirmados/);
  await assert.rejects(reverter(db, l1.id, 'x'), /Somente lotes confirmados/);
  const logs = await valor(db, "select count(*)::int from public.logs_auditoria where entidade = 'g3_importacao' and acao = 'reverteu'");
  assert.equal(logs, 3);
});

test('reversão exige motivo e devolve ausências/pendências ao estado anterior', async () => {
  const db = await novoBanco();
  const { fat } = relatorios();
  await importarEConfirmar(db, 'faturamento_geral', fat);
  const semA11 = cenario(VENDAS_BASE.filter((v) => v.numero !== 11));
  const l2 = await importar(db, 'faturamento_geral', faturamentoGeral({ ...PERIODO, gerado: '2026-07-03 09:00', vendas: semA11.fat }));
  await confirmar(db, l2, { reconhecer: true });
  assert.equal(await valor(db, 'select fat_estado from public.g3_vendas where numero = 11'), 'ausente');
  await assert.rejects(reverter(db, l2.id, ' '), /motivo/);
  await reverter(db, l2.id);
  assert.equal(await valor(db, 'select fat_estado from public.g3_vendas where numero = 11'), 'presente');
});

test('propriedade: qualquer ordem de confirmações e reversões dá o mesmo estado que confirmar só os lotes restantes', async () => {
  // 5 lotes sobrepostos dos 3 relatórios, com correções, ausências e pendência.
  const v = (numero, dataHora, valorItem, extra = {}) => ({ numero, dataHora, itens: [{ produto: 'PAO', codigo: 1, qtd: 1, valor: valorItem }], ...extra });
  const A = [v(1, '2026-06-03 08:00', 10), v(2, '2026-06-03 09:00', 20), v(3, '2026-06-04 09:00', 30)];
  const B = [v(1, '2026-06-03 08:00', 10), v(3, '2026-06-04 09:00', 31), v(4, '2026-06-05 09:00', 40)]; // 2 sumiu, 3 corrigida
  const lotes = [
    ['vendas_produto_cliente', vendasProdutoCliente({ inicio: '2026-06-01', fim: '2026-06-30', gerado: '2026-07-01 09:00', itens: cenario(A).itens })],
    ['vendas_produto_cliente', vendasProdutoCliente({ inicio: '2026-06-01', fim: '2026-06-30', gerado: '2026-07-02 09:00', itens: cenario(B).itens })],
    ['vendas_produto_cliente', vendasProdutoCliente({ inicio: '2026-06-04', fim: '2026-06-04', gerado: '2026-07-03 09:00',
      itens: cenario([v(3, '2026-06-04 09:00', 0)]).itens })], // pendência (valor zero)
    ['faturamento_geral', faturamentoGeral({ inicio: '2026-06-01', fim: '2026-06-30', gerado: '2026-07-01 10:00', vendas: cenario(A).fat })],
    ['faturamento_geral', faturamentoGeral({ inicio: '2026-06-03', fim: '2026-06-05', gerado: '2026-07-04 10:00', vendas: cenario(B).fat })],
  ];
  const nomes = lotes.map((_, i) => `lote${i}.xlsx`);

  async function executar(ordemConfirmacao, reverterIdx) {
    const db = await novoBanco();
    const ids = {};
    // cria todos os lotes na MESMA ordem (precedência fixa) e confirma na ordem pedida
    for (const i of ordemConfirmacao) {
      const [layout, linhas] = lotes[i];
      const lote = await importar(db, layout, linhas, { nome: nomes[i] });
      assert.equal(lote.previa.status, 'previa', JSON.stringify(lote.previa.erros));
      await confirmar(db, lote, { reconhecer: true });
      ids[i] = lote.id;
    }
    for (const i of reverterIdx) await reverter(db, ids[i]);
    return retrato(db);
  }

  const referencia = await executar([0, 1, 3, 4], []);
  const casos = [
    [[4, 3, 1, 0], []],
    [[1, 0, 4, 3], []],
    [[0, 1, 2, 3, 4], [2]],
    [[2, 4, 0, 3, 1], [2]],
    [[3, 2, 1, 0, 4], [2]],
  ];
  for (const [ordem, rev] of casos) {
    const r = await executar(ordem, rev);
    assert.deepEqual(r.vendas, referencia.vendas, `vendas: ordem ${ordem} revertendo ${rev}`);
    assert.deepEqual(r.itens, referencia.itens, `itens: ordem ${ordem} revertendo ${rev}`);
    assert.deepEqual(r.estado.map((e) => ({ ...e, lote: undefined })), referencia.estado.map((e) => ({ ...e, lote: undefined })),
      `estado: ordem ${ordem} revertendo ${rev}`);
  }
  // e o resultado tem as regras esperadas: 2 ausente nos itens, 3 corrigida (31), 4 nova
  const v2 = referencia.vendas.find((x) => Number(x.numero) === 2);
  assert.equal(v2.itens_estado, 'ausente');
  assert.equal(Number(referencia.vendas.find((x) => Number(x.numero) === 3).itens_total), 31);
});

// ---------------------------------------------------------------------------
// Retenção
// ---------------------------------------------------------------------------

test('retenção: descartar apaga as linhas; lote interrompido expira em 24h; revertido perde linhas brutas após 90 dias', async () => {
  const db = await novoBanco();
  const { vpc, fat, vp } = relatorios();
  const d = await importar(db, 'vendas_periodo', vp);
  await comoAutenticado(db, ADMIN, () => db.query('select public.g3_descartar_importacao($1)', [d.id]));
  assert.equal(await valor(db, 'select status from public.g3_importacoes where id = $1', [d.id]), 'descartado');
  assert.equal(await valor(db, 'select count(*)::int from public.g3_importacao_linhas where lote_id = $1', [d.id]), 0);
  await comoAutenticado(db, ADMIN, () => assert.rejects(db.query('select public.g3_descartar_importacao($1)', [d.id]), /nao confirmados/));

  const parado = await importar(db, 'faturamento_geral', fat);
  const conf = await importarEConfirmar(db, 'vendas_produto_cliente', vpc);
  await reverter(db, conf.id);
  await db.exec(`begin; select set_config('g3.operacao', 'on', true);
    update public.g3_importacoes set criado_em = now() - interval '25 hours' where id = '${parado.id}';
    update public.g3_importacoes set revertido_em = now() - interval '91 days' where id = '${conf.id}'; commit;`);
  const r = await comoAutenticado(db, ADMIN, () => valor(db, 'select public.g3_limpar()'));
  assert.deepEqual(r, { expirados: 1, revertidos_purgados: 1 });
  assert.equal(await valor(db, 'select status from public.g3_importacoes where id = $1', [parado.id]), 'expirado');
  assert.equal(await valor(db, 'select count(*)::int from public.g3_importacao_linhas where lote_id in ($1, $2)', [parado.id, conf.id]), 0);
  assert.equal(await valor(db, 'select count(*)::int from public.g3_atestados where lote_id = $1', [conf.id]), 3, 'atestados (histórico) ficam');
  const espaco = await comoAutenticado(db, ADMIN, async () => (await db.query('select * from public.g3_espaco_ocupado()')).rows);
  assert.equal(espaco.length, 11);
});

// ---------------------------------------------------------------------------
// Desempenho
// ---------------------------------------------------------------------------

test('desempenho: ~42 mil linhas de itens (14 mil vendas) em um lote, prévia e confirmação; reenvio idêntico', async () => {
  const db = await novoBanco();
  const vendas = vendasEmMassa({ quantidade: 14000, dias: 60, itensPorVenda: 3 });
  const c = cenario(vendas);
  const linhas = vendasProdutoCliente({ inicio: '2026-06-01', fim: '2026-07-31', gerado: '2026-08-01 08:00', itens: c.itens });
  let t = Date.now();
  const lote = await importar(db, 'vendas_produto_cliente', linhas);
  const tPrevia = Date.now() - t;
  assert.equal(lote.previa.status, 'previa', JSON.stringify(lote.previa.erros));
  assert.equal(lote.previa.resumo.chaves, 14000);
  t = Date.now();
  await confirmar(db, lote);
  const tConfirmar = Date.now() - t;
  assert.equal(await valor(db, 'select count(*)::int from public.g3_venda_itens'), 42000);

  const linhas2 = vendasProdutoCliente({ inicio: '2026-06-01', fim: '2026-07-31', gerado: '2026-08-02 08:00', itens: c.itens });
  t = Date.now();
  const l2 = await importar(db, 'vendas_produto_cliente', linhas2);
  await confirmar(db, l2);
  const tReenvio = Date.now() - t;
  assert.deepEqual(acoes(l2), { igual: 14000 });
  console.log(`[0081 desempenho] envio+previa=${tPrevia}ms confirmar=${tConfirmar}ms reenvio(envio+previa+confirmar)=${tReenvio}ms`);
  // limites folgados para o PGlite (WASM, 1 thread); no Supabase cada RPC tem teto de 30-45 s
  assert.ok(tConfirmar < 30000, `confirmar em ${tConfirmar}ms`);
});

// ---------------------------------------------------------------------------
// Auditorias PRE/POS
// ---------------------------------------------------------------------------

test('SQLs PRE/POS da raiz rodam e o EXECUTAR é byte-idêntico à migration', async (t) => {
  if (!existsSync(PRE) || !existsSync(POS) || !existsSync(EXECUTAR)) {
    t.skip('arquivos PRE/POS/EXECUTAR ausentes nesta cópia (não versionados)');
    return;
  }
  assert.ok(readFileSync(EXECUTAR).equals(readFileSync(join(RAIZ, 'supabase', 'migrations', M81))), 'EXECUTAR difere da migration');
  const antes = await bancoSem81();
  const pre = (await antes.query(readFileSync(PRE, 'utf8'))).rows;
  assert.ok(pre.length > 0, 'PRE devolve linhas');
  assert.deepEqual(pre.filter((l) => l.status === 'FALHA').map((l) => l.verificacao), [], 'PRE: nenhuma FALHA antes da 0081');
  const depois = await banco();
  const pos = (await depois.query(readFileSync(POS, 'utf8'))).rows;
  assert.ok(pos.length > 0, 'POS devolve linhas');
  assert.deepEqual(pos.filter((l) => l.status === 'FALHA').map((l) => l.verificacao), [], 'POS: nenhuma FALHA depois da 0081');
});
