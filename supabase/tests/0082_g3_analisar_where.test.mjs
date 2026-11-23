// Testes da migration 0082 (correção de public.g3_analisar: o UPDATE de
// classificação das linhas ganha "where tipo is null"). Em produção a prévia
// falhava pelo app com "UPDATE requires a WHERE clause": as conexões da API do
// Supabase carregam a extensão pg_safeupdate, que o PGlite NÃO tem -- por isso
// a guarda principal aqui é o detector estático (semWhere.mjs), aplicado às
// definições EFETIVAS das funções no banco. Relatórios 100% FICTÍCIOS.
// Nada aqui toca o Supabase real.
//
//   npm i --no-save @electric-sql/pglite
//   node --test --test-concurrency=1 supabase/tests/0082_g3_analisar_where.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  ADMIN, RAIZ, como, fabricaDeBancos, fecharBancos, valor, aplicarMigration, lerMigration,
} from './ambiente_pedidos.mjs';
import { comandosSemWhere } from './semWhere.mjs';
import { dividirInstrucoes, executarComoEditorPorInstrucao } from './editorSql.mjs';
import {
  vendasProdutoCliente, faturamentoGeral, vendasPeriodo, cenario, vendasEmMassa,
} from '../../lib/importacoes/__tests__/relatoriosFicticios.mjs';

const M81 = '0081_importacoes_g3.sql';
const M82 = '0082_g3_analisar_where.sql';
const BASE = ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql', '0075_preferencias_usuario_mensagem_pedido.sql', '0080_central_notificacoes.sql'];
const PRE = join(RAIZ, '0082_pre_auditoria_g3_analisar_where_EXECUTAR.sql');
const POS = join(RAIZ, '0082_pos_auditoria_g3_analisar_where_EXECUTAR.sql');
const EXECUTAR = join(RAIZ, '0082_g3_analisar_where_EXECUTAR.sql');

const MD5_0081 = 'cede04b9168f569076dd6c74b9eb3102';
const MD5_0082 = '05e3f84a8e1ebbd2545e3f6a2edd1a04';
const LINHA_ANTIGA = '      end;';
const LINHAS_NOVAS = ['      end', '     where tipo is null;'];

after(fecharBancos);

const banco81 = fabricaDeBancos({ extras: [...BASE, M81] });
const banco82 = fabricaDeBancos({ extras: [...BASE, M81, M82] });
const bancoSem81 = fabricaDeBancos({ extras: BASE });

async function comoAutenticado(db, uid, fn) {
  await como(db, uid);
  await db.exec('set role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

const sha = (texto) => createHash('sha256').update(texto).digest('hex');

// Estado em que a tentativa de produção parou: lote criado e TODAS as linhas
// recebidas (cada RPC é uma transação), sem prévia.
async function iniciarEEnviar(db, layout, linhas, { bloco = 2000, marca = '' } = {}) {
  return comoAutenticado(db, ADMIN, async () => {
    const id = await valor(db, 'select public.g3_iniciar_importacao($1, $2, $3, $4, $5::jsonb, $6)', [
      layout, 'relatorio.xlsx', 1000, sha(JSON.stringify([layout, linhas, marca])),
      JSON.stringify({ abas: 1, formulas: 0, macros: false, original: true, produtor: 'SheetJS' }),
      linhas.length,
    ]);
    for (let i = 0; i < linhas.length; i += bloco) {
      await db.query('select public.g3_enviar_linhas($1, $2, $3::jsonb)', [id, i + 1, JSON.stringify(linhas.slice(i, i + bloco))]);
    }
    return id;
  });
}

const gerarPrevia = (db, id) => comoAutenticado(db, ADMIN, () => valor(db, 'select public.g3_gerar_previa($1)', [id]));

async function importar(db, layout, linhas, opcoes) {
  const id = await iniciarEEnviar(db, layout, linhas, opcoes);
  return { id, previa: await gerarPrevia(db, id) };
}

async function confirmar(db, id, reconhecer = false) {
  return comoAutenticado(db, ADMIN, async () => {
    const base = await valor(db, 'select estado_base from public.g3_importacoes where id = $1', [id]);
    return valor(db, 'select public.g3_confirmar_importacao($1, $2, $3)', [id, base, reconhecer]);
  });
}

const md5Analisar = (db) => valor(db, "select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.g3_analisar(uuid)'::regprocedure");
const corpoAnalisar = async (db) => (await valor(db, "select prosrc from pg_proc where oid = 'public.g3_analisar(uuid)'::regprocedure")).replace(/\r/g, '');

// Relatórios fictícios
const VENDAS_BASE = [
  { numero: 10, dataHora: '2026-06-03 08:10', itens: [{ produto: 'PAO FRANCES', codigo: 1, qtd: 0.5, valor: 9.5 }, { produto: 'CAFE', codigo: 2, qtd: 1, valor: 6 }] },
  { numero: 11, dataHora: '2026-06-03 09:00', itens: [{ produto: 'BOLO', codigo: 3, qtd: 1, valor: 25 }], descontoRateado: 2.5 },
  { numero: 12, dataHora: '2026-06-04 10:30', itens: [{ produto: 'CAFE', codigo: 2, qtd: 1, valor: 6 }, { produto: 'CAFE', codigo: 2, qtd: 1, valor: 6 }] },
];
const PERIODO = { inicio: '2026-06-01', fim: '2026-06-30', gerado: '2026-07-01 09:00' };

// Mesmo formato da tentativa real: Vendas_Periodo DIÁRIO de 01/01 a 30/11/2026,
// gerado em 22/11/2026 12:46, 186 linhas (167 dias com venda, valores fictícios).
function vendasPeriodo186() {
  const dias = [];
  const inicio = Date.UTC(2026, 5, 9); // 09/06/2026 .. 22/11/2026 = 167 dias
  for (let k = 0; k < 167; k += 1) {
    const dia = new Date(inicio + k * 86400000).toISOString().slice(0, 10);
    dias.push({ dia, venda: Math.round((800 + ((k * 37) % 400) + (k % 7) * 0.35) * 100) / 100 });
  }
  const linhas = vendasPeriodo({ inicio: '2026-01-01', fim: '2026-11-30', gerado: '2026-11-22 12:46', dias });
  assert.equal(linhas.length, 186, 'relatório fictício com 186 linhas, como o real');
  return linhas;
}

// ---------------------------------------------------------------------------
// 1. Detector estático (a guarda contra o defeito)
// ---------------------------------------------------------------------------

test('detector: acusa UPDATE/DELETE sem WHERE e ignora os casos legítimos', () => {
  const acusa = [
    'update t set a = 1;',
    "update pg_temp.g3_l set tipo = case when ncel = 0 then 'vazia' end;",
    'delete from public.t;',
    'update t set a = (select max(x) from u where u.id = t.id);', // WHERE só na subconsulta
    'with w as (select 1) update only public.t as x set a = 1;',
    'UPDATE "T" SET a = 1',
    'select 1 from (update t set a = 1 returning a) x;',
  ];
  for (const sql of acusa) assert.equal(comandosSemWhere(sql).length, 1, `devia acusar: ${sql}`);

  const aceita = [
    'update t set a = 1 where id = 1;',
    'update public.t g set a = k.b from pg_temp.k k where g.id = k.id;',
    'update public.g3_configuracao set versao_estado = versao_estado + 1 where id;',
    'delete from public.t e using pg_temp.k k where e.id = k.id;',
    'insert into t (a) values (1) on conflict (a) do update set a = excluded.a;',
    'select * from t where id = 1 for update;',
    'select * from t for no key update;',
    'create trigger x before update or delete on t for each row execute function f();',
    'grant select, update, delete on t to authenticated;',
    'create policy p on t for update using (true);',
    "alter table t add constraint f foreign key (a) references u on update cascade on delete set null;",
    "select 'update t set a = 1;';",
    "select E'it\\'s update t set a = 1;';",
    '-- update t set a = 1;\nselect 1;',
    '/* delete from t; */ select 1;',
    "execute format($f$update %I set a = 1$f$, 't');",
    'update t set a = 1 where current of c;',
  ];
  for (const sql of aceita) assert.deepEqual(comandosSemWhere(sql), [], `não devia acusar: ${sql}`);
});

test('detector na 0081 original: acusa EXATAMENTE o UPDATE de classificação de g3_analisar (prova que pegaria o defeito)', () => {
  const sql = lerMigration(M81).replace(/\r/g, '');
  const achados = comandosSemWhere(sql);
  const linha = sql.split('\n').findIndex((l) => l.includes('update pg_temp.g3_l set tipo = case')) + 1;
  assert.ok(linha > 0);
  assert.deepEqual(achados.map((a) => [a.linha, a.comando]), [[linha, 'UPDATE']]);
  const inicio = sql.indexOf('create function public.g3_analisar(');
  const fim = sql.indexOf('\n$$;\n', inicio);
  const pos = sql.split('\n').slice(0, linha - 1).join('\n').length;
  assert.ok(pos > inicio && pos < fim, 'o achado está dentro de g3_analisar');
});

test('detector na 0082 e em TODAS as migrations versionadas: nenhum outro UPDATE/DELETE sem WHERE', () => {
  assert.deepEqual(comandosSemWhere(lerMigration(M82)), []);
  const achados = readdirSync(join(RAIZ, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort()
    .flatMap((f) => comandosSemWhere(lerMigration(f)).map((a) => `${f}:${a.linha}`));
  const linha81 = lerMigration(M81).replace(/\r/g, '').split('\n').findIndex((l) => l.includes('update pg_temp.g3_l set tipo = case')) + 1;
  assert.deepEqual(achados, [`${M81}:${linha81}`], 'só o defeito da 0081 (corrigido pela 0082 na definição efetiva)');
});

test('definições EFETIVAS no banco (0001..0082): nenhuma função do schema public tem UPDATE/DELETE sem WHERE', async () => {
  const db = await banco82();
  const funcoes = (await db.query(`
    select p.oid::regprocedure::text as nome, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and l.lanname in ('plpgsql', 'sql')`)).rows;
  assert.ok(funcoes.length > 100, `funções conferidas: ${funcoes.length}`);
  const problemas = funcoes.flatMap((f) => comandosSemWhere(f.prosrc).map((a) => `${f.nome}: ${a.trecho}`));
  assert.deepEqual(problemas, []);

  const so81 = await banco81();
  const corpo81 = (await so81.query("select prosrc from pg_proc where oid = 'public.g3_analisar(uuid)'::regprocedure")).rows[0].prosrc;
  assert.equal(comandosSemWhere(corpo81).length, 1, 'com só a 0081, g3_analisar tem o UPDATE sem WHERE');
});

// ---------------------------------------------------------------------------
// 2. A única alteração é o filtro WHERE
// ---------------------------------------------------------------------------

test('arquivo: o corpo de g3_analisar na 0082 é o da 0081 com uma única linha trocada', () => {
  const extrair = (sql, prefixo) => {
    const s = sql.replace(/\r/g, '');
    const i = s.indexOf(`${prefixo} public.g3_analisar(p_lote uuid)`);
    assert.ok(i >= 0, prefixo);
    const a = s.indexOf('as $$\n', i);
    const b = s.indexOf('\n$$;\n', a);
    return { cabecalho: s.slice(i + prefixo.length, a), corpo: s.slice(a + 5, b + 1) };
  };
  const v81 = extrair(lerMigration(M81), 'create function');
  const v82 = extrair(lerMigration(M82), 'create or replace function');
  assert.equal(v82.cabecalho, v81.cabecalho, 'mesma assinatura, linguagem, volatilidade, SECURITY DEFINER e search_path');
  assert.equal(createHash('md5').update(v81.corpo).digest('hex'), MD5_0081);
  assert.equal(createHash('md5').update(v82.corpo).digest('hex'), MD5_0082);

  const a = v81.corpo.split('\n');
  const b = v82.corpo.split('\n');
  assert.equal(b.length, a.length + 1);
  const i = a.findIndex((l, k) => l !== b[k]);
  assert.equal(a[i], LINHA_ANTIGA);
  assert.deepEqual(b.slice(i, i + 2), LINHAS_NOVAS);
  assert.deepEqual(b.slice(i + 2), a.slice(i + 1), 'todo o resto é idêntico');
  assert.match(a[i - 1], /then 'resumo'$/);

  // a 0082 não cria/altera mais nada: um único CREATE, nenhum grant/revoke/alter/drop/DML fora da conferência
  // fora o corpo da função (que é o da 0081), a 0082 não cria/altera mais nada
  const m82 = lerMigration(M82).replace(/\r/g, '');
  const ini = m82.indexOf('as $$\n', m82.indexOf('create or replace function public.g3_analisar'));
  const sem = (m82.slice(0, ini) + m82.slice(m82.indexOf('\n$$;\n', ini))).replace(/--[^\n]*/g, '');
  assert.equal((sem.match(/\bcreate\s+(or\s+replace\s+)?function\b/gi) || []).length, 1);
  assert.doesNotMatch(sem.replace(/\bon commit drop\b/gi, ''), /\b(grant|revoke|alter|drop|insert\s+into|truncate|delete\s+from|update\s+[\w.]+\s+set)\b/i);
  assert.equal((sem.match(/\bcreate\s+temp\s+table\b/gi) || []).length, 1, 'só a tabela temporária do retrato (on commit drop)');
});

test('banco: só o corpo de g3_analisar muda; dono, privilégios, atributos e todo o resto do schema ficam iguais', async () => {
  const db = await banco81();
  const atributos = `select to_jsonb(p) - 'prosrc' - 'oid' as a from pg_proc p where p.oid = 'public.g3_analisar(uuid)'::regprocedure`;
  const resto = [
    `select string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '') || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), ''), '|' order by p.oid::regprocedure::text)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.oid <> 'public.g3_analisar(uuid)'::regprocedure`,
    "select string_agg(c.relname || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity, '|' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'",
    'select string_agg(polname || pg_get_expr(polqual, polrelid), \'|\' order by polname) from pg_policy',
    "select string_agg(tgname || tgrelid::regclass::text, '|' order by tgname) from pg_trigger where not tgisinternal",
    "select string_agg(table_name || '.' || column_name || ':' || data_type, ',' order by table_name, column_name) from information_schema.columns where table_schema = 'public'",
    'select count(*)::int from public.permissoes',
    'select count(*)::int from public.perfil_permissoes',
  ];
  const antes = { attr: await valor(db, atributos), corpo: await corpoAnalisar(db), resto: [] };
  for (const q of resto) antes.resto.push(await valor(db, q));
  assert.equal(await md5Analisar(db), MD5_0081);

  await aplicarMigration(db, M82);

  assert.deepEqual(await valor(db, atributos), antes.attr, 'pg_proc idêntico exceto prosrc (dono, ACL, secdef, config, volatilidade, linguagem, tipos)');
  for (const [k, q] of resto.entries()) assert.equal(await valor(db, q), antes.resto[k], `inalterado: ${q.slice(0, 70)}`);
  assert.equal(await md5Analisar(db), MD5_0082);
  const depois = await corpoAnalisar(db);
  const i = antes.corpo.indexOf(`then 'resumo'\n${LINHA_ANTIGA}\n`);
  assert.ok(i > 0);
  assert.equal(depois, antes.corpo.replace(`then 'resumo'\n${LINHA_ANTIGA}\n`, `then 'resumo'\n${LINHAS_NOVAS.join('\n')}\n`));

  // os STUBS do teste dão EXECUTE por padrão (default privileges) a anon/authenticated:
  // o CREATE OR REPLACE não reaplica esse padrão.
  for (const papel of ['anon', 'authenticated', 'service_role']) {
    assert.equal(await valor(db, "select has_function_privilege($1, 'public.g3_analisar(uuid)', 'EXECUTE')", [papel]), false, papel);
  }
  assert.equal(await valor(db, "select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'g3\\_%'"), 33);
});

// ---------------------------------------------------------------------------
// 3. Guardas da 0082
// ---------------------------------------------------------------------------

test('guardas: sem a 0081 aborta; reaplicar aborta; g3_analisar diferente da 0081 aborta -- nada é alterado', async () => {
  const sem81 = await bancoSem81();
  await assert.rejects(aplicarMigration(sem81, M82), /0081 .* nao esta aplicada/);
  await sem81.exec('rollback');
  assert.equal(await valor(sem81, "select to_regprocedure('public.g3_analisar(uuid)') is null"), true);

  const ja = await banco82();
  await assert.rejects(aplicarMigration(ja, M82), /ja aplicada/);
  await ja.exec('rollback');
  assert.equal(await md5Analisar(ja), MD5_0082);

  const outra = await banco81();
  const corpo = await valor(outra, "select prosrc from pg_proc where oid = 'public.g3_analisar(uuid)'::regprocedure");
  await outra.exec(`create or replace function public.g3_analisar(p_lote uuid) returns void language plpgsql volatile security definer set search_path = '' as $corpo$${corpo}-- alterada fora da migration\n$corpo$;`);
  const md5Outra = await md5Analisar(outra);
  await assert.rejects(aplicarMigration(outra, M82), /difere da versao da 0081/);
  await outra.exec('rollback');
  assert.equal(await md5Analisar(outra), md5Outra, 'nada foi trocado');
});

test('conferência pós-troca: se authenticated pudesse executar g3_analisar, a 0082 desfaz tudo', async () => {
  const db = await banco81();
  await db.exec("grant execute on function public.g3_analisar(uuid) to authenticated");
  await assert.rejects(aplicarMigration(db, M82), /conferencia/);
  await db.exec('rollback');
  assert.equal(await md5Analisar(db), MD5_0081, 'corpo antigo preservado (transação desfeita)');
});

test('0081 aplicada com quebras de linha CRLF (colagem no SQL Editor): a guarda reconhece e a 0082 aplica', async () => {
  // mesmo banco base do ambiente, mas a 0081 entra com CRLF
  const base = await bancoSem81();
  const dump = await base.dumpDataDir('none');
  const crlf = new PGlite({ loadDataDir: dump });
  await crlf.waitReady;
  try {
    await crlf.exec(lerMigration(M81).replace(/\r?\n/g, '\r\n'));
    assert.match(await valor(crlf, "select prosrc from pg_proc where oid = 'public.g3_analisar(uuid)'::regprocedure"), /\r\n/);
    assert.equal(await md5Analisar(crlf), MD5_0081);
    await aplicarMigration(crlf, M82);
    assert.equal(await md5Analisar(crlf), MD5_0082);
  } finally {
    await crlf.close();
  }
});

// ---------------------------------------------------------------------------
// 4. Prévias dos três layouts: mesmo resultado com e sem a 0082
// ---------------------------------------------------------------------------

async function retratoLote(db, id) {
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  return {
    lote: (await q(`select status, erros, alertas, totais, resumo, gerado_em, usuario_g3, periodo_inicio, periodo_fim,
                           cobertura_completa_fim, dia_parcial, filtros, estado_base, linhas_total, linhas_recebidas
                    from public.g3_importacoes where id = $1`, [id]))[0],
    previa: await q("select to_jsonb(p) - 'lote_id' - 'id' as r from public.g3_previa p where lote_id = $1 order by faceta, chave", [id]),
  };
}

async function retratoBanco(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    estado: await q("select faceta, chave, estado, data, (select hash from public.g3_conteudos c where c.id = e.conteudo_id) as hash from public.g3_estado e order by 1, 2"),
    vendas: await q('select numero, itens_estado, itens_total, fat_estado, prod, liquido, conciliacao from public.g3_vendas order by numero'),
    itens: await q('select numero, codigo, ordinal, quantidade, valor from public.g3_venda_itens order by 1, 2, 3'),
    dias: await q('select dia, estado, venda, liquido_sem_taxa from public.g3_vendas_diarias order by dia'),
    pendencias: await q('select faceta, chave, data, motivo, detalhe, linhas, valor from public.g3_pendencias order by 1, 2, 4'),
  };
}

function cenarios() {
  const c = cenario(VENDAS_BASE);
  const massa = cenario(vendasEmMassa({ quantidade: 300, inicio: '2026-07-01', dias: 31, primeiroNumero: 5001 }));
  const JULHO = { inicio: '2026-07-01', fim: '2026-07-31', gerado: '2026-08-01 08:00' };
  return [
    // [rótulo, layout, linhas, confirmar?]
    ['itens (Vendas_ProdCliente)', 'vendas_produto_cliente', vendasProdutoCliente({ ...PERIODO, itens: c.itens }), true],
    ['faturamento (FaturamGeral)', 'faturamento_geral', faturamentoGeral({ ...PERIODO, vendas: c.fat }), true],
    ['dias (Vendas_Periodo)', 'vendas_periodo', vendasPeriodo({ ...PERIODO, dias: c.dias }), true],
    ['Vendas_Periodo 186 linhas jan-nov', 'vendas_periodo', vendasPeriodo186(), true],
    ['itens em massa (900 linhas)', 'vendas_produto_cliente', vendasProdutoCliente({ ...JULHO, itens: massa.itens }), true],
    ['faturamento em massa', 'faturamento_geral', faturamentoGeral({ ...JULHO, vendas: massa.fat }), true],
    ['rejeita: filtro de seção', 'vendas_produto_cliente', vendasProdutoCliente({ ...PERIODO, itens: c.itens, filtrosExtras: [['Seção/Categoria', 'SALGADO']] }), false],
    ['rejeita: agrupado MENSAL', 'vendas_periodo', vendasPeriodo({ ...PERIODO, dias: c.dias, agrupado: 'MENSAL' }), false],
    ['rejeita: layout trocado', 'vendas_periodo', vendasProdutoCliente({ ...PERIODO, itens: c.itens }), false],
    ['rejeita: rodapé não fecha', 'vendas_periodo', vendasPeriodo({ ...PERIODO, dias: c.dias, ajusteRodape: { 'Total Vendas': 1 } }), false],
    ['pendência: aritmética (faturamento)', 'faturamento_geral', faturamentoGeral({ ...PERIODO, gerado: '2026-07-02 09:00', vendas: c.fat.map((v) => (v.numero === 11 ? { ...v, liquido: 30 } : v)) }), true],
    ['pendência: ganho (dias)', 'vendas_periodo', vendasPeriodo({ ...PERIODO, gerado: '2026-07-02 09:00', dias: c.dias.map((d, i) => (i === 0 ? { ...d, ganho: 999 } : d)) }), true],
  ];
}

test('prévias dos três layouts (e rejeições/pendências): resultado IDÊNTICO com só a 0081 e com 0081+0082', async () => {
  const sem = await banco81();
  const com = await banco82();
  assert.equal(await md5Analisar(sem), MD5_0081);
  assert.equal(await md5Analisar(com), MD5_0082);
  const status = {};
  for (const [rotulo, layout, linhas, conf] of cenarios()) {
    const a = await importar(sem, layout, linhas);
    const b = await importar(com, layout, linhas);
    assert.deepEqual(b.previa, a.previa, `${rotulo}: retorno da prévia`);
    assert.deepEqual(await retratoLote(com, b.id), await retratoLote(sem, a.id), `${rotulo}: lote e linhas da prévia`);
    status[rotulo] = b.previa.status;
    if (conf && b.previa.status === 'previa') {
      await confirmar(sem, a.id, true);
      await confirmar(com, b.id, true);
    }
  }
  assert.deepEqual(await retratoBanco(com), await retratoBanco(sem), 'estado, vendas, itens, dias e pendências idênticos');
  assert.deepEqual(status, {
    'itens (Vendas_ProdCliente)': 'previa',
    'faturamento (FaturamGeral)': 'previa',
    'dias (Vendas_Periodo)': 'previa',
    'Vendas_Periodo 186 linhas jan-nov': 'previa',
    'itens em massa (900 linhas)': 'previa',
    'faturamento em massa': 'previa',
    'rejeita: filtro de seção': 'rejeitado',
    'rejeita: agrupado MENSAL': 'rejeitado',
    'rejeita: layout trocado': 'rejeitado',
    'rejeita: rodapé não fecha': 'rejeitado',
    'pendência: aritmética (faturamento)': 'previa',
    'pendência: ganho (dias)': 'previa',
  });
  assert.ok((await retratoBanco(com)).pendencias.length >= 2, 'pendências geradas');
});

test('Vendas_Periodo de 186 linhas (formato da tentativa real): prévia com 167 dias novos e confirmação', async () => {
  const db = await banco82();
  const r = await importar(db, 'vendas_periodo', vendasPeriodo186());
  assert.equal(r.previa.status, 'previa', JSON.stringify(r.previa.erros));
  assert.deepEqual(r.previa.resumo.por_acao, { nova: 167 });
  const l = (await db.query('select arquivo_nome, periodo_inicio, periodo_fim from public.g3_importacoes where id = $1', [r.id])).rows[0];
  assert.equal(l.arquivo_nome, 'Vendas_Periodo.xlsx');
  await confirmar(db, r.id);
  assert.equal(await valor(db, 'select count(*)::int from public.g3_vendas_diarias'), 167);
});

// ---------------------------------------------------------------------------
// 5. Lotes pendentes da tentativa que falhou (recuperação, descarte, expiração)
// ---------------------------------------------------------------------------

test('lotes parados em "recebendo" ANTES da 0082: depois dela a prévia sai, e dá para confirmar, descartar, deixar expirar ou reenviar', async () => {
  const db = await banco81();
  const c = cenario(VENDAS_BASE);
  const vp186 = vendasPeriodo186();
  const fat = faturamentoGeral({ ...PERIODO, vendas: c.fat });
  const vpc = vendasProdutoCliente({ ...PERIODO, itens: c.itens });

  // estado deixado pela tentativa: lotes criados + linhas recebidas, sem prévia
  const recuperar = await iniciarEEnviar(db, 'vendas_periodo', vp186);
  const descartar = await iniciarEEnviar(db, 'faturamento_geral', fat);
  const expirar = await iniciarEEnviar(db, 'vendas_produto_cliente', vpc);
  const reenviar = await iniciarEEnviar(db, 'faturamento_geral', fat, { marca: 'segunda tentativa' });
  const pendentes = [recuperar, descartar, expirar, reenviar];
  for (const id of pendentes) {
    const l = (await db.query('select status, linhas_total, linhas_recebidas from public.g3_importacoes where id = $1', [id])).rows[0];
    assert.equal(l.status, 'recebendo');
    assert.equal(l.linhas_recebidas, l.linhas_total);
  }
  assert.equal(await valor(db, 'select count(*)::int from public.g3_previa'), 0);
  assert.equal(await valor(db, 'select count(*)::int from public.g3_estado'), 0);
  assert.equal(await valor(db, "select count(*)::int from public.logs_auditoria where entidade = 'g3_importacao'"), 0, 'criar/enviar não gera auditoria');

  await aplicarMigration(db, M82);
  assert.equal(await md5Analisar(db), MD5_0082);

  // 1) recuperar: a prévia do MESMO lote sai e confirma
  const p = await gerarPrevia(db, recuperar);
  assert.equal(p.status, 'previa', JSON.stringify(p.erros));
  assert.deepEqual(p.resumo.por_acao, { nova: 167 });
  await confirmar(db, recuperar);
  assert.equal(await valor(db, 'select status from public.g3_importacoes where id = $1', [recuperar]), 'confirmado');
  assert.equal(await valor(db, 'select count(*)::int from public.g3_vendas_diarias'), 167);
  assert.equal(await valor(db, "select count(*)::int from public.logs_auditoria where entidade = 'g3_importacao' and acao = 'confirmou' and registro_id = $1", [recuperar]), 1);

  // 2) descartar direto em "recebendo" (sem gerar prévia)
  await comoAutenticado(db, ADMIN, () => db.query('select public.g3_descartar_importacao($1)', [descartar]));
  assert.equal(await valor(db, 'select status from public.g3_importacoes where id = $1', [descartar]), 'descartado');
  assert.equal(await valor(db, 'select count(*)::int from public.g3_importacao_linhas where lote_id = $1', [descartar]), 0);

  // 3) reenviar o mesmo relatório com o lote antigo ainda pendente: novo lote normal
  const novo = await importar(db, 'faturamento_geral', fat, { marca: 'reenvio' });
  assert.equal(novo.previa.status, 'previa');
  await confirmar(db, novo.id);
  // o pendente antigo do mesmo conteúdo continua descartável
  await comoAutenticado(db, ADMIN, () => db.query('select public.g3_descartar_importacao($1)', [reenviar]));
  assert.equal(await valor(db, 'select status from public.g3_importacoes where id = $1', [reenviar]), 'descartado');

  // 4) expirar: passadas 24h, a limpeza marca como expirado e apaga as linhas
  await db.exec(`begin; select set_config('g3.operacao', 'on', true);
    update public.g3_importacoes set criado_em = now() - interval '25 hours' where id = '${expirar}'; commit;`);
  const r = await comoAutenticado(db, ADMIN, () => valor(db, 'select public.g3_limpar()'));
  assert.equal(r.expirados, 1);
  assert.equal(await valor(db, 'select status from public.g3_importacoes where id = $1', [expirar]), 'expirado');
  assert.equal(await valor(db, 'select count(*)::int from public.g3_importacao_linhas where lote_id = $1', [expirar]), 0);
  assert.equal(await valor(db, "select count(*)::int from public.g3_importacoes where status = 'recebendo'"), 0);
});

// ---------------------------------------------------------------------------
// 5b. Execução como no SQL Editor (incidente 42P01 "g3_0082_antes")
// ---------------------------------------------------------------------------

test('divisor de instruções: respeita $$...$$, $tag$, literais e comentários', () => {
  assert.deepEqual(dividirInstrucoes("begin; do $$ begin perform 1; end $$; select 'a;b'; -- x;\n/* y; */ commit;"),
    ['begin', 'do $$ begin perform 1; end $$', "select 'a;b'", '-- x;\n/* y; */ commit']);
  assert.deepEqual(dividirInstrucoes(lerMigration(M82)).map((t) => t.replace(/--[^\n]*\n/g, '').trim().split(/\s+/).slice(0, 3).join(' ')),
    ['BEGIN', 'DO $$ declare', 'create temp table', 'create or replace', 'DO $$ declare', 'COMMIT']);
});

test('REPRODUÇÃO do incidente: instrução por instrução, o script atual troca a função e SÓ DEPOIS falha com 42P01', async () => {
  const db = await banco81();
  const r = await executarComoEditorPorInstrucao(db, lerMigration(M82));
  assert.equal(r.erro?.code, '42P01');
  assert.match(r.erro.message, /g3_0082_antes" does not exist/);
  assert.deepEqual(r.executadas, ['BEGIN', 'ok', 'ok', 'ok'], 'guarda, tabela temporária (já descartada) e CREATE OR REPLACE rodaram; a conferência falhou');
  assert.equal(await md5Analisar(db), MD5_0082, 'a função JÁ foi trocada (cada instrução confirmou sozinha)');

  // nesse estado: a POS (só leitura) passa inteira, e reexecutar o script é barrado pela guarda
  if (existsSync(POS)) {
    const pos = (await db.query(readFileSync(POS, 'utf8'))).rows;
    assert.deepEqual(pos.filter((l) => l.status === 'FALHA').map((l) => l.verificacao), []);
  }
  const de_novo = await executarComoEditorPorInstrucao(db, lerMigration(M82));
  assert.match(String(de_novo.erro?.message), /ja aplicada/);
  assert.equal(await md5Analisar(db), MD5_0082);
});

test('modo SQL Editor (instrução por instrução, sem transação entre elas): a migration é atômica -- aplica e confere tudo, ou não altera nada',
  { todo: 'limitação conhecida da 0082 já aplicada (incidente 42P01 no SQL Editor); não corrigida para manter o histórico fiel ao que rodou em produção' }, async () => {
    // caminho feliz
    const db = await banco81();
    const r = await executarComoEditorPorInstrucao(db, lerMigration(M82));
    assert.equal(r.erro, null, String(r.erro?.message));
    assert.equal(await md5Analisar(db), MD5_0082);
    // conferência que reprova precisa desfazer a troca mesmo neste modo
    const ruim = await banco81();
    await ruim.exec('grant execute on function public.g3_analisar(uuid) to authenticated');
    const r2 = await executarComoEditorPorInstrucao(ruim, lerMigration(M82));
    assert.match(String(r2.erro?.message), /conferencia/);
    assert.equal(await md5Analisar(ruim), MD5_0081, 'nada trocado');
  });

// ---------------------------------------------------------------------------
// 6. Arquivos PRE/POS/EXECUTAR da raiz
// ---------------------------------------------------------------------------

test('SQLs PRE/POS da raiz rodam e o EXECUTAR é byte-idêntico à migration', async (t) => {
  if (!existsSync(PRE) || !existsSync(POS) || !existsSync(EXECUTAR)) {
    t.skip('arquivos PRE/POS/EXECUTAR ausentes nesta cópia (não versionados)');
    return;
  }
  assert.ok(readFileSync(EXECUTAR).equals(readFileSync(join(RAIZ, 'supabase', 'migrations', M82))), 'EXECUTAR difere da migration');
  const falhas = (linhas) => linhas.filter((l) => l.status === 'FALHA').map((l) => l.verificacao);

  const db = await banco81();
  // um lote parado em "recebendo", como em produção
  await iniciarEEnviar(db, 'vendas_periodo', vendasPeriodo186());
  const pre = (await db.query(readFileSync(PRE, 'utf8'))).rows;
  assert.ok(pre.length >= 10);
  assert.deepEqual(falhas(pre), [], 'PRE: nenhuma FALHA antes da 0082');
  assert.match(pre.find((l) => /lotes por status/.test(l.verificacao)).detalhe, /recebendo=1/);

  await aplicarMigration(db, M82);
  const pos = (await db.query(readFileSync(POS, 'utf8'))).rows;
  assert.ok(pos.length >= 10);
  assert.deepEqual(falhas(pos), [], 'POS: nenhuma FALHA depois da 0082');
  const semOrdem = (rs) => rs.filter((l) => l.status === 'INFO').map((l) => [l.verificacao.replace(/ \(.*\)$/, ''), l.detalhe])
    .filter(([v]) => !/authenticator/.test(v));
  assert.deepEqual(semOrdem(pos), semOrdem(pre), 'INFO da POS igual ao da PRE (nada além de g3_analisar mudou)');

  // PRE depois da 0082 acusa "já aplicada"; POS só com a 0081 acusa a versão antiga
  const preDepois = (await db.query(readFileSync(PRE, 'utf8'))).rows;
  assert.ok(falhas(preDepois).some((v) => /EXATAMENTE a versao da 0081/.test(v)));
  const so81 = await banco81();
  const posAntes = (await so81.query(readFileSync(POS, 'utf8'))).rows;
  assert.ok(falhas(posAntes).some((v) => /EXATAMENTE a versao da 0082/.test(v)));
});
