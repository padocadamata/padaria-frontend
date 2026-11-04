// PARIDADE núcleo JS x SQL da migration 0078 + fluxo completo das RPCs,
// num Postgres LOCAL em memória (PGlite) -- nunca o Supabase. Opcional: o
// projeto não depende do PGlite; rode com o caminho de uma instalação
// avulsa (fora do repositório):
//
//   PGLITE_MODULE=<pasta>/node_modules/@electric-sql/pglite/dist/index.js \
//     node --test lib/ponto/__tests__/paridadeSql.test.mjs
//
// Sem PGLITE_MODULE os testes são PULADOS. "Hoje" fixo em 20/11/2026: a
// guarda da 0078 confere a folha_hoje() real; só DEPOIS de aplicada ela é
// trocada aqui por uma data fixa (o teste não depende do relógio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { apurarCartao, divergenciasDoSnapshot } from '../apuracao.js';
import { codigoDoErro, igualAoPrevisto, repetirHorarios } from '../lancamento.js';
import { CASOS, CASOS_ATESTADO, CASOS_VALIDACAO } from './casos.mjs';

const modulo = process.env.PGLITE_MODULE;
const pular = modulo ? false : 'defina PGLITE_MODULE para rodar a paridade com o SQL (PGlite local)';

const ADMIN = '00000000-0000-0000-0000-00000000000a';
const GESTAO = '00000000-0000-0000-0000-00000000000b';
const LEITOR = '00000000-0000-0000-0000-00000000000c';
const HOJE = '2026-11-20';
const SEIS = { tipo: 'trabalho', periodos: [{ inicio: '06:00', fim: '12:00' }] };

let db;
async function banco() {
  if (db) return db;
  const { PGlite } = await import(pathToFileURL(modulo).href);
  db = new PGlite();
  await db.exec(readFileSync(new URL('./sql/ambiente.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../../supabase/migrations/0078_folha_cartao_ponto.sql', import.meta.url), 'utf8'));
  await db.exec(`
    create or replace function public.folha_hoje() returns date language sql stable set search_path = '' as $$ select date '${HOJE}' $$;
    insert into auth.users values ('${ADMIN}'), ('${GESTAO}'), ('${LEITOR}');
    insert into public.usuarios values ('${ADMIN}', 'Admin Teste', 'proprietario_admin', true),
      ('${GESTAO}', 'Gestão Teste', 'gestao', true), ('${LEITOR}', 'Leitor Teste', 'gestao', true);
    insert into public.usuario_permissoes values ('${LEITOR}', 'folha_ponto.visualizar', 'concede', null);
  `);
  return db;
}

async function rodar(sql, params = [], usuario = null) {
  const d = await banco();
  try {
    await d.exec(usuario
      ? `set role authenticated; select set_config('request.jwt.claim.sub', '${usuario}', false);`
      : `reset role; select set_config('request.jwt.claim.sub', '', false);`);
    const r = await d.query(sql, params);
    return { linhas: r.rows };
  } catch (e) {
    return { codigo: codigoDoErro(e.message), mensagem: e.message, sqlstate: e.code };
  } finally {
    await d.exec('reset role;');
  }
}

async function su(sql, params = []) {
  const r = await rodar(sql, params);
  if (r.mensagem) throw new Error(r.mensagem);
  return r.linhas;
}

let seq = 0;
async function criarFuncionaria(nome, { admissao = '2025-01-10', demissao = null, vinculo = 'funcionario', historico = [] } = {}) {
  seq += 1;
  const [{ id }] = await su(
    `insert into public.funcionarios (nome, data_admissao, data_demissao, tipo_vinculo) values ($1, $2, $3, $4) returning id`,
    [`${nome} ${seq}`, admissao, demissao, vinculo]);
  for (const [tipo, desde] of historico) {
    await su('insert into public.funcionarios_vinculo_historico (funcionario_id, tipo_vinculo, vigente_desde) values ($1, $2, $3)', [id, tipo, desde]);
  }
  return id;
}

async function definirEscala(funcionarioId, data, escala) {
  const existentes = await su('select id from public.funcionarios_escala_dias where funcionario_id = $1 and data = $2', [funcionarioId, data]);
  if (existentes.length) await su('delete from public.funcionarios_escala_dias where id = $1', [existentes[0].id]);
  if (!escala) return;
  const [{ id }] = await su(
    'insert into public.funcionarios_escala_dias (funcionario_id, data, tipo_dia) values ($1, $2, $3) returning id', [funcionarioId, data, escala.tipo]);
  for (const p of escala.periodos) {
    await su('insert into public.funcionarios_escala_periodos (escala_dia_id, hora_inicio, hora_fim) values ($1, $2, $3)', [id, p.inicio, p.fim]);
  }
  if (escala.ocorrencia) {
    await su('insert into public.funcionarios_escala_ocorrencias (escala_dia_id, tipo) values ($1, $2)', [id, escala.ocorrencia.tipo]);
  }
}

const ARGS_ATESTADO = '$1::uuid, $2::int, $3::uuid, $4, $5, $6::date, $7::date, $8, $9, $10';
const rpc = {
  abrir: (f, c, u = ADMIN) => rodar('select public.folha_ponto_cartao_abrir($1, $2) as r', [f, c], u),
  salvar: (id, v, dias, u = ADMIN) => rodar('select public.folha_ponto_dias_salvar($1, $2, $3::jsonb) as r', [id, v, JSON.stringify(dias)], u),
  atestado: (f, a, { id = null, versao = null, u = ADMIN } = {}) => rodar(`select public.folha_ponto_atestado_salvar(${ARGS_ATESTADO}) as r`,
    [id, versao, f, a.tipo ?? 'atestado_medico', a.abrangencia ?? 'integral', a.data_inicio, a.data_fim ?? a.data_inicio,
      a.hora_inicio ?? null, a.hora_fim ?? null, 'descricao' in a ? a.descricao : 'Atestado entregue'], u),
  cancelarAtestado: (id, v, m, u = ADMIN) => rodar('select public.folha_ponto_atestado_cancelar($1, $2, $3) as r', [id, v, m], u),
  conferir: (id, v, u = ADMIN) => rodar('select public.folha_ponto_cartao_conferir($1, $2) as r', [id, v], u),
  fechar: (id, v, u = ADMIN) => rodar('select public.folha_ponto_cartao_fechar($1, $2) as r', [id, v], u),
  reabrir: (id, v, m, u = ADMIN) => rodar('select public.folha_ponto_cartao_reabrir($1, $2, $3) as r', [id, v, m], u),
  base: (f, c, u = ADMIN) => rodar('select public.folha_ponto_base($1, $2) as r', [f, c], u),
  resumo: (c, u = ADMIN) => rodar('select public.folha_ponto_competencia_resumo($1) as r', [c], u),
};

async function valor(promessa) {
  const r = await promessa;
  if (r.mensagem) throw new Error(r.mensagem);
  return r.linhas[0].r;
}

async function versaoDoCartao(id) {
  return (await su('select versao from public.folha_ponto_cartoes where id = $1', [id]))[0].versao;
}

async function apuracaoSqlDe(base) {
  const [{ r }] = await su('select public.folha_ponto_apurar($1::jsonb) as r', [JSON.stringify(base)]);
  return r;
}

function diasDoMes(competencia) {
  const [a, m] = competencia.split('-').map(Number);
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => `${competencia.slice(0, 8)}${String(i + 1).padStart(2, '0')}`);
}

// --- [obrig. 17] Apuração: SQL idêntico ao JS ----------------------------------

test('paridade: folha_ponto_apurar = apurarCartao (todos os casos de casos.mjs)', { skip: pular }, async () => {
  for (const caso of CASOS) {
    assert.deepEqual(await apuracaoSqlDe(caso.base), apurarCartao(caso.base), caso.nome);
  }
});

// --- Validação: mesmo código de erro da RPC -----------------------------------

test('paridade: dias_salvar devolve os mesmos códigos de validarItemDia', { skip: pular }, async () => {
  for (const caso of CASOS_VALIDACAO) {
    const f = await criarFuncionaria('Validação');
    await definirEscala(f, caso.d.data, caso.d.escala);
    for (const a of caso.atestados || []) await valor(rpc.atestado(f, a));
    const cartao = await valor(rpc.abrir(f, `${caso.item.data.slice(0, 7)}-01`));
    const r = await rpc.salvar(cartao.cartao_id, await versaoDoCartao(cartao.cartao_id), [caso.item]);
    assert.equal(r.codigo, caso.codigo, `${caso.nome}: ${r.mensagem}`);
  }
});

test('paridade: atestado_salvar devolve os mesmos códigos de validarAtestado', { skip: pular }, async () => {
  for (const caso of CASOS_ATESTADO) {
    const f = await criarFuncionaria('Atestado');
    for (const outro of caso.outros || []) await valor(rpc.atestado(f, outro));
    const r = await rpc.atestado(f, caso.atestado);
    assert.equal(r.codigo ?? null, caso.codigo, `${caso.nome}: ${r.mensagem}`);
  }
});

// --- Fluxo completo: competência passada (Outubro/2026) -----------------------

test('fluxo: lançar, dia sem Escala, Falta -> Atestado, conferir, Escala muda, fechar, reabrir', { skip: pular }, async () => {
  const f = await criarFuncionaria('Sabrina');
  const competencia = '2026-10-01';
  await su(`insert into public.feriados_nacionais values ('2026-10-12', 'Nossa Senhora Aparecida') on conflict do nothing`);
  for (const data of diasDoMes(competencia)) {
    if (data === '2026-10-30') continue; // [obrig. 13] dia sem Escala
    const domingo = new Date(`${data}T12:00:00Z`).getUTCDay() === 0;
    let escala = domingo || data === '2026-10-12'
      ? { tipo: 'folga', periodos: [] }
      : { tipo: 'trabalho', periodos: [{ inicio: '06:00', fim: '09:00' }, { inicio: '09:15', fim: '12:00' }] };
    if (data === '2026-10-07') escala = { ...escala, ocorrencia: { tipo: 'falta' } };
    if (data === '2026-10-08') escala = { ...escala, ocorrencia: { tipo: 'atestado' } };
    await definirEscala(f, data, escala);
  }

  const aberto = await valor(rpc.abrir(f, '2026-10-17'));
  assert.equal(aberto.criado, true);
  assert.equal((await valor(rpc.abrir(f, competencia))).criado, false, 'abrir de novo devolve o mesmo cartão');
  const id = aberto.cartao_id;

  let base = await valor(rpc.base(f, competencia));
  assert.equal(base.dias.length, 31);
  assert.deepEqual(await apuracaoSqlDe(base), apurarCartao(base), 'paridade na base real do mês');

  // Lança "Igual ao previsto" em todos os dias de trabalho de uma vez.
  const trabalho = base.dias.filter((d) => d.escala?.tipo === 'trabalho' && !d.escala.ocorrencia).map((d) => d.data);
  const lote = repetirHorarios(base.dias, trabalho, igualAoPrevisto(base.dias.find((d) => d.data === trabalho[0]).escala));
  lote[0].periodos = [{ entrada: '06:00', saida: '09:00' }, { entrada: '09:30', saida: '12:40' }]; // +40 fora, 15 não coberto
  let versao = await valor(rpc.salvar(id, 1, lote));
  assert.equal((await rpc.salvar(id, 1, [lote[1]])).codigo, 'cartao_alterado', 'versão antiga recusada');

  // [obrig. 13] Dia sem Escala impede a conferência.
  base = await valor(rpc.base(f, competencia));
  assert.deepEqual(apurarCartao(base).dias.find((d) => d.data === '2026-10-30').pendencias, ['sem_escala']);
  assert.equal((await rpc.conferir(id, versao)).codigo, 'pendencias');
  // Regularização explícita e auditada.
  versao = await valor(rpc.salvar(id, versao, [{ data: '2026-10-30', situacao: 'folga', motivo: 'Folga combinada; Escala não lançada' }]));

  // [obrig. 12] Falta da Escala (07/10) justificada por atestado registrado depois.
  const at = await valor(rpc.atestado(f, { data_inicio: '2026-10-07', descricao: 'Atestado Dr. X entregue em 09/10' }));
  assert.equal(at.versao, 1);
  const [ocorrencia] = await su(`select o.tipo from public.funcionarios_escala_ocorrencias o join public.funcionarios_escala_dias d on d.id = o.escala_dia_id
                                 where d.funcionario_id = $1 and d.data = '2026-10-07'`, [f]);
  assert.equal(ocorrencia.tipo, 'falta', 'a Escala não é alterada');
  assert.equal(await versaoDoCartao(id), versao + 1, 'atestado avança a versão do cartão aberto');
  versao += 1;

  base = await valor(rpc.base(f, competencia));
  let apur = apurarCartao(base);
  const dia7 = apur.dias.find((d) => d.data === '2026-10-07');
  assert.deepEqual([dia7.situacao_escala, dia7.situacao, dia7.atestado_min, dia7.faltante_min], ['falta', 'atestado', 345, 0]);
  assert.equal(base.atestados[0].registrado_por_nome, 'Admin Teste');
  assert.equal(apur.totais.dias_pendentes, 0);
  assert.equal(apur.totais.faltas_qtd, 0);
  assert.equal(apur.totais.atestados_integrais_qtd, 2);
  assert.equal(apur.totais.extra_min, 25);
  assert.deepEqual(await apuracaoSqlDe(base), apur);

  assert.equal((await rpc.fechar(id, versao)).codigo, 'nao_conferido');
  versao = await valor(rpc.conferir(id, versao));
  assert.equal((await valor(rpc.base(f, competencia))).cartao.conferencia_atual, true);

  // [obrig. 14] Atestado novo depois da conferência: conferência desfeita.
  const parcial = await valor(rpc.atestado(f, { abrangencia: 'parcial', tipo: 'comparecimento', data_inicio: trabalho[3], hora_inicio: '11:00', hora_fim: '12:00' }));
  base = await valor(rpc.base(f, competencia));
  assert.equal(base.cartao.conferido_em, null, 'atestado invalida a conferência');
  versao = base.cartao.versao;
  versao = await valor(rpc.conferir(id, versao));

  // [obrig. 14] Escala muda depois da conferência: conferência desatualizada.
  await definirEscala(f, trabalho[1], { tipo: 'trabalho', periodos: [{ inicio: '06:00', fim: '13:00' }] });
  assert.equal((await valor(rpc.base(f, competencia))).cartao.conferencia_atual, false);
  assert.equal((await rpc.fechar(id, versao)).codigo, 'conferencia_desatualizada');
  versao = await valor(rpc.conferir(id, versao));
  versao = await valor(rpc.fechar(id, versao));

  base = await valor(rpc.base(f, competencia));
  assert.equal(base.cartao.status, 'fechado');
  const snap = base.cartao.snapshot;
  assert.deepEqual(snap.apuracao, apurarCartao(snap.base), 'snapshot = apuração JS da base congelada');
  assert.equal(snap.base.atestados.length, 2, 'atestados no snapshot');
  assert.equal(snap.empresa.razao_social, 'Padoca Teste Ltda');

  // Fechado: nada muda -- nem dia, nem atestado da competência, nem escrita direta.
  assert.equal((await rpc.salvar(id, versao, [lote[2]])).codigo, 'cartao_fechado');
  assert.equal((await rpc.atestado(f, { data_inicio: trabalho[5] })).codigo, 'cartao_fechado');
  assert.equal((await rpc.atestado(f, { data_inicio: '2026-10-31', data_fim: '2026-11-02' })).codigo, 'cartao_fechado', 'atravessa mês fechado');
  assert.equal((await rpc.cancelarAtestado(at.atestado_id, 1, 'engano')).codigo, 'cartao_fechado');
  assert.match((await rodar(`update public.folha_ponto_periodos set saida = '12:59' where dia_id in (select id from public.folha_ponto_dias where cartao_id = $1)`, [id])).mensagem, /so cartao em preenchimento/);
  assert.match((await rodar('delete from public.folha_ponto_dias where cartao_id = $1', [id])).mensagem, /so cartao em preenchimento/);
  assert.match((await rodar(`update public.folha_ponto_atestados set versao = versao + 1, descricao = 'x' where id = $1`, [at.atestado_id])).mensagem, /cartao fechado/);
  assert.match((await rodar(`update public.folha_ponto_cartoes set versao = versao + 1, atualizado_em = now() where id = $1`, [id])).mensagem, /fechado e imutavel/);
  assert.match((await rodar('delete from public.folha_ponto_cartoes where id = $1', [id])).mensagem, /nunca sao apagados/);
  assert.match((await rodar('delete from public.folha_ponto_atestados where id = $1', [at.atestado_id])).mensagem, /nunca sao apagados/);
  assert.match((await rodar('delete from public.folha_ponto_eventos where cartao_id = $1', [id])).mensagem, /imutavel/);

  // [obrig. 16] Escala alterada DEPOIS do fechamento: o documento não muda.
  await definirEscala(f, trabalho[2], { tipo: 'folga', periodos: [] });
  const depois = await valor(rpc.base(f, competencia));
  assert.deepEqual(depois.cartao.snapshot, snap);
  assert.deepEqual(divergenciasDoSnapshot(snap.base, depois), [trabalho[2]]);

  // [obrig. 15] Reabrir: permissão, motivo, histórico com o snapshot desfeito.
  assert.equal((await rpc.reabrir(id, versao, 'x', GESTAO)).sqlstate, '42501');
  assert.equal((await rpc.reabrir(id, versao, '  ')).codigo, 'reabertura_motivo_obrigatorio');
  versao = await valor(rpc.reabrir(id, versao, 'Contabilidade pediu correção'));
  const reaberto = await valor(rpc.base(f, competencia));
  assert.equal(reaberto.cartao.status, 'em_preenchimento');
  assert.equal(reaberto.cartao.snapshot, null);
  assert.equal((await rpc.reabrir(id, versao, 'de novo')).codigo, 'cartao_aberto');
  // Reaberto: atestado volta a ser editável/cancelável.
  assert.equal((await rpc.cancelarAtestado(parcial.atestado_id, 1, '')).codigo, 'cancelamento_motivo_obrigatorio');
  assert.equal(await valor(rpc.cancelarAtestado(parcial.atestado_id, 1, 'Lançado no dia errado')), 2);
  assert.equal((await rpc.cancelarAtestado(parcial.atestado_id, 2, 'de novo')).codigo, 'atestado_cancelado');

  const eventos = await su('select acao, motivo, dados from public.folha_ponto_eventos where cartao_id = $1 order by versao, criado_em', [id]);
  assert.deepEqual(eventos.map((e) => e.acao), ['abrir', 'ajustar_situacao', 'conferir', 'conferir', 'conferir', 'fechar', 'reabrir']);
  assert.deepEqual(eventos.at(-1).dados.snapshot, snap);
  assert.equal(eventos.at(-1).motivo, 'Contabilidade pediu correção');
  const ajuste = eventos.find((e) => e.acao === 'ajustar_situacao');
  assert.equal(ajuste.dados.situacao_escala, 'nao_definido');
  const evAtestado = await su('select acao, motivo from public.folha_ponto_eventos where atestado_id = $1 order by criado_em', [parcial.atestado_id]);
  assert.deepEqual(evAtestado.map((e) => e.acao), ['atestado_registrar', 'atestado_cancelar']);
});

// --- Atestados de vários dias e futuros ----------------------------------------

test('atestado: 3 dias numa única linha, atuais + futuros, sem ponto futuro, sem fechamento antecipado', { skip: pular }, async () => {
  const f = await criarFuncionaria('Atestado futuro');
  for (const data of ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-23']) await definirEscala(f, data, SEIS);
  await definirEscala(f, '2026-11-22', { tipo: 'folga', periodos: [] });
  const c = await valor(rpc.abrir(f, '2026-11-01'));
  let versao = await valor(rpc.salvar(c.cartao_id, 1, [{ data: '2026-11-18', periodos: [{ entrada: '06:00', saida: '12:00' }] }]));

  // [obrig. 10/11] um registro cobrindo 19..23 (inclui hoje, futuro e folga).
  const at = await valor(rpc.atestado(f, { data_inicio: '2026-11-19', data_fim: '2026-11-23', descricao: 'Afastamento 5 dias' }));
  assert.equal((await su('select count(*)::int n from public.folha_ponto_atestados where funcionario_id = $1', [f]))[0].n, 1, 'um único registro');
  versao += 1;

  const base = await valor(rpc.base(f, '2026-11-01'));
  const ap = apurarCartao(base);
  const doDia = (d) => ap.dias.find((x) => x.data === d);
  assert.equal(doDia('2026-11-19').situacao, 'atestado');
  assert.equal(doDia('2026-11-20').atestado_min, 360);
  assert.deepEqual([doDia('2026-11-21').futuro, doDia('2026-11-21').atestado_cobertura, doDia('2026-11-21').atestado_min], [true, 'integral', null]);
  assert.deepEqual([doDia('2026-11-22').situacao, doDia('2026-11-22').atestado_cobertura], ['folga', 'integral']);
  assert.deepEqual(await apuracaoSqlDe(base), ap);

  // Nenhuma marcação de ponto no futuro, nem em dia coberto por atestado integral.
  assert.equal((await rpc.salvar(c.cartao_id, versao, [{ data: '2026-11-21', periodos: [{ entrada: '06:00', saida: '12:00' }] }])).codigo, 'data_futura');
  assert.equal((await rpc.salvar(c.cartao_id, versao, [{ data: '2026-11-20', periodos: [{ entrada: '06:00', saida: '12:00' }] }])).codigo, 'dia_com_atestado_integral');
  // Competência em andamento: não confere nem fecha antes do fim.
  assert.equal((await rpc.conferir(c.cartao_id, versao)).codigo, 'competencia_em_andamento');
  assert.match((await rodar(`insert into public.folha_ponto_dias (cartao_id, data, observacao) values ($1, '2026-11-25', 'x')`, [c.cartao_id])).mensagem, /data futura/);

  // [obrig. 8] Integral sobre dia com horário trabalhado: use parcial.
  assert.equal((await rpc.atestado(f, { data_inicio: '2026-11-17', data_fim: '2026-11-18' })).codigo, 'atestado_com_trabalho');
  // Revisão posterior: encurtar para 19..20 (versão esperada) e recusar versão antiga.
  assert.equal((await rpc.atestado(f, { data_inicio: '2026-11-19', data_fim: '2026-11-20' }, { id: at.atestado_id, versao: 9 })).codigo, 'atestado_alterado');
  const alterado = await valor(rpc.atestado(f, { data_inicio: '2026-11-19', data_fim: '2026-11-20', descricao: 'Afastamento revisto: 2 dias' }, { id: at.atestado_id, versao: 1 }));
  assert.equal(alterado.versao, 2);
  const [ev] = await su(`select dados from public.folha_ponto_eventos where atestado_id = $1 and acao = 'atestado_alterar'`, [at.atestado_id]);
  assert.equal(ev.dados.antes.data_fim, '2026-11-23');
  assert.equal(ev.dados.depois.data_fim, '2026-11-20');
  // Atestado de competência futura (dezembro) é aceito; o cartão de dezembro não abre.
  await definirEscala(f, '2026-12-02', SEIS);
  assert.ok((await valor(rpc.atestado(f, { data_inicio: '2026-12-01', data_fim: '2026-12-02' }))).atestado_id);
  assert.equal((await rpc.abrir(f, '2026-12-01')).codigo, 'competencia_futura');
  assert.equal((await valor(rpc.base(f, '2026-12-01'))).atestados.length, 1);
});

// --- [obrig. 7/9/10/11] Afastamento longo: mais de 90 dias, várias competências --

test('atestado longo: 172 dias numa linha, atravessa competências, descrição nula, ponta editável com mês fechado', { skip: pular }, async (t) => {
  const f = await criarFuncionaria('Afastamento longo');
  for (const data of diasDoMes('2026-09-01')) await definirEscala(f, data, data === '2026-09-30' ? SEIS : { tipo: 'folga', periodos: [] });
  await definirEscala(f, '2026-10-15', { ...SEIS, ocorrencia: { tipo: 'falta' } });
  await definirEscala(f, '2026-11-25', SEIS);

  const inicio = performance.now();
  const at = await valor(rpc.atestado(f, { data_inicio: '2026-09-29', data_fim: '2027-03-19', descricao: null }));
  t.diagnostic(`registrar 172 dias: ${(performance.now() - inicio).toFixed(0)} ms`);
  const linhas = await su('select descricao, data_fim - data_inicio + 1 as dias from public.folha_ponto_atestados where funcionario_id = $1', [f]);
  assert.deepEqual(linhas, [{ descricao: null, dias: 172 }], 'um único registro, descrição nula (sem texto fictício)');
  for (const c of ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-03-01']) {
    assert.equal((await valor(rpc.base(f, c))).atestados.length, 1, `atestado visível em ${c}`);
  }
  // [obrig. 12] Falta da Escala em outubro coberta pelo afastamento; a Escala não muda.
  const outubro = await valor(rpc.base(f, '2026-10-01'));
  const dia15 = apurarCartao(outubro).dias.find((d) => d.data === '2026-10-15');
  assert.deepEqual([dia15.situacao_escala, dia15.situacao, dia15.atestado_min, dia15.trabalhado_min], ['falta', 'atestado', 360, 0]);
  assert.deepEqual(await apuracaoSqlDe(outubro), apurarCartao(outubro));
  // [obrig. 11] Futuro coberto, sem marcação futura e sem conferência antecipada.
  const nov = await valor(rpc.abrir(f, '2026-11-01'));
  assert.equal((await rpc.salvar(nov.cartao_id, 1, [{ data: '2026-11-25', periodos: [{ entrada: '06:00', saida: '12:00' }] }])).codigo, 'data_futura');
  assert.equal((await rpc.conferir(nov.cartao_id, 1)).codigo, 'competencia_em_andamento');

  // Setembro conferido e fechado com o afastamento.
  const set = await valor(rpc.abrir(f, '2026-09-01'));
  assert.equal((await rpc.salvar(set.cartao_id, 1, [{ data: '2026-09-30', periodos: [{ entrada: '06:00', saida: '12:00' }] }])).codigo, 'dia_com_atestado_integral');
  let versao = await valor(rpc.conferir(set.cartao_id, 1));
  versao = await valor(rpc.fechar(set.cartao_id, versao));
  const setembro = apurarCartao((await valor(rpc.base(f, '2026-09-01'))).cartao.snapshot.base);
  assert.deepEqual([setembro.totais.atestado_min, setembro.totais.atestados_integrais_qtd], [360, 1]);

  // Volta antecipada: a PONTA (em competência aberta) pode ser encurtada mesmo com setembro fechado.
  const encurtado = await valor(rpc.atestado(f, { data_inicio: '2026-09-29', data_fim: '2027-01-15', descricao: null }, { id: at.atestado_id, versao: 1 }));
  assert.equal(encurtado.versao, 2);
  const [ev] = await su(`select dados from public.folha_ponto_eventos where atestado_id = $1 and acao = 'atestado_alterar'`, [at.atestado_id]);
  assert.deepEqual([ev.dados.antes.data_fim, ev.dados.depois.data_fim, ev.dados.depois.descricao], ['2027-03-19', '2027-01-15', null]);
  // O que atinge setembro (fechado) continua bloqueado.
  assert.equal((await rpc.atestado(f, { data_inicio: '2026-09-30', data_fim: '2027-01-15', descricao: null }, { id: at.atestado_id, versao: 2 })).codigo, 'cartao_fechado');
  assert.equal((await rpc.atestado(f, { data_inicio: '2026-09-29', data_fim: '2027-01-15', descricao: 'INSS' }, { id: at.atestado_id, versao: 2 })).codigo, 'cartao_fechado');
  assert.equal((await rpc.atestado(f, { tipo: 'outro', data_inicio: '2026-09-29', data_fim: '2027-01-15', descricao: null }, { id: at.atestado_id, versao: 2 })).codigo, 'cartao_fechado');
  assert.equal((await rpc.cancelarAtestado(at.atestado_id, 2, 'engano')).codigo, 'cartao_fechado');
  assert.match((await rodar(`update public.folha_ponto_atestados set versao = versao + 1, data_inicio = '2026-09-30' where id = $1`, [at.atestado_id])).mensagem, /cartao fechado/);
  assert.deepEqual((await valor(rpc.base(f, '2026-09-01'))).cartao.snapshot.apuracao, setembro, 'snapshot de setembro intacto');
  assert.equal((await su('select versao from public.folha_ponto_atestados where id = $1', [at.atestado_id]))[0].versao, 2, 'recusas não mexem na versão');
  // Para atingir setembro: reabertura autorizada (motivo) e só então a alteração.
  versao = await valor(rpc.reabrir(set.cartao_id, versao, 'Atestado começou em 30/09, não 29/09'));
  const corrigido = await valor(rpc.atestado(f, { data_inicio: '2026-09-30', data_fim: '2027-01-15', descricao: null }, { id: at.atestado_id, versao: 2 }));
  assert.equal(corrigido.versao, 3);
  const acoes = await su('select acao from public.folha_ponto_eventos where atestado_id = $1 order by versao', [at.atestado_id]);
  assert.deepEqual(acoes.map((e) => e.acao), ['atestado_registrar', 'atestado_alterar', 'atestado_alterar']);
  const evReabrir = await su(`select dados from public.folha_ponto_eventos where cartao_id = $1 and acao = 'reabrir'`, [set.cartao_id]);
  assert.deepEqual(evReabrir[0].dados.snapshot.apuracao, setembro, 'o snapshot desfeito fica no histórico');

  // Limite técnico: afastamento de 10 anos (só medida de desempenho).
  const g = await criarFuncionaria('Afastamento 10 anos');
  const t10 = performance.now();
  await valor(rpc.atestado(g, { data_inicio: '2026-01-01', data_fim: '2035-12-31', descricao: null }));
  t.diagnostic(`registrar 3652 dias: ${(performance.now() - t10).toFixed(0)} ms`);
});

// --- Desligamento durante o afastamento -------------------------------------------

test('desligamento depois do atestado: documento mantido, apuração só dentro do vínculo', { skip: pular }, async () => {
  const f = await criarFuncionaria('Desligada no afastamento');
  for (const data of diasDoMes('2026-10-01')) await definirEscala(f, data, data >= '2026-10-15' ? SEIS : { tipo: 'folga', periodos: [] });
  const at = await valor(rpc.atestado(f, { data_inicio: '2026-10-15', data_fim: '2026-12-31', descricao: null }));
  await su(`update public.funcionarios set data_demissao = '2026-10-20' where id = $1`, [f]);

  const [linha] = await su('select data_inicio::text, data_fim::text, status, versao from public.folha_ponto_atestados where id = $1', [at.atestado_id]);
  assert.deepEqual(linha, { data_inicio: '2026-10-15', data_fim: '2026-12-31', status: 'ativo', versao: 1 }, 'documento original mantido');
  const base = await valor(rpc.base(f, '2026-10-01'));
  const ap = apurarCartao(base);
  const dia = (d) => ap.dias.find((x) => x.data === d);
  assert.deepEqual([dia('2026-10-20').situacao, dia('2026-10-20').atestado_min], ['atestado', 360]);
  for (const d of ['2026-10-21', '2026-10-31']) {
    assert.deepEqual([dia(d).situacao, dia(d).atestado_cobertura, dia(d).previsto_min, dia(d).atestado_min, dia(d).faltante_min],
      ['fora_vinculo', null, null, null, null], d);
  }
  assert.deepEqual([ap.totais.previsto_min, ap.totais.atestado_min, ap.totais.faltante_min, ap.totais.atestados_integrais_qtd], [2160, 2160, 0, 6]);
  assert.deepEqual(await apuracaoSqlDe(base), ap);
  // Novembro/dezembro: sem vínculo, sem cartão.
  assert.equal((await rpc.abrir(f, '2026-11-01')).codigo, 'sem_vinculo_na_competencia');
  // O documento continua editável sem acrescentar dias fora do vínculo.
  assert.equal((await valor(rpc.atestado(f, { data_inicio: '2026-10-15', data_fim: '2026-11-30', descricao: 'Encurtado' }, { id: at.atestado_id, versao: 1 }))).versao, 2);
  assert.equal((await rpc.atestado(f, { data_inicio: '2026-10-14', data_fim: '2026-11-30' }, { id: at.atestado_id, versao: 2 })).codigo ?? null, null, 'acrescentar dia DENTRO do vínculo: aceito');
  assert.equal((await rpc.atestado(f, { data_inicio: '2026-10-14', data_fim: '2026-12-05' }, { id: at.atestado_id, versao: 3 })).codigo, 'fora_vinculo');
  assert.equal((await rpc.atestado(f, { data_inicio: '2026-12-10', data_fim: '2026-12-12' })).codigo, 'fora_vinculo', 'atestado NOVO depois do desligamento');
});

// --- [obrig. 8] Atestado integral x trabalho; parcial convive com trabalho -----------

test('atestado integral com trabalho é recusado; parcial + trabalho sem dupla contagem', { skip: pular }, async () => {
  const f = await criarFuncionaria('Parcial com trabalho');
  await definirEscala(f, '2026-10-05', SEIS);
  const c = await valor(rpc.abrir(f, '2026-10-01'));
  await valor(rpc.salvar(c.cartao_id, 1, [{ data: '2026-10-05', periodos: [{ entrada: '06:00', saida: '08:00' }, { entrada: '09:00', saida: '13:00' }] }]));
  assert.equal((await rpc.atestado(f, { data_inicio: '2026-10-05' })).codigo, 'atestado_com_trabalho');
  assert.equal((await rpc.atestado(f, { data_inicio: '2026-10-04', data_fim: '2026-10-06' })).codigo, 'atestado_com_trabalho');
  await valor(rpc.atestado(f, { abrangencia: 'parcial', tipo: 'comparecimento', data_inicio: '2026-10-05', hora_inicio: '07:30', hora_fim: '10:00', descricao: null }));
  const base = await valor(rpc.base(f, '2026-10-01'));
  const d = apurarCartao(base).dias.find((x) => x.data === '2026-10-05');
  // 06–08 + 09–12 no previsto (300), 12–13 fora (60); atestado só 08–09 (60, o resto já foi trabalhado); nada descoberto.
  assert.deepEqual(
    [d.trabalhado_min, d.trabalhado_no_previsto_min, d.trabalhado_fora_previsto_min, d.atestado_min, d.previsto_nao_coberto_min, d.extra_min, d.faltante_min],
    [360, 300, 60, 60, 0, 60, 0]);
  assert.equal(d.trabalhado_no_previsto_min + d.atestado_min + d.previsto_nao_coberto_min, d.previsto_min, 'sem dupla contagem');
  assert.deepEqual(await apuracaoSqlDe(base), apurarCartao(base));
});

// --- Competências e vínculo -------------------------------------------------------

test('competências: passada sem limite, data futura bloqueada, futura sem cartão', { skip: pular }, async () => {
  const f = await criarFuncionaria('Competências');
  const antiga = await valor(rpc.abrir(f, '2025-01-01'));
  await definirEscala(f, '2025-01-13', SEIS);
  assert.equal(await valor(rpc.salvar(antiga.cartao_id, 1, [{ data: '2025-01-13', periodos: [{ entrada: '06:00', saida: '12:00' }] }])), 2);
  assert.equal((await rpc.salvar(antiga.cartao_id, 2, [{ data: '2025-01-05', observacao: 'x' }])).codigo, 'fora_vinculo');
  assert.equal((await rpc.salvar(antiga.cartao_id, 2, [{ data: '2025-02-01', observacao: 'x' }])).codigo, 'data_fora_competencia');
  assert.equal((await rpc.atestado(f, { data_inicio: '2025-01-08', data_fim: '2025-01-11' })).codigo, 'fora_vinculo', 'atestado antes da admissão');
  assert.equal((await rpc.abrir(f, '2026-12-01')).codigo, 'competencia_futura');
  const futura = await valor(rpc.base(f, '2026-12-01'));
  assert.equal(futura.cartao, null);
  assert.ok(apurarCartao(futura).dias.every((d) => d.futuro));
});

test('vínculo: freelancer sem cartão; mudança no meio do mês; desligamento', { skip: pular }, async () => {
  const free = await criarFuncionaria('Free', { vinculo: 'freelancer' });
  assert.equal((await rpc.abrir(free, '2026-10-01')).codigo, 'sem_vinculo_na_competencia');
  assert.equal((await rpc.atestado(free, { data_inicio: '2026-10-05' })).codigo, 'fora_vinculo');

  const virou = await criarFuncionaria('Virou CLT', { historico: [['freelancer', '2025-01-10'], ['funcionario', '2026-10-16']] });
  const c = await valor(rpc.abrir(virou, '2026-10-01'));
  assert.equal((await rpc.salvar(c.cartao_id, 1, [{ data: '2026-10-10', observacao: 'x' }])).codigo, 'fora_vinculo');
  const ap = apurarCartao(await valor(rpc.base(virou, '2026-10-01')));
  assert.equal(ap.dias.find((d) => d.data === '2026-10-10').fora_vinculo, 'outro_vinculo');
  assert.equal(ap.dias.find((d) => d.data === '2026-10-16').fora_vinculo, null);

  const saiu = await criarFuncionaria('Saiu', { demissao: '2026-10-20' });
  const c2 = await valor(rpc.abrir(saiu, '2026-10-01'));
  assert.equal((await rpc.salvar(c2.cartao_id, 1, [{ data: '2026-10-21', observacao: 'x' }])).codigo, 'fora_vinculo');
  assert.equal((await rpc.abrir(saiu, '2026-11-01')).codigo, 'sem_vinculo_na_competencia');

  const resumo = await valor(rpc.resumo('2026-10-01'));
  assert.ok(!resumo.some((r) => r.nome.startsWith('Free')), 'freelancer fora da lista');
  assert.ok(resumo.find((r) => r.funcionario_id === saiu).cartao_id);
});

// --- Segurança ------------------------------------------------------------------

test('segurança: permissões, RLS, sem escrita direta, internas sem EXECUTE', { skip: pular }, async () => {
  const f = await criarFuncionaria('Segurança');
  const c = await valor(rpc.abrir(f, '2026-10-01'));
  const at = await valor(rpc.atestado(f, { data_inicio: '2026-10-05' }));

  const negadas = [
    () => rpc.abrir(f, '2026-10-01', GESTAO), () => rpc.base(f, '2026-10-01', GESTAO), () => rpc.resumo('2026-10-01', GESTAO),
    () => rpc.salvar(c.cartao_id, 1, [{ data: '2026-10-06', observacao: 'x' }], GESTAO), () => rpc.conferir(c.cartao_id, 1, GESTAO),
    () => rpc.fechar(c.cartao_id, 1, GESTAO), () => rpc.atestado(f, { data_inicio: '2026-10-09' }, { u: GESTAO }),
    () => rpc.cancelarAtestado(at.atestado_id, 1, 'x', GESTAO), () => rpc.atestado(f, { data_inicio: '2026-10-09' }, { u: LEITOR }),
  ];
  // Uma de cada vez: rodar() troca o papel da sessão compartilhada.
  for (const [i, chamada] of negadas.entries()) {
    assert.equal((await chamada()).sqlstate, '42501', `chamada ${i}`);
  }
  assert.ok((await rodar('select id from public.folha_ponto_atestados', [], LEITOR)).linhas.length > 0);
  assert.ok((await valor(rpc.base(f, '2026-10-01', LEITOR))).cartao);
  assert.equal((await rodar('select id from public.folha_ponto_cartoes', [], GESTAO)).linhas.length, 0);
  assert.equal((await rodar('select id from public.folha_ponto_atestados', [], GESTAO)).linhas.length, 0);
  for (const sql of [
    `insert into public.folha_ponto_cartoes (funcionario_id, competencia) values ('${f}', '2026-09-01')`,
    `update public.folha_ponto_cartoes set versao = versao + 1 where id = '${c.cartao_id}'`,
    `insert into public.folha_ponto_atestados (funcionario_id, tipo, abrangencia, data_inicio, data_fim, descricao) values ('${f}', 'outro', 'integral', '2026-10-20', '2026-10-20', 'x')`,
    `update public.folha_ponto_atestados set descricao = 'y' where id = '${at.atestado_id}'`,
    `insert into public.folha_ponto_eventos (funcionario_id, cartao_id, acao, versao) values ('${f}', '${c.cartao_id}', 'abrir', 1)`,
  ]) {
    assert.equal((await rodar(sql, [], ADMIN)).sqlstate, '42501', sql);
  }
  for (const sql of ['select public.folha_ponto_apurar(\'{}\'::jsonb)', `select public.folha_ponto_montar_base('${f}', '2026-10-01')`,
    `select public.folha_ponto_invalidar_cartoes('${f}', '2026-10-01', '2026-10-31', 'x')`]) {
    assert.equal((await rodar(sql, [], ADMIN)).sqlstate, '42501', sql);
  }
  const anon = await (async () => {
    const d = await banco();
    try { await d.exec('set role anon'); await d.query(`select public.folha_ponto_base('${f}', '2026-10-01')`); return null; } catch (e) { return e.code; } finally { await d.exec('reset role'); }
  })();
  assert.equal(anon, '42501');
});

// --- [obrig. 18] Integridade e ausência de integração financeira --------------

test('integridade: cartão nasce limpo, versão só +1, nada financeiro na 0078', { skip: pular }, async () => {
  assert.match((await rodar(`insert into public.folha_ponto_cartoes (funcionario_id, competencia, status) select id, '2026-09-01', 'fechado' from public.funcionarios limit 1`)).mensagem, /nasce em preenchimento|estado_coerente/);
  assert.match((await rodar(`insert into public.folha_ponto_cartoes (funcionario_id, competencia) select id, '2026-09-15' from public.funcionarios limit 1`)).mensagem, /competencia_mes/);
  const [{ id }] = await su(`select id from public.folha_ponto_cartoes where status = 'em_preenchimento' limit 1`);
  assert.match((await rodar(`update public.folha_ponto_cartoes set versao = versao + 2 where id = $1`, [id])).mensagem, /exatamente 1/);
  assert.match((await rodar(`insert into public.folha_ponto_atestados (funcionario_id, tipo, abrangencia, data_inicio, data_fim, descricao)
                             select id, 'outro', 'parcial', '2026-10-01', '2026-10-02', 'x' from public.funcionarios limit 1`)).mensagem, /horario_coerente/);

  const sql = readFileSync(new URL('../../../supabase/migrations/0078_folha_cartao_ponto.sql', import.meta.url), 'utf8').toLowerCase();
  const semComentarios = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const proibido of ['folha_pagamentos', 'folha_lancamentos', 'folha_calcular_pendencia', 'valor_hora', 'remuneracao', 'numeric(']) {
    assert.ok(!semComentarios.includes(proibido), `0078 não referencia ${proibido}`);
  }
  const funcoes = await su(`select count(*)::int n from pg_proc where proname like 'folha\\_ponto%'
                             and (prosrc like '%folha_pagamentos%' or prosrc like '%folha_lancamentos%')`);
  assert.equal(funcoes[0].n, 0);
});
