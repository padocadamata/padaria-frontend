// Testes da migration 0084 (BI complementar) sobre PGlite com as migrations
// REAIS (0081 + 0082 + 0083 + 0084) e dados FICTÍCIOS importados pelo fluxo
// real da Central de Importações (cenários de bi_cenarios.mjs). Nada aqui
// toca o Supabase.
//
//   node --test --test-concurrency=1 supabase/tests/0084_bi_complementar.test.mjs
//
// Estratégia: (E) equivalência -- cada função _v2 com o filtro nulo devolve
// EXATAMENTE os valores da v1 homologada; (F) filtro de dias da semana
// conferido contra a soma dos dias da v1 (bi_serie/bi_produto_serie por dia)
// ou contra SQL independente sobre as tabelas g3_*; (H) produto por horário;
// (C) comparação de períodos livres; (S) segurança; (M) estrutura/atomicidade.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADMIN, GESTAO, RECEBEDOR, OPERACIONAL, RAIZ, como, fabricaDeBancos, fecharBancos, valor, aplicarMigration, lerMigration,
} from './ambiente_pedidos.mjs';
import { executarComoEditorPorInstrucao } from './editorSql.mjs';
import { comandosSemWhere } from './semWhere.mjs';
import {
  HOJE_BI_TESTE, comoUsuario, relatorios, carregar, vendasPrincipais, vendasMeses,
  PERIODO_PRINCIPAL, PERIODO_MESES, dias, iso, n, r2,
} from './bi_cenarios.mjs';

const { PGlite } = await import('@electric-sql/pglite');

const BASE = ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql', '0075_preferencias_usuario_mensagem_pedido.sql',
  '0080_central_notificacoes.sql', '0081_importacoes_g3.sql', '0082_g3_analisar_where.sql', '0083_bi_gerencial.sql'];
const M84 = '0084_bi_complementar.sql';
const PRE = join(RAIZ, '0084_pre_auditoria_bi_complementar_EXECUTAR.sql');
const POS = join(RAIZ, '0084_pos_auditoria_bi_complementar_EXECUTAR.sql');
const EXECUTAR = join(RAIZ, '0084_bi_complementar_EXECUTAR.sql');

const bancoSem84 = fabricaDeBancos({ extras: BASE });
const bancoCom84 = fabricaDeBancos({ extras: [...BASE, M84] });

const extras = new Set();
after(async () => {
  for (const db of extras) { try { await db.close(); } catch { /* fechado */ } }
  await fecharBancos();
});
async function copia(snapshot) {
  const db = new PGlite({ loadDataDir: snapshot });
  await db.waitReady;
  extras.add(db);
  await como(db, ADMIN);
  return db;
}
const snapshots = {};
async function cenario(nome, montar) {
  if (!snapshots[nome]) {
    const db = await bancoCom84();
    await db.exec(HOJE_BI_TESTE);
    await montar(db);
    snapshots[nome] = await db.dumpDataDir('none');
  }
  return copia(snapshots[nome]);
}
const principal = () => cenario('principal', (db) => carregar(db, relatorios(vendasPrincipais(),
  { ...PERIODO_PRINCIPAL, vpAjuste: { '2026-07-22': 1 } }), 'principal'));
const meses = () => cenario('meses', (db) => carregar(db, relatorios(vendasMeses(), PERIODO_MESES), 'meses'));

const HOJE = '2026-08-12';
const HOJE_MESES = '2026-11-05';
const admin = (db, sql, params = [], hoje = HOJE) => comoUsuario(db, ADMIN, hoje, () => db.query(sql, params).then((r) => r.rows));
const adminValor = (db, sql, params = [], hoje = HOJE) => comoUsuario(db, ADMIN, hoje, () => valor(db, sql, params));
async function erroDe(promessa) {
  try { await promessa; } catch (e) { return e; }
  return null;
}
const dow = (d) => new Date(`${iso(d)}T12:00:00Z`).getUTCDay();
const so = (obj, chaves) => Object.fromEntries(chaves.map((k) => [k, obj[k]]));
const semChaves = (obj, chaves) => Object.fromEntries(Object.entries(obj).filter(([k]) => !chaves.includes(k)));
const arr = (xs) => (xs === null ? 'null' : `array[${xs.join(',')}]::smallint[]`);

// ---------------------------------------------------------------------------
// E. Equivalência: _v2 com filtro nulo == v1 (mesmos valores, mesmos tipos)
// ---------------------------------------------------------------------------

const PERIODOS = [
  ['2026-07-09', '2026-08-09'], ['2026-07-01', '2026-07-31'], ['2026-07-20', '2026-07-26'], ['2026-08-08', '2026-08-20'],
  ['2026-07-24', '2026-07-25'], ['2026-08-10', '2026-08-10'], ['2026-06-01', '2026-07-08'], ['2026-09-01', '2026-09-30'],
  ['2026-08-02', '2026-08-02'],
];

test('E1. bi_resumo_v2(nulo) = bi_resumo em todos os períodos (só acrescenta filtro e descontos)', async () => {
  const db = await principal();
  for (const [de, ate] of PERIODOS) {
    const v1 = await adminValor(db, 'select public.bi_resumo($1,$2)', [de, ate]);
    const v2 = await adminValor(db, 'select public.bi_resumo_v2($1,$2)', [de, ate]);
    const v7 = await adminValor(db, `select public.bi_resumo_v2($1,$2,${arr([0, 1, 2, 3, 4, 5, 6])})`, [de, ate]);
    const limpo = (r) => {
      const x = semChaves(r, ['filtro']);
      if (x.registrado) x.registrado = semChaves(x.registrado, ['percentual_descontos']);
      if (x.base_media) x.base_media = semChaves(x.base_media, ['descontos', 'media_diaria_descontos', 'percentual_descontos']);
      return x;
    };
    assert.deepEqual(limpo(v2), v1, `${de}..${ate}`);
    assert.deepEqual(limpo(v7), v1, `${de}..${ate} (7 dias)`);
    assert.equal(v2.filtro.dias_semana, null);
    assert.deepEqual(v7.filtro.dias_semana, [0, 1, 2, 3, 4, 5, 6]);
  }
  const r = await adminValor(db, 'select public.bi_resumo_v2($1,$2)', ['2026-07-09', '2026-08-09']);
  assert.equal(r.base_media.descontos, 18.4);
  assert.equal(r.base_media.media_diaria_descontos, r2(18.4 / 30));
  assert.equal(r.base_media.percentual_descontos, Math.round((18.4 / 1085.71) * 10000) / 10000);
});

test('E2. bi_serie_v2(nulo) = bi_serie (dia, semana, mês), colunas v1 idênticas', async () => {
  const db = await principal();
  const V1 = ['inicio', 'fim', 'rotulo', 'bruto', 'liquido', 'descontos', 'vendas', 'ticket', 'bruto_media', 'liquido_media',
    'vendas_media', 'ticket_media', 'dias_validos', 'dias_calendario', 'dias_completos', 'dias_sem_vendas', 'dias_parciais',
    'dias_com_pendencias', 'dias_sem_importacao', 'dias_nao_confirmados', 'dias_sem_operacao', 'dias_pre_operacao',
    'dias_futuros', 'dias_fora_periodo', 'cobertura', 'classe', 'hora_limite', 'mes_inicio_operacao'];
  for (const agr of ['dia', 'semana', 'mes']) {
    for (const [de, ate] of PERIODOS) {
      const a = await admin(db, 'select * from public.bi_serie($1,$2,$3)', [de, ate, agr]);
      const b = await admin(db, 'select * from public.bi_serie_v2($1,$2,$3)', [de, ate, agr]);
      assert.deepEqual(b.map((l) => so(l, V1)), a, `${agr} ${de}..${ate}`);
      assert.ok(b.every((l) => Number(l.dias_fora_filtro) === 0));
    }
  }
});

test('E3. bi_produtos_v2(nulo) = bi_produtos (ordens, páginas, busca, códigos, vazios)', async () => {
  const db = await principal();
  const casos = [
    ["'2026-07-09','2026-08-09'", []], ["'2026-07-09','2026-08-12',null,null,'quantidade','asc',2,1", []],
    ["'2026-07-09','2026-08-12',array['311','341'],null,'descricao','desc',50,0", []],
    ["'2026-07-09','2026-08-12',null,'ovo','participacao','asc',50,0", []], ["'2026-07-24','2026-07-25'", []],
    ["'2026-06-01','2026-07-08'", []], ["'2026-07-09','2026-08-12',null,'zzz','bruto','desc',10,0", []],
    ["'2026-08-10','2026-08-10',null,null,'preco_medio','desc',50,0", []],
  ];
  for (const [args] of casos) {
    const v1 = await adminValor(db, `select public.bi_produtos(${args})`);
    const v2 = await adminValor(db, `select public.bi_produtos_v2(${args})`);
    assert.deepEqual(semChaves(v2, ['filtro']), v1, args);
  }
});

test('E4. bi_produto_serie_v2(nulo) = bi_produto_serie; bi_produtos_horario_v2(nulo) = bi_produtos_horario', async () => {
  const db = await principal();
  const V1 = ['codigo', 'descricao', 'inicio', 'fim', 'quantidade', 'vendas', 'bruto', 'dias_registrados', 'dias_validos',
    'dias_calendario', 'cobertura'];
  for (const agr of ['dia', 'semana', 'mes']) {
    for (const [de, ate] of PERIODOS) {
      const a = await admin(db, "select * from public.bi_produto_serie(array['100','311','341','999'],$1,$2,$3)", [de, ate, agr]);
      const b = await admin(db, "select * from public.bi_produto_serie_v2(array['100','311','341','999'],$1,$2,$3)", [de, ate, agr]);
      assert.deepEqual(b.map((l) => so(l, V1)), a, `${agr} ${de}..${ate}`);
    }
  }
  const H1 = ['hora', 'posicao', 'codigo', 'descricao', 'quantidade', 'vendas', 'bruto', 'dias_considerados'];
  for (const [args] of [["'2026-07-09','2026-08-09'"], ["'2026-07-09','2026-08-12',7::smallint,12::smallint,'quantidade',2"],
    ["'2026-07-20','2026-07-26',0::smallint,23::smallint,'vendas',50"], ["'2026-07-24','2026-07-25'"]]) {
    const a = await admin(db, `select * from public.bi_produtos_horario(${args})`);
    const b = await admin(db, `select * from public.bi_produtos_horario_v2(${args})`);
    assert.deepEqual(b.map((l) => so(l, H1)), a, args);
  }
});

test('E5. bi_comparar_periodos (pareado, sem filtro) reproduz bi_comparar (período, semana, mês; geral e produto)', async () => {
  for (const [cen, hoje, casos] of [
    [principal, HOJE, [['periodo', '2026-08-03', '2026-08-09'], ['periodo', '2026-07-27', '2026-08-02'], ['semana', null, '2026-08-05'],
      ['mes', null, '2026-08-09'], ['periodo', '2026-07-10', '2026-07-16'], ['periodo', '2026-07-26', '2026-08-01']]],
    [meses, HOJE_MESES, [['mes', null, '2026-10-31'], ['mes', null, '2026-10-21'], ['semana', null, '2026-10-14'],
      ['periodo', '2026-10-01', '2026-10-30']]],
  ]) {
    const db = await cen();
    for (const [tipo, de, ate] of casos) {
      for (const cod of [null, cen === meses ? '500' : '100']) {
        const c1 = await adminValor(db, 'select public.bi_comparar($1,$2,$3,$4)', [tipo, de, ate, cod], hoje);
        if (c1.motivo === 'periodo_pre_operacao' || c1.motivo === 'periodo_futuro') continue;
        // mês: o(s) dia(s) sem par (ex.: 31) ficam de fora -> A termina no último dia pareável
        const aAte = new Date(Date.parse(`${c1.atual.de}T00:00:00Z`) + (c1.dias_pareaveis - 1) * 86400000).toISOString().slice(0, 10);
        const c2 = await adminValor(db, `select public.bi_comparar_periodos($1,$2,$3,$4,null,${cod ? `array['${cod}']` : 'null'},'pareado')`,
          [c1.atual.de, aAte, c1.anterior.de, c1.anterior.ate], hoje);
        const rot = `${tipo} ${de}..${ate} ${cod}`;
        assert.equal(c2.criterio, 'pareado', rot);
        const g = cod ? c2.produtos[0] : c2.geral;
        assert.equal(g.comparavel, c1.comparavel, rot);
        assert.equal(g.a.cobertura, c1.cobertura, rot);
        assert.equal(g.a.dias_considerados, c1.dias_comparados, rot);
        assert.equal(c2.pareamento.pares, c1.dias_pareaveis, rot);
        if (c1.comparavel) {
          const ch = cod ? ['quantidade', 'vendas', 'bruto'] : ['bruto', 'liquido', 'vendas', 'ticket'];
          for (const k of ch) {
            assert.equal(Number(g.a[k]), Number(c1.atual[k]), `${rot} atual.${k}`);
            assert.equal(Number(g.b[k]), Number(c1.anterior[k]), `${rot} anterior.${k}`);
            assert.equal(g.variacoes[k], c1.variacoes[k], `${rot} variacao.${k}`);
          }
        } else {
          const m = { periodo_anterior_pre_operacao: ['contem_pre_operacao', 'periodo_b_pre_operacao'] }[c1.motivo] ?? [c1.motivo];
          assert.ok(m.includes(g.motivo), `${rot}: ${g.motivo} x ${c1.motivo}`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// F. Filtro de dias da semana: base recalculada (não é filtro visual)
// ---------------------------------------------------------------------------

const FILTROS = [[0], [5, 6], [1, 2, 3, 4, 5], [3], [6, 0]];

test('F1. bi_resumo_v2 com filtro = soma dos dias da v1 (bi_serie por dia) só nos dias escolhidos', async () => {
  const db = await principal();
  const [de, ate] = ['2026-07-01', '2026-08-12'];
  const dia = await admin(db, "select * from public.bi_serie($1,$2,'dia')", [de, ate]);
  for (const f of FILTROS) {
    const r = await adminValor(db, `select public.bi_resumo_v2($1,$2,${arr(f)})`, [de, ate]);
    const sel = dia.filter((l) => f.includes(dow(l.inicio)));
    const reg = sel.filter((l) => l.bruto !== null);
    const med = sel.filter((l) => Number(l.dias_validos) === 1);
    const soma = (ls, k) => r2(ls.reduce((s, l) => s + Number(l[k] ?? 0), 0));
    assert.equal(r.filtro.dias_calendario, dias('2026-07-09', ate).filter((d) => f.includes(dow(d))).length, `${f}`);
    assert.deepEqual(r.filtro.dias_semana, [...f].sort());
    assert.equal(r.base_media.dias_validos, med.length, `${f} dias válidos`);
    assert.equal(n(r.base_media.bruto), soma(med, 'bruto_media'), `${f} bruto base`);
    assert.equal(n(r.base_media.vendas), soma(med, 'vendas_media'), `${f} vendas base`);
    assert.equal(n(r.base_media.liquido), soma(med, 'liquido_media'), `${f} líquido base`);
    assert.equal(n(r.base_media.descontos), soma(med, 'descontos'), `${f} descontos base`);
    assert.equal(n(r.base_media.media_diaria_bruto), r2(soma(med, 'bruto_media') / med.length), `${f} média`);
    assert.equal(n(r.registrado.bruto), soma(reg, 'bruto'), `${f} bruto registrado`);
    assert.equal(r.registrado.vendas, soma(reg, 'vendas'), `${f} vendas registradas`);
    assert.equal(r.registrado.dias_com_dados, reg.length);
    assert.equal(r.dias.pre_operacao, 0, 'período ajustado a 09/07');
  }
  // só domingos: 12/07, 19/07, 26/07, 02/08 (coberto sem vendas = R$ 0 no divisor) e 09/08
  const dom = await adminValor(db, `select public.bi_resumo_v2($1,$2,${arr([0])})`, ['2026-07-09', '2026-08-09']);
  assert.equal(dom.base_media.dias_validos, 5);
  assert.equal(n(dom.base_media.bruto), r2(4 * 36.99));
  assert.equal(n(dom.base_media.media_diaria_bruto), r2((4 * 36.99) / 5));
  assert.equal(dom.dias.completo_sem_vendas, 1);
  // dia fora do filtro: motivo explícito, sem valores
  const vazio = await adminValor(db, `select public.bi_resumo_v2($1,$2,${arr([0])})`, ['2026-08-03', '2026-08-03']);
  assert.equal(vazio.motivo, 'nenhum_dia_no_filtro');
  assert.equal(vazio.registrado, null);
  assert.equal(vazio.base_media.bruto, null);
  // 24-25/07 (sexta e sábado) continuam fora da média com filtro [5,6]
  const fs = await adminValor(db, `select public.bi_resumo_v2($1,$2,${arr([5, 6])})`, ['2026-07-20', '2026-07-26']);
  assert.equal(fs.dias.cobertura_nao_confirmada, 2);
  assert.equal(fs.base_media.dias_validos, 0);
  assert.equal(fs.base_media.bruto, null, 'sem dia válido = nulo, nunca zero');
});

test('F2. bi_serie_v2 com filtro: semana/mês = soma dos dias escolhidos; dia = só os dias escolhidos; médias e descontos', async () => {
  const db = await principal();
  const [de, ate] = ['2026-07-09', '2026-08-12'];
  const dia = await admin(db, "select * from public.bi_serie($1,$2,'dia')", [de, ate]);
  for (const f of FILTROS) {
    const d2 = await admin(db, `select * from public.bi_serie_v2($1,$2,'dia',${arr(f)})`, [de, ate]);
    assert.deepEqual(d2.map((l) => iso(l.inicio)), dia.filter((l) => f.includes(dow(l.inicio))).map((l) => iso(l.inicio)));
    for (const agr of ['semana', 'mes']) {
      const s = await admin(db, `select * from public.bi_serie_v2($1,$2,$3,${arr(f)})`, [de, ate, agr]);
      for (const l of s) {
        const dentro = dia.filter((x) => iso(x.inicio) >= iso(l.inicio) && iso(x.inicio) <= iso(l.fim) && f.includes(dow(x.inicio)));
        const soma = (k) => r2(dentro.reduce((acc, x) => acc + Number(x[k] ?? 0), 0));
        const med = dentro.filter((x) => Number(x.dias_validos) === 1);
        const rot = `${f} ${agr} ${iso(l.inicio)}`;
        assert.equal(n(l.bruto) ?? 0, soma('bruto'), rot);
        assert.equal(Number(l.vendas ?? 0), soma('vendas'), rot);
        assert.equal(n(l.descontos) ?? 0, soma('descontos'), rot);
        assert.equal(Number(l.dias_validos), med.length, rot);
        assert.equal(n(l.bruto_media) ?? 0, soma('bruto_media'), rot);
        if (med.length) assert.equal(n(l.media_diaria_bruto), r2(soma('bruto_media') / med.length), rot);
        else assert.equal(l.media_diaria_bruto, null, rot);
        const total = agr === 'semana' ? 7 : dias(iso(l.inicio), iso(l.fim)).length;
        assert.equal(Number(l.dias_calendario) + Number(l.dias_fora_filtro), total, rot);
      }
    }
  }
});

// conferência independente de produtos: soma por dia/código direto das tabelas
async function produtosIndependente(db, de, ate, f, base = 'registrado') {
  const filtro = base === 'registrado'
    ? "c.classe_itens in ('completo','completo_sem_vendas','parcial','com_pendencias')" : 'c.entra_media_itens';
  return admin(db, `
    select i.codigo, sum(i.quantidade) as q, count(distinct i.numero) as n, sum(i.valor) as b
    from public.bi_calendario($1,$2) c
    join public.g3_vendas v on v.data = c.dia and v.conciliacao = 'conciliada'
    join public.g3_venda_itens i on i.numero = v.numero
    where ${filtro} and extract(dow from c.dia)::int = any($3::int[])
    group by i.codigo order by i.codigo`, [de, ate, f]);
}

test('F3. bi_produtos_v2 com filtro: cada código e o denominador da participação só nos dias escolhidos', async () => {
  const db = await principal();
  const [de, ate] = ['2026-07-09', '2026-08-12'];
  for (const f of FILTROS) {
    const r = await adminValor(db, `select public.bi_produtos_v2($1,$2,null,null,'bruto','desc',500,0,${arr(f)})`, [de, ate]);
    const ind = await produtosIndependente(db, de, ate, f);
    const tot = ind.reduce((s, x) => s + Number(x.b), 0);
    assert.equal(r.produtos.length, ind.length, `${f}`);
    assert.equal(n(r.totais.bruto_total_periodo), r2(tot), `${f} total`);
    for (const x of ind) {
      const p = r.produtos.find((y) => y.codigo === x.codigo);
      assert.equal(Number(p.quantidade), Number(x.q), `${f} ${x.codigo} qtd`);
      assert.equal(p.vendas, Number(x.n), `${f} ${x.codigo} vendas`);
      assert.equal(Number(p.bruto), Number(x.b), `${f} ${x.codigo} bruto`);
      assert.equal(p.participacao, Math.round((Number(x.b) / tot) * 10000) / 10000, `${f} ${x.codigo} participação`);
    }
    // filtros de lista (códigos/busca) NÃO mudam o denominador do filtro de dias
    const so311 = await adminValor(db, `select public.bi_produtos_v2($1,$2,array['311'],null,'bruto','desc',10,0,${arr(f)})`, [de, ate]);
    assert.equal(n(so311.totais.bruto_total_periodo), r2(tot));
    if (so311.produtos.length) assert.equal(so311.produtos[0].participacao, r.produtos.find((y) => y.codigo === '311').participacao);
    assert.equal(r.filtro.dias_calendario + r.filtro.dias_fora_filtro, dias(de, ate).length);
  }
  const vazio = await adminValor(db, `select public.bi_produtos_v2($1,$2,null,null,'bruto','desc',10,0,${arr([0])})`, ['2026-08-03', '2026-08-03']);
  assert.equal(vazio.motivo, 'nenhum_dia_no_filtro');
  assert.deepEqual(vazio.produtos, []);
  assert.equal(vazio.paginacao.total_linhas, 0);
});

test('F4. bi_produto_serie_v2 e bi_produtos_horario_v2 com filtro: só dias escolhidos; médias por dia válido', async () => {
  const db = await principal();
  const [de, ate] = ['2026-07-09', '2026-08-12'];
  for (const f of FILTROS) {
    const dia = await admin(db, `select * from public.bi_produto_serie_v2(array['100','341'],$1,$2,'dia',${arr(f)})`, [de, ate]);
    assert.ok(dia.every((l) => f.includes(dow(l.inicio))), `${f} só dias do filtro`);
    const mes = await admin(db, `select * from public.bi_produto_serie_v2(array['100','341'],$1,$2,'mes',${arr(f)})`, [de, ate]);
    const ind = await produtosIndependente(db, de, ate, f);
    const indMed = await produtosIndependente(db, de, ate, f, 'media');
    for (const cod of ['100', '341']) {
      const ls = mes.filter((l) => l.codigo === cod);
      const x = ind.find((y) => y.codigo === cod);
      const xm = indMed.find((y) => y.codigo === cod);
      assert.equal(r2(ls.reduce((s, l) => s + Number(l.bruto ?? 0), 0)), r2(Number(x?.b ?? 0)), `${f} ${cod} bruto`);
      assert.equal(ls.reduce((s, l) => s + Number(l.vendas ?? 0), 0), Number(x?.n ?? 0), `${f} ${cod} vendas`);
      // por dia: média do dia válido = bruto do dia; soma = base de dias completos
      const dvs = dia.filter((l) => l.codigo === cod && Number(l.dias_validos) === 1);
      assert.equal(r2(dvs.reduce((s, l) => s + Number(l.bruto_media_dia), 0)), r2(Number(xm?.b ?? 0)), `${f} ${cod} base`);
      assert.ok(dia.filter((l) => l.codigo === cod && Number(l.dias_validos) === 0).every((l) => l.bruto_media_dia === null));
    }
    const h = await admin(db, `select * from public.bi_produtos_horario_v2($1,$2,0::smallint,23::smallint,'bruto',50,${arr(f)})`, [de, ate]);
    const somaH = {};
    for (const l of h) somaH[l.codigo] = r2((somaH[l.codigo] ?? 0) + Number(l.bruto));
    for (const x of indMed) assert.equal(somaH[x.codigo] ?? 0, r2(Number(x.b)), `${f} ${x.codigo} horas = base de dias completos`);
    if (h.length) {
      const nd = Number(h[0].dias_considerados);
      assert.equal(n(h[0].media_bruto_dia), r2(Number(h[0].bruto) / nd));
    }
  }
});

// ---------------------------------------------------------------------------
// H. Produto escolhido por horário (independente do ranking)
// ---------------------------------------------------------------------------

test('H1. bi_produto_horarios: qualquer código, por hora; soma do ITEM (não da venda); participações; mesma descrição separada', async () => {
  const db = await principal();
  const [de, ate] = ['2026-07-09', '2026-08-12'];
  const r = await admin(db, "select * from public.bi_produto_horarios(array['100','311','341','999'],$1,$2)", [de, ate]);
  const pega = (cod, d, h) => r.find((l) => l.codigo === cod && l.dia_semana === d && l.hora === h);
  // 30 dias válidos (29 com vendas + 02/08 sem vendas), 31/07 23:50 é só o 200
  const t100 = pega('100', null, null);
  assert.equal(Number(t100.dias_considerados), 30);
  // 100: 07:15 (2 un, R$ 7,00) e 18:45 (2 linhas de 1 un, R$ 7,00) em 29 dias; 15/07 15:00 sem itens
  assert.equal(Number(pega('100', null, 7).quantidade), 58);
  assert.equal(n(pega('100', null, 7).bruto), r2(29 * 7));
  assert.equal(Number(pega('100', null, 18).vendas), 29, 'repetido na mesma venda conta 1 venda');
  assert.equal(n(pega('100', null, 12).bruto), 0);
  assert.equal(n(t100.bruto), r2(29 * 14));
  assert.equal(n(pega('100', null, 7).participacao_no_produto), 0.5);
  // participação no horário: às 7h, 100 (7,00) + 200 (4,00) => 7/11
  assert.equal(n(pega('100', null, 7).participacao_no_horario), Math.round((7 / 11) * 10000) / 10000);
  assert.equal(n(pega('100', null, 7).bruto_todos_itens), r2(29 * 11));
  // 341 às 18h: valor do ITEM (6,60), nunca o total da venda (13,60)
  assert.equal(n(pega('341', null, 18).bruto), r2(29 * 6.6));
  assert.equal(n(pega('341', null, 18).media_bruto_dia), r2((29 * 6.6) / 30));
  // 311 e 341 têm a mesma descrição: linhas separadas
  assert.equal(pega('311', null, null).descricao, pega('341', null, null).descricao);
  assert.equal(n(pega('311', null, 12).bruto), r2(29 * 6));
  // 311 nunca aparece no Top 1 das 12h (o 900 fatura mais), mas é analisado aqui
  const top1 = await admin(db, "select * from public.bi_produtos_horario($1,$2,12::smallint,12::smallint,'bruto',1)", [de, ate]);
  assert.notEqual(top1[0].codigo, '311');
  // código sem vendas: zeros (não some), descrição nula
  assert.equal(n(pega('999', null, null).bruto), 0);
  assert.equal(pega('999', null, null).descricao, null);
  // soma das horas = total do produto; soma dos dias da semana = total
  for (const cod of ['100', '311', '341']) {
    const horas = r.filter((l) => l.codigo === cod && l.dia_semana === null && l.hora !== null);
    assert.equal(horas.length, 24);
    assert.equal(r2(horas.reduce((s, l) => s + Number(l.bruto), 0)), n(pega(cod, null, null).bruto));
    const dows = r.filter((l) => l.codigo === cod && l.dia_semana !== null && l.hora === null);
    assert.equal(r2(dows.reduce((s, l) => s + Number(l.bruto), 0)), n(pega(cod, null, null).bruto));
    assert.equal(dows.reduce((s, l) => s + Number(l.dias_considerados), 0), 30);
  }
  // conferência independente célula a célula (dia da semana x hora)
  const ind = await admin(db, `
    select i.codigo, extract(dow from c.dia)::int as d, extract(hour from v.data_hora at time zone 'America/Sao_Paulo')::int as h,
           sum(i.quantidade) as q, count(distinct i.numero) as nv, sum(i.valor) as b
    from public.bi_calendario($1,$2) c
    join public.g3_vendas v on v.data = c.dia and v.conciliacao = 'conciliada'
    join public.g3_venda_itens i on i.numero = v.numero
    where c.entra_media_itens and i.codigo in ('100','311','341')
    group by 1, 2, 3`, [de, ate]);
  for (const x of ind) {
    const l = pega(x.codigo, x.d, x.h);
    assert.equal(Number(l.quantidade), Number(x.q), `${x.codigo} ${x.d} ${x.h}`);
    assert.equal(Number(l.vendas), Number(x.nv));
    assert.equal(Number(l.bruto), Number(x.b));
  }
  assert.equal(r.filter((l) => l.dia_semana !== null && l.hora !== null && Number(l.bruto) > 0).length, ind.length);
});

test('H2. bi_produto_horarios: filtro de dias da semana, períodos diferentes, sem dia válido e entradas inválidas', async () => {
  const db = await principal();
  const f = await admin(db, `select * from public.bi_produto_horarios(array['100'],$1,$2,${arr([0, 6])})`, ['2026-07-09', '2026-08-12']);
  assert.ok(f.every((l) => l.dia_semana === null || [0, 6].includes(l.dia_semana)));
  // sábados válidos: 11, 18/07, 01, 08/08 (25/07 exceção); domingos: 12, 19, 26/07, 02, 09/08
  assert.equal(Number(f.find((l) => l.dia_semana === null && l.hora === null).dias_considerados), 9);
  assert.equal(Number(f.find((l) => l.dia_semana === 6 && l.hora === null).dias_considerados), 4);
  // o mesmo produto em dois períodos: médias por dia válido comparáveis
  const p1 = await admin(db, "select * from public.bi_produto_horarios(array['100'],$1,$2)", ['2026-07-13', '2026-07-19']);
  const p2 = await admin(db, "select * from public.bi_produto_horarios(array['100'],$1,$2)", ['2026-07-27', '2026-08-02']);
  const m = (r) => n(r.find((l) => l.dia_semana === null && l.hora === 7).media_quantidade_dia);
  assert.equal(m(p1), 2);
  assert.equal(m(p2), Math.round(((6 * 2) / 7) * 10000) / 10000, '02/08 coberto sem vendas entra no divisor');
  // sem dia válido (só exceções): vazio
  assert.equal((await admin(db, "select * from public.bi_produto_horarios(array['100'],$1,$2)", ['2026-07-24', '2026-07-25'])).length, 0);
  assert.equal((await admin(db, "select * from public.bi_produto_horarios(array['100'],$1,$2)", ['2026-06-01', '2026-06-30'])).length, 0);
  for (const sql of [
    "select * from public.bi_produto_horarios(null,'2026-07-09','2026-07-10')",
    "select * from public.bi_produto_horarios(array[]::text[],'2026-07-09','2026-07-10')",
    "select * from public.bi_produto_horarios(array['1','2','3','4','5','6','7','8','9','10','11'],'2026-07-09','2026-07-10')",
    "select * from public.bi_produto_horarios(array['100','100'],'2026-07-09','2026-07-10')",
    "select * from public.bi_produto_horarios(array[' 100'],'2026-07-09','2026-07-10')",
    "select * from public.bi_produto_horarios(array['100'],'2026-07-09','2026-07-10',array[7]::smallint[])",
    "select * from public.bi_produto_horarios(array['100'],'2026-07-10','2026-07-09')",
  ]) {
    const e = await erroDe(admin(db, sql));
    assert.equal(e?.code, '22023', sql);
  }
});

// ---------------------------------------------------------------------------
// C. Comparação entre dois períodos livres
// ---------------------------------------------------------------------------

const comparar = (db, a, b, { dias: f = null, codigos = null, criterio = 'auto' } = {}, hoje = HOJE) =>
  adminValor(db, `select public.bi_comparar_periodos($1,$2,$3,$4,${arr(f)},${codigos ? `array[${codigos.map((c) => `'${c}'`).join(',')}]` : 'null'},$5)`,
    [a[0], a[1], b[0], b[1], criterio], hoje);

test('C1. dias equivalentes: segunda x segunda anterior (pareado); domingo x 4 domingos anteriores (média)', async () => {
  const db = await principal();
  const seg = await comparar(db, ['2026-08-03', '2026-08-03'], ['2026-07-27', '2026-07-27']);
  assert.equal(seg.criterio, 'pareado');
  assert.equal(seg.pareamento.mesmo_dia_semana, true);
  assert.equal(seg.pareamento.pares_dias_semana_diferentes, 0);
  assert.deepEqual(seg.avisos, []);
  assert.equal(seg.geral.comparavel, true);
  assert.equal(seg.geral.variacoes.bruto, 0);
  const dom = await comparar(db, ['2026-08-09', '2026-08-09'], ['2026-07-12', '2026-08-02'], { dias: [0] });
  assert.equal(dom.criterio, 'media', '1 domingo x 4 domingos: média por dia válido');
  assert.equal(dom.periodos.b.dias_filtrados, 4);
  assert.equal(dom.periodos.b.dias_fora_filtro, 18);
  assert.equal(dom.geral.b.dias_considerados, 4);
  assert.equal(n(dom.geral.b.media_diaria_bruto), r2((3 * 36.99) / 4));
  assert.equal(n(dom.geral.a.media_diaria_bruto), 36.99);
  assert.equal(dom.geral.variacoes.bruto, null, 'totais de durações diferentes não são comparados');
  assert.equal(dom.geral.diferencas.bruto, null);
  assert.equal(dom.geral.variacoes.media_diaria_bruto, Math.round(((36.99 - (3 * 36.99) / 4) / ((3 * 36.99) / 4)) * 10000) / 10000);
  assert.equal(dom.pareamento, null);
  assert.deepEqual(dom.avisos, ['quantidades_de_dias_diferentes'], 'durações diferentes: aviso explícito');
});

test('C2. sextas de setembro (4) x sextas de outubro (5), produto e fins de semana', async () => {
  const db = await meses();
  const sx = await comparar(db, ['2026-10-01', '2026-10-31'], ['2026-09-01', '2026-09-30'], { dias: [5], codigos: ['500'] }, HOJE_MESES);
  assert.equal(sx.criterio, 'media');
  assert.equal(sx.periodos.a.dias_filtrados, 5);
  assert.equal(sx.periodos.b.dias_filtrados, 4);
  assert.equal(n(sx.geral.a.media_diaria_bruto), 12);
  assert.equal(n(sx.geral.b.media_diaria_bruto), 10);
  assert.equal(sx.geral.variacoes.media_diaria_bruto, 0.2);
  assert.equal(sx.geral.variacoes.ticket, 0.2);
  const p = sx.produtos[0];
  assert.equal(p.codigo, '500');
  assert.equal(p.base, 'itens');
  assert.equal(n(p.a.media_diaria_quantidade), 2);
  assert.equal(n(p.b.media_diaria_quantidade), 1);
  assert.equal(p.variacoes.media_diaria_quantidade, 1);
  assert.equal(p.variacoes.quantidade, null, 'média: total de 5 x 4 sextas não é comparado');
  assert.equal(p.a.participacao, 1);
  // fins de semana de outubro x setembro (9 x 8 dias): média
  const fds = await comparar(db, ['2026-10-01', '2026-10-31'], ['2026-09-01', '2026-09-30'], { dias: [6, 0] }, HOJE_MESES);
  assert.equal(fds.periodos.a.dias_filtrados, 9);
  assert.equal(fds.periodos.b.dias_filtrados, 8);
  assert.deepEqual(fds.filtro.dias_semana, [0, 6]);
  // mesma quantidade de dias: pareado com totais (out 1-30 x set 1-30)
  const par = await comparar(db, ['2026-10-01', '2026-10-30'], ['2026-09-01', '2026-09-30'], { codigos: ['500'] }, HOJE_MESES);
  assert.equal(par.criterio, 'pareado');
  assert.equal(par.pareamento.mesmo_dia_semana, false, 'pares por posição, dias da semana diferentes (informado)');
  assert.equal(par.pareamento.pares_dias_semana_diferentes, 30);
  assert.deepEqual(par.avisos, ['pares_com_dias_da_semana_diferentes'], 'aviso explícito de dias da semana distintos');
  assert.equal(n(par.geral.a.bruto), 360);
  assert.equal(n(par.geral.b.bruto), 300);
  assert.equal(par.geral.variacoes.bruto, 0.2);
  assert.equal(par.produtos[0].variacoes.quantidade, 1);
  assert.equal(par.produtos[0].variacoes.bruto, 0.2);
  // descontos zero na referência: comparável, variação nula + sinalização
  assert.equal(par.geral.variacoes.descontos, null);
  assert.equal(par.geral.base_zero, true);
});

test('C3. descontos: total, percentual sobre o bruto, média diária e variações (só dias válidos)', async () => {
  const db = await principal();
  // A: 20/07 a 23/07 (20/07 com desconto de item 1,00); B: 13/07 a 16/07 (15/07 tem venda sem itens de R$ 5)
  const c = await comparar(db, ['2026-07-20', '2026-07-23'], ['2026-07-13', '2026-07-16']);
  assert.equal(c.criterio, 'pareado');
  assert.equal(n(c.geral.a.descontos), r2(4 * 0.6 + 1));
  assert.equal(n(c.geral.b.descontos), r2(4 * 0.6));
  assert.equal(n(c.geral.a.percentual_descontos), Math.round(((4 * 0.6 + 1) / (4 * 36.99)) * 10000) / 10000);
  assert.equal(n(c.geral.b.percentual_descontos), Math.round(((4 * 0.6) / (4 * 36.99 + 5)) * 10000) / 10000);
  assert.equal(n(c.geral.a.media_diaria_descontos), r2((4 * 0.6 + 1) / 4));
  assert.equal(n(c.geral.diferencas.descontos), 1);
  assert.equal(c.geral.variacoes.descontos, Math.round((1 / 2.4) * 10000) / 10000);
  // conferência com a série da v1 (descontos registrados por dia)
  const s = await admin(db, "select * from public.bi_serie($1,$2,'dia')", ['2026-07-20', '2026-07-23']);
  assert.equal(r2(s.reduce((x, l) => x + Number(l.descontos), 0)), n(c.geral.a.descontos));
});

test('C4. cobertura < 80%, pré-operação, futuro, filtro vazio, quantidade diferente forçada, sobreposição', async () => {
  const db = await principal();
  // B contém 24 e 25/07: 5/7 pares válidos
  const cob = await comparar(db, ['2026-07-27', '2026-08-02'], ['2026-07-20', '2026-07-26']);
  assert.equal(cob.geral.comparavel, false);
  assert.equal(cob.geral.motivo, 'cobertura_insuficiente');
  assert.equal(cob.geral.a.cobertura, Math.round((5 / 7) * 10000) / 10000);
  assert.equal(cob.geral.variacoes, null, 'não comparável: sem variação');
  assert.ok(cob.geral.dias_excluidos.some((x) => x.dia_b === '2026-07-24' && x.motivo === 'b_cobertura_nao_confirmada'));
  // B inteiro na pré-operação; B parcialmente na pré-operação
  const pre = await comparar(db, ['2026-07-09', '2026-07-15'], ['2026-07-01', '2026-07-07']);
  assert.equal(pre.geral.motivo, 'periodo_b_pre_operacao');
  assert.equal(pre.geral.b.bruto, null, 'sem dia válido: nulo (não zero)');
  const parc = await comparar(db, ['2026-07-10', '2026-07-16'], ['2026-07-03', '2026-07-09']);
  assert.equal(parc.geral.motivo, 'contem_pre_operacao');
  // futuro; fim depois de hoje ajustado
  const fut = await comparar(db, ['2026-08-20', '2026-08-25'], ['2026-08-01', '2026-08-06']);
  assert.equal(fut.geral.motivo, 'periodo_a_futuro');
  assert.equal(fut.periodos.a.de, null);
  const aj = await comparar(db, ['2026-08-06', '2026-08-20'], ['2026-07-27', '2026-08-02']);
  assert.ok(aj.avisos.includes('fim_a_ajustado_hoje'));
  assert.equal(aj.periodos.a.ate, '2026-08-12');
  // filtro sem nenhum dia em A
  const vazio = await comparar(db, ['2026-08-03', '2026-08-03'], ['2026-07-27', '2026-08-02'], { dias: [0] });
  assert.equal(vazio.geral.motivo, 'nenhum_dia_no_filtro');
  // pareado forçado com quantidades diferentes
  const forc = await comparar(db, ['2026-08-01', '2026-08-09'], ['2026-07-27', '2026-07-31'], { criterio: 'pareado' });
  assert.equal(forc.geral.motivo, 'quantidade_de_dias_diferente');
  assert.equal(forc.geral.comparavel, false);
  // média forçada com a mesma quantidade: totais sem variação
  const med = await comparar(db, ['2026-08-03', '2026-08-09'], ['2026-07-27', '2026-08-02'], { criterio: 'media' });
  assert.equal(med.criterio, 'media');
  assert.equal(med.geral.variacoes.bruto, null);
  assert.notEqual(med.geral.variacoes.media_diaria_bruto, null);
  // sobreposição
  const sob = await comparar(db, ['2026-07-27', '2026-08-05'], ['2026-08-01', '2026-08-09']);
  assert.ok(sob.avisos.includes('periodos_sobrepostos'));
});

test('C5. médias normalizadas = recálculo independente dos dias válidos de cada lado (critério média)', async () => {
  const db = await principal();
  const A = ['2026-07-09', '2026-07-31'];
  const B = ['2026-08-01', '2026-08-09'];
  for (const f of [null, [1, 3, 5], [0, 6]]) {
    const c = await comparar(db, A, B, { dias: f, codigos: ['100', '900'], criterio: 'media' });
    for (const [lado, [de, ate]] of [['a', A], ['b', B]]) {
      const dia = (await admin(db, "select * from public.bi_serie($1,$2,'dia')", [de, ate])).filter((l) => !f || f.includes(dow(l.inicio)));
      const med = dia.filter((l) => Number(l.dias_validos) === 1);
      const soma = (k) => med.reduce((s, l) => s + Number(l[k] ?? 0), 0);
      const g = c.geral[lado];
      assert.equal(g.dias_filtrados, dia.length, `${f} ${lado}`);
      assert.equal(g.dias_considerados, med.length, `${f} ${lado}`);
      assert.equal(n(g.bruto), r2(soma('bruto_media')), `${f} ${lado} bruto`);
      assert.equal(n(g.media_diaria_vendas), r2(soma('vendas_media') / med.length), `${f} ${lado} vendas/dia`);
      assert.equal(g.cobertura, Math.round((med.length / dia.length) * 10000) / 10000);
      const ind = await produtosIndependente(db, de, ate, f ?? [0, 1, 2, 3, 4, 5, 6], 'media');
      for (const p of c.produtos) {
        const x = ind.find((y) => y.codigo === p.codigo);
        assert.equal(n(p[lado].bruto), r2(Number(x?.b ?? 0)), `${f} ${lado} ${p.codigo}`);
        assert.equal(n(p[lado].quantidade), Number(x?.q ?? 0));
        const tot = ind.reduce((s, y) => s + Number(y.b), 0);
        assert.equal(p[lado].participacao, Math.round((Number(x?.b ?? 0) / tot) * 10000) / 10000, `${f} ${lado} ${p.codigo} part`);
      }
    }
  }
});

test('C6. comparar_periodos: entradas inválidas dão 22023 (sem fallback silencioso)', async () => {
  const db = await principal();
  for (const sql of [
    "select public.bi_comparar_periodos(null,'2026-07-10','2026-07-01','2026-07-02')",
    "select public.bi_comparar_periodos('2026-07-10','2026-07-09','2026-07-01','2026-07-02')",
    "select public.bi_comparar_periodos('2025-01-01','2026-07-10','2026-07-01','2026-07-02')",
    "select public.bi_comparar_periodos('2026-07-10','2026-07-11','2026-07-01','2026-07-02',null,null,'soma')",
    "select public.bi_comparar_periodos('2026-07-10','2026-07-11','2026-07-01','2026-07-02',null,array['1','2','3','4','5','6'])",
    "select public.bi_comparar_periodos('2026-07-10','2026-07-11','2026-07-01','2026-07-02',null,array['']::text[])",
    "select public.bi_comparar_periodos('2026-07-10','2026-07-11','2026-07-01','2026-07-02',array[]::smallint[])",
    "select public.bi_comparar_periodos('2026-07-10','2026-07-11','2026-07-01','2026-07-02',array[-1]::smallint[])",
    "select public.bi_resumo_v2('2026-07-10','2026-07-11',array[null]::smallint[])",
    "select * from public.bi_serie_v2('2026-07-10','2026-07-11','dia',array[0,1,2,3,4,5,6,0]::smallint[])",
    "select public.bi_produtos_v2('2026-07-10','2026-07-11',null,null,'custo')",
  ]) {
    const e = await erroDe(admin(db, sql));
    assert.equal(e?.code, '22023', sql);
  }
  // repetidos no filtro são normalizados
  const r = await adminValor(db, `select public.bi_resumo_v2($1,$2,${arr([6, 0, 6])})`, ['2026-07-09', '2026-08-09']);
  assert.deepEqual(r.filtro.dias_semana, [0, 6]);
});

// ---------------------------------------------------------------------------
// S. Segurança
// ---------------------------------------------------------------------------

const NOVAS = [
  ["select public.bi_resumo_v2('2026-07-09','2026-07-10')", []],
  ["select * from public.bi_serie_v2('2026-07-09','2026-07-10','dia')", []],
  ["select public.bi_produtos_v2('2026-07-09','2026-07-10')", []],
  ["select * from public.bi_produto_serie_v2(array['100'],'2026-07-09','2026-07-10','dia')", []],
  ["select * from public.bi_produtos_horario_v2('2026-07-09','2026-07-10')", []],
  ["select * from public.bi_produto_horarios(array['100'],'2026-07-09','2026-07-10')", []],
  ["select public.bi_comparar_periodos('2026-07-10','2026-07-10','2026-07-09','2026-07-09')", []],
];

test('S1. só proprietario_admin ativo executa as 7 RPCs novas; inativo, outros perfis e anon: 42501; internas fechadas', async () => {
  const db = await principal();
  for (const [sql, params] of NOVAS) await admin(db, sql, params);
  const INATIVO = '00000000-0000-0000-0000-0000000000aa';
  await db.exec(`insert into auth.users (id, email) values ('${INATIVO}', 'inativo@padoca.test');
    insert into public.usuarios (id, nome, email, perfil, ativo) values ('${INATIVO}', 'INATIVO', 'inativo@padoca.test', 'proprietario_admin', false);`);
  for (const uid of [INATIVO, GESTAO, RECEBEDOR, OPERACIONAL]) {
    for (const [sql, params] of NOVAS) {
      const e = await erroDe(comoUsuario(db, uid, HOJE, () => db.query(sql, params)));
      assert.equal(e?.code, '42501', `${uid} ${sql}`);
    }
  }
  for (const sql of ["select public.bi_dias_semana_int(array[1]::smallint[])",
    "select * from public.bi_dias_valores_int('2026-07-09','2026-07-10')"]) {
    const e = await erroDe(admin(db, sql));
    assert.equal(e?.code, '42501', `admin não chama interna: ${sql}`);
  }
  await db.exec('set role anon');
  try {
    for (const [sql, params] of NOVAS) {
      const e = await erroDe(db.query(sql, params));
      assert.equal(e?.code, '42501', `anon ${sql}`);
    }
  } finally {
    await db.exec('reset role');
  }
  const priv = await db.query(`select p.proname,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as aut, has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
      has_function_privilege('public', p.oid, 'EXECUTE') as pub, p.prosecdef as definer, coalesce('search_path=""' = any(p.proconfig), false) as sp
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'bi\\_%' order by 1`);
  assert.equal(priv.rows.length, 22);
  assert.deepEqual(priv.rows.filter((r) => r.aut).map((r) => r.proname).sort(), [
    'bi_calendario', 'bi_comparar', 'bi_comparar_periodos', 'bi_horarios', 'bi_produto_horarios', 'bi_produto_serie',
    'bi_produto_serie_v2', 'bi_produtos', 'bi_produtos_horario', 'bi_produtos_horario_v2', 'bi_produtos_v2', 'bi_resumo',
    'bi_resumo_v2', 'bi_serie', 'bi_serie_v2', 'bi_status']);
  assert.ok(priv.rows.every((r) => !r.anon && !r.pub));
  assert.ok(priv.rows.every((r) => r.sp));
});

// ---------------------------------------------------------------------------
// M. Estrutura: só cria funções novas; 0083 intacta; atomicidade
// ---------------------------------------------------------------------------

const RETRATO = `
  select 'f:' || p.oid::regprocedure::text || '|' || md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '')
         || '|' || p.prosecdef || '|' || coalesce(p.proconfig::text, '') as x
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 't:' || c.relname || '|' || coalesce(c.relacl::text, '') || '|' || c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  union all
  select 'p:' || c.relname || '|' || pol.polname || '|' || pg_get_expr(pol.polqual, pol.polrelid)
  from pg_policy pol join pg_class c on c.oid = pol.polrelid
  union all
  select 'g:' || tgname || '|' || tgrelid::regclass::text from pg_trigger where not tgisinternal
  order by 1`;
const NOVOS = ['bi_comparar_periodos', 'bi_dias_semana_int', 'bi_dias_valores_int', 'bi_produto_horarios', 'bi_produto_serie_v2',
  'bi_produtos_horario_v2', 'bi_produtos_v2', 'bi_resumo_v2', 'bi_serie_v2'];

test('M1. a 0084 só cria as 9 funções novas: tudo o mais (inclusive as 13 da 0083) fica idêntico; sem UPDATE/DELETE', async () => {
  const db = await bancoSem84();
  const antes = (await db.query(RETRATO)).rows.map((r) => r.x);
  await aplicarMigration(db, M84);
  const depois = (await db.query(RETRATO)).rows.map((r) => r.x);
  const novos = depois.filter((x) => !antes.includes(x));
  assert.deepEqual(antes.filter((x) => !depois.includes(x)), [], 'nada existente mudou');
  assert.deepEqual(novos.map((x) => x.split('|')[0].replace(/^f:/, '').replace(/\(.*/, '')).sort(), NOVOS);
  assert.deepEqual(comandosSemWhere(lerMigration(M84)), []);
  const semComentarios = lerMigration(M84).replace(/--[^\n]*/g, '');
  assert.doesNotMatch(semComentarios, /\bupdate\s+[\w."]+\s+set\b/i);
  assert.doesNotMatch(semComentarios, /\bdelete\s+from\b/i);
  assert.doesNotMatch(semComentarios, /\b(insert\s+into|create\s+(unique\s+)?index|create\s+table|alter\s+table)\b/i);
  assert.doesNotMatch(semComentarios, /custo|ganho/i, 'nunca usa custo/ganho do G3');
  // reaplicar: barrado pela guarda
  const e = await erroDe(aplicarMigration(db, M84));
  assert.match(String(e?.message), /0084 abortada/);
});

test('M2. modo SQL Editor (instrução por instrução): atômica; falha na conferência não deixa nada; guardas', async () => {
  const db = await bancoSem84();
  const r = await executarComoEditorPorInstrucao(db, lerMigration(M84));
  assert.equal(r.erro, null, String(r.erro?.message));
  assert.deepEqual(r.executadas, ['ok']);
  const ruim = await bancoSem84();
  const corrompida = lerMigration(M84).replace('if v_n <> 22 then', 'if v_n <> 99 then');
  const rr = await executarComoEditorPorInstrucao(ruim, corrompida);
  assert.match(String(rr.erro?.message), /conferencia/);
  assert.equal(Number(await valor(ruim, "select count(*) from pg_proc where proname like 'bi\\_%'")), 13);
  // 0083 diferente da homologada: aborta antes de criar
  const mexida = await bancoSem84();
  await mexida.exec("create or replace function public.bi_hoje_int() returns date language sql stable set search_path = '' as $$ select current_date $$");
  const e = await erroDe(aplicarMigration(mexida, M84));
  assert.match(String(e?.message), /nao correspondem a 0083/);
  // sem a 0083
  const sem83 = await fabricaDeBancos({ extras: BASE.slice(0, 6) })();
  const e2 = await erroDe(aplicarMigration(sem83, M84));
  assert.match(String(e2?.message), /0083/);
});

test('M3. guarda md5 da 0083 independe do search_path da sessão (SQL Editor pode não ter public)', async () => {
  for (const caminho of ['public', 'pg_catalog', '"$user", public, extensions']) {
    const db = await bancoSem84();
    await db.exec(`set search_path = ${caminho}`);
    if (existsSync(PRE)) {
      const pre = (await db.query(readFileSync(PRE, 'utf8'))).rows;
      assert.equal(pre[0].status, 'OK', `PRE linha 1 com search_path ${caminho}: ${pre[0].detalhe}`);
    }
    const r = await executarComoEditorPorInstrucao(db, lerMigration(M84));
    assert.equal(r.erro, null, `search_path ${caminho}: ${r.erro?.message}`);
    if (existsSync(POS)) {
      const pos = (await db.query(readFileSync(POS, 'utf8'))).rows;
      assert.deepEqual(pos.filter((l) => l.status === 'FALHA').map((l) => l.verificacao), [], `POS com search_path ${caminho}`);
    }
  }
});

test('PRE/POS da raiz rodam (somente leitura) e o EXECUTAR é byte-idêntico à migration', async (t) => {
  if (!existsSync(PRE) || !existsSync(POS) || !existsSync(EXECUTAR)) {
    t.skip('arquivos PRE/POS/EXECUTAR ausentes nesta cópia (não versionados)');
    return;
  }
  assert.ok(readFileSync(EXECUTAR).equals(readFileSync(join(RAIZ, 'supabase', 'migrations', M84))), 'EXECUTAR difere da migration');
  const falhas = (rows) => rows.filter((r) => r.status === 'FALHA').map((r) => `${r.verificacao}: ${r.detalhe}`);
  const db = await bancoSem84();
  const pre = (await db.query(readFileSync(PRE, 'utf8'))).rows;
  assert.deepEqual(falhas(pre), [], 'PRE antes da 0084');
  const retratoPre = pre.find((r) => /Retrato/.test(r.verificacao)).detalhe;
  await aplicarMigration(db, M84);
  const pos = (await db.query(readFileSync(POS, 'utf8'))).rows;
  assert.deepEqual(falhas(pos), [], 'POS depois da 0084');
  assert.equal(pos.find((r) => /Retrato/.test(r.verificacao)).detalhe, retratoPre, 'retrato idêntico');
  const preDepois = (await db.query(readFileSync(PRE, 'utf8'))).rows;
  assert.ok(falhas(preDepois).length > 0, 'PRE depois da 0084 acusa "já aplicada"');
  const ePos = await erroDe((await bancoSem84()).query(readFileSync(POS, 'utf8')));
  const semFalha = ePos ? null : falhas((await (await bancoSem84()).query(readFileSync(POS, 'utf8'))).rows);
  assert.ok(ePos || semFalha.length > 0, 'POS sem a 0084 não aprova');
  console.log('[0084 POS]', pos.map((r) => `${r.status} ${r.verificacao}`).join(' | '));
});
