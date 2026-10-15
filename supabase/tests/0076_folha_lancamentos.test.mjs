// Testes da migration 0076 (Folha > Pagamentos > lancamentos pendentes por
// funcionaria) sobre as migrations REAIS 0001..0075 (ambiente_pedidos.mjs),
// em PostgreSQL embutido (PGlite). Politicas exercidas com SET ROLE
// authenticated/anon. Tambem roda os SQLs PRE/POS da raiz (quando presentes)
// e confere que o EXECUTAR e byte-identico a migration. Nada aqui toca o
// Supabase real.
//
//   npm i --no-save @electric-sql/pglite
//   node --test supabase/tests/0076_folha_lancamentos.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN, FINANCEIRO, GESTAO, RAIZ, como, fabricaDeBancos, fecharBancos, lerMigration, valor, aplicarMigration } from './ambiente_pedidos.mjs';

after(fecharBancos);

const M76 = '0076_folha_lancamentos.sql';
const PRE = join(RAIZ, '0076_pre_auditoria_folha_lancamentos_EXECUTAR.sql');
const POS = join(RAIZ, '0076_pos_auditoria_folha_lancamentos_EXECUTAR.sql');
const EXECUTAR = join(RAIZ, '0076_folha_lancamentos_EXECUTAR.sql');
const ANTERIORES = ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql', '0075_preferencias_usuario_mensagem_pedido.sql'];

const SIMONE = '00000000-0000-0000-0000-0000000005a1'; // por hora
const MARIA = '00000000-0000-0000-0000-0000000005a2'; // mensal
const INATIVA = '00000000-0000-0000-0000-0000000005a3';

// Funcionarias, regras e Escala minimas (como dono, antes dos testes).
const CENARIO = `
  insert into public.funcionarios (id, nome, ativo) values
    ('${SIMONE}', 'SIMONE GUEDES', true), ('${MARIA}', 'MARIA MENSAL', true), ('${INATIVA}', 'ANTIGA INATIVA', true);
  update public.funcionarios set ativo = false where id = '${INATIVA}';
  insert into public.folha_valor_hora (valor, vigente_desde) values (20.00, '2026-01-01');
  insert into public.funcionarios_forma_remuneracao (funcionario_id, forma, vigente_desde) values
    ('${SIMONE}', 'por_hora', '2025-01-01'), ('${MARIA}', 'mensal', '2026-01-01');
  insert into public.funcionarios_remuneracao_base (funcionario_id, valor, vigente_desde) values ('${MARIA}', 1500.00, '2026-01-01');
  insert into public.funcionarios_escala_dias (id, funcionario_id, data, tipo_dia) values
    ('00000000-0000-0000-0000-00000000d001', '${SIMONE}', '2026-02-10', 'trabalho'),
    ('00000000-0000-0000-0000-00000000d002', '${SIMONE}', '2026-02-11', 'trabalho'),
    ('00000000-0000-0000-0000-00000000d003', '${SIMONE}', '2025-12-10', 'trabalho');
  insert into public.funcionarios_escala_periodos (escala_dia_id, hora_inicio, hora_fim) values
    ('00000000-0000-0000-0000-00000000d001', '08:00', '12:00'),
    ('00000000-0000-0000-0000-00000000d002', '08:00', '12:00'),
    ('00000000-0000-0000-0000-00000000d003', '08:00', '12:00');
  insert into public.usuario_permissoes (usuario_id, permissao, efeito) values ('${FINANCEIRO}', 'folha_pagamentos.visualizar', 'concede');
`;

const fabricaSem76 = fabricaDeBancos({ extras: ANTERIORES });
const fabricaCom76 = fabricaDeBancos({ extras: [...ANTERIORES, M76] });

async function banco() {
  const db = await fabricaCom76();
  await db.exec(CENARIO);
  return db;
}

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

const rpcTipo = (db, id, nome, natureza, ativo = true) =>
  valor(db, 'select public.folha_lancamento_tipo_salvar($1, $2, $3, $4)', [id, nome, natureza, ativo]);
const rpcCriar = (db, funcionario, tipo, natureza, v, data = '2026-02-12', obs = null) =>
  valor(db, 'select public.folha_lancamento_criar($1, $2, $3, $4, $5, $6)', [funcionario, tipo, natureza, v, data, obs]);
const JORNADA_10 = JSON.stringify([{ data: '2026-02-10', hora_inicio: '08:00', hora_fim: '12:00' }]);
const JORNADA_11 = JSON.stringify([{ data: '2026-02-11', hora_inicio: '08:00', hora_fim: '12:00' }]);
const pagarPorHora = (db, jornadas, lancamentos = null, descontos = '[]') =>
  lancamentos === null
    ? valor(db, `select public.folha_criar_pagamento_por_hora(p_funcionario_id => $1, p_jornadas => $2::jsonb, p_descontos => $3::jsonb, p_data_efetiva => '2026-02-15', p_observacao => null)`, [SIMONE, jornadas, descontos])
    : valor(db, `select public.folha_criar_pagamento_por_hora($1, $2::jsonb, $3::jsonb, '2026-02-15', null, $4::uuid[])`, [SIMONE, jornadas, descontos, lancamentos]);
// Tipos iniciais criados pela propria 0076 (seed): Compra na Padoca, Adiantamento, Vale.
const tipoSeed = (db, nome) => valor(db, 'select id from public.folha_lancamentos_tipos where nome = $1', [nome]);
const lancamento = async (db, id) => (await db.query('select * from public.folha_lancamentos where id = $1', [id])).rows[0];

// Cenario comum: tipo inicial Compra na Padoca + Ajuste (criado) + Simone com 1 desconto (32,50) e 1 acrescimo (20,00).
async function comLancamentos(db) {
  return comoAutenticado(db, ADMIN, async () => {
    const compra = await tipoSeed(db, 'Compra na Padoca');
    const ajuste = await rpcTipo(db, null, 'Ajuste', 'acrescimo');
    const desconto = await rpcCriar(db, SIMONE, compra, 'desconto', 32.5, '2026-02-12', 'Lanche');
    const acrescimo = await rpcCriar(db, SIMONE, ajuste, 'acrescimo', 20);
    return { compra, ajuste, desconto, acrescimo };
  });
}

test('aplica sobre 0001..0075 e reaplicar aborta pela guarda', async () => {
  const db = await fabricaCom76();
  for (const t of ['folha_lancamentos_tipos', 'folha_lancamentos', 'folha_pagamentos_lancamentos']) {
    assert.ok(await valor(db, 'select to_regclass($1) is not null', [`public.${t}`]), t);
  }
  assert.equal(await valor(db, "select count(*)::int from public.permissoes where codigo like 'folha_lancamento%'"), 0, 'nenhuma permissao nova');
  await falha(aplicarMigration(db, M76), /0076 abortada/);
});

test('seed: 3 tipos iniciais de DESCONTO, ativos, criados pela migration; sem Ajuste/Outros', async () => {
  const db = await fabricaCom76();
  const tipos = (await db.query('select nome, natureza, ativo, criado_por, atualizado_em from public.folha_lancamentos_tipos order by nome')).rows;
  assert.deepEqual(tipos, [
    { nome: 'Adiantamento', natureza: 'desconto', ativo: true, criado_por: null, atualizado_em: null },
    { nome: 'Compra na Padoca', natureza: 'desconto', ativo: true, criado_por: null, atualizado_em: null },
    { nome: 'Vale', natureza: 'desconto', ativo: true, criado_por: null, atualizado_em: null },
  ]);
  assert.equal(await valor(db, "select count(*)::int from public.folha_lancamentos_tipos where lower(btrim(nome)) in ('ajuste', 'outros')"), 0);
  // continuam administraveis por Configuracoes (RPC de tipos).
  await comoAutenticado(db, ADMIN, async () => {
    const vale = await tipoSeed(db, 'Vale');
    await rpcTipo(db, vale, 'Vale', 'desconto', false);
    assert.equal(await valor(db, 'select ativo from public.folha_lancamentos_tipos where id = $1', [vale]), false);
  });
  // reaplicar continua abortando pela guarda (nenhum tipo duplicado).
  await falha(aplicarMigration(db, M76), /0076 abortada/);
  await db.exec('rollback');
  assert.equal(await valor(db, 'select count(*)::int from public.folha_lancamentos_tipos'), 3);
});

test('guarda: aborta se folha_hoje() divergir da 0066 (ex.: data em UTC)', async () => {
  const db = await fabricaSem76();
  await db.exec("create or replace function public.folha_hoje() returns date language sql stable set search_path = '' as 'select current_date'");
  await falha(aplicarMigration(db, M76), /folha_hoje\(\) real difere/);
  await db.exec('rollback');
  assert.equal(await valor(db, "select to_regclass('public.folha_lancamentos') is null"), true, 'nada foi criado');
});

test('data do lancamento: hoje (America/Sao_Paulo) e passado aceitos; futuro recusado ao criar e ao editar', async () => {
  const db = await banco();
  // Sessao num fuso diferente (UTC+9): "hoje" continua sendo o de Sao Paulo.
  await db.exec("set timezone = 'Asia/Tokyo'");
  const hojeSP = await valor(db, "select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD')");
  assert.equal(await valor(db, "select to_char(public.folha_hoje(), 'YYYY-MM-DD')"), hojeSP);
  const amanha = await valor(db, "select to_char((now() at time zone 'America/Sao_Paulo')::date + 1, 'YYYY-MM-DD')");
  await comoAutenticado(db, ADMIN, async () => {
    const compra = await tipoSeed(db, 'Compra na Padoca');
    const deHoje = await rpcCriar(db, SIMONE, compra, 'desconto', 10, hojeSP);
    assert.equal((await lancamento(db, deHoje)).status, 'pendente', 'data de hoje aceita');
    const antigo = await rpcCriar(db, SIMONE, compra, 'desconto', 10, '2025-06-01');
    assert.equal((await lancamento(db, antigo)).status, 'pendente', 'data historica aceita');
    await falha(rpcCriar(db, SIMONE, compra, 'desconto', 10, amanha), /nao pode ser no futuro/);
    await falha(rpcCriar(db, SIMONE, compra, 'desconto', 10, '2099-01-01'), /nao pode ser no futuro/);
    await falha(db.query("select public.folha_lancamento_editar($1, $2, 'desconto', 10, $3, null)", [antigo, compra, amanha]), /nao pode ser no futuro/);
    assert.equal((await lancamento(db, antigo)).data_lancamento.toISOString().slice(0, 10), '2025-06-01', 'edicao recusada nao mudou nada');
    await db.query("select public.folha_lancamento_editar($1, $2, 'desconto', 12, $3, null)", [antigo, compra, hojeSP]);
    await db.query("select public.folha_lancamento_editar($1, $2, 'desconto', 12, '2025-05-31', 'passado')", [antigo, compra]);
  });
  // Cliente adulterado / escrita direta (dono, sem RPC): o trigger tambem recusa.
  const compra = await tipoSeed(db, 'Compra na Padoca');
  await falha(
    db.query("insert into public.folha_lancamentos (funcionario_id, tipo_id, natureza, valor, data_lancamento) values ($1, $2, 'desconto', 1, $3)", [SIMONE, compra, amanha]),
    /folha_lancamentos: data do lancamento .* nao pode ser no futuro/,
  );
  await falha(db.query("update public.folha_lancamentos set data_lancamento = $1 where status = 'pendente'", [amanha]), /nao pode ser no futuro/);
  assert.equal(await valor(db, 'select count(*)::int from public.folha_lancamentos where data_lancamento > public.folha_hoje()'), 0);
});

test('guarda: aborta se uma RPC substituida divergir do repositorio (fingerprint)', async () => {
  const db = await fabricaSem76();
  const src = (await db.query("select pg_get_functiondef(to_regprocedure('public.folha_cancelar_pagamento(uuid,text)')) as d")).rows[0].d;
  await db.exec(src.replace('o motivo do cancelamento e obrigatorio', 'o motivo e obrigatorio (versao divergente)'));
  await falha(aplicarMigration(db, M76), /folha_cancelar_pagamento real difere/);
  // A exceção deixa a transação do BEGIN da migration abortada: desfaz.
  await db.exec('rollback');
  assert.equal(await valor(db, "select to_regclass('public.folha_lancamentos') is null"), true, 'nada foi criado');
});

test('cria desconto e acrescimo pendentes com autoria do servidor', async () => {
  const db = await banco();
  const { desconto, acrescimo } = await comLancamentos(db);
  const d = await lancamento(db, desconto);
  assert.equal(d.status, 'pendente');
  assert.equal(d.natureza, 'desconto');
  assert.equal(d.valor, '32.50');
  assert.equal(d.observacao, 'Lanche');
  assert.equal(d.pagamento_id, null);
  assert.equal(d.criado_por, ADMIN);
  assert.equal(d.criado_por_nome, 'ADMIN TESTE');
  assert.equal((await lancamento(db, acrescimo)).natureza, 'acrescimo');
});

test('validacoes de criacao: tipo inativo, funcionaria inativa, valor, natureza, nome unico', async () => {
  const db = await banco();
  await comoAutenticado(db, ADMIN, async () => {
    const vale = await tipoSeed(db, 'Vale');
    await falha(rpcTipo(db, null, '  vale ', 'desconto'), /ja existe um tipo/);
    await falha(rpcTipo(db, null, 'COMPRA NA PADOCA', 'acrescimo'), /ja existe um tipo/);
    await falha(rpcTipo(db, null, 'X', 'outro'), /natureza invalida/);
    await falha(rpcCriar(db, SIMONE, vale, 'desconto', 0), /maior que zero/);
    await falha(rpcCriar(db, SIMONE, vale, 'credito', 10), /natureza invalida/);
    await falha(rpcCriar(db, INATIVA, vale, 'desconto', 10), /funcionaria inativa/);
    await rpcTipo(db, vale, 'Vale', 'desconto', false);
    await falha(rpcCriar(db, SIMONE, vale, 'desconto', 10), /tipo de lancamento inativo/);
  });
});

test('pagamento com lancamentos: liquido = bruto + acrescimos - descontos, snapshot e utilizado', async () => {
  const db = await banco();
  const { desconto, acrescimo } = await comLancamentos(db);
  const pagamento = await comoAutenticado(db, ADMIN, () => pagarPorHora(db, JORNADA_10, `{${desconto},${acrescimo}}`));
  const p = (await db.query('select * from public.folha_pagamentos where id = $1', [pagamento])).rows[0];
  assert.equal(p.valor_bruto, '80.00');
  assert.equal(p.total_acrescimos, '20.00');
  assert.equal(p.total_descontos, '32.50');
  assert.equal(p.valor_liquido, '67.50');
  for (const id of [desconto, acrescimo]) {
    const l = await lancamento(db, id);
    assert.equal(l.status, 'utilizado');
    assert.equal(l.pagamento_id, pagamento);
  }
  const snap = (await db.query('select natureza, tipo_nome, valor from public.folha_pagamentos_lancamentos where pagamento_id = $1 order by natureza', [pagamento])).rows;
  assert.deepEqual(snap, [
    { natureza: 'acrescimo', tipo_nome: 'Ajuste', valor: '20.00' },
    { natureza: 'desconto', tipo_nome: 'Compra na Padoca', valor: '32.50' },
  ]);
});

test('selecao parcial: o nao selecionado continua pendente; utilizado nao entra em 2o pagamento', async () => {
  const db = await banco();
  const { desconto, acrescimo } = await comLancamentos(db);
  await comoAutenticado(db, ADMIN, async () => {
    await pagarPorHora(db, JORNADA_10, `{${desconto}}`);
    assert.equal((await lancamento(db, acrescimo)).status, 'pendente');
    await falha(pagarPorHora(db, JORNADA_11, `{${desconto}}`), /nao esta pendente/);
    await falha(pagarPorHora(db, JORNADA_11, `{${acrescimo},${acrescimo}}`), /lancamento repetido/);
  });
  // a falha nao deixou estado parcial: a jornada 11 continua sem pagamento.
  assert.equal(await valor(db, "select count(*)::int from public.folha_pagamentos_itens where data = '2026-02-11'"), 0);
  // ultima barreira: indice unico parcial impede 2 snapshots ativos do mesmo lancamento.
  const pag = await valor(db, 'select pagamento_id from public.folha_lancamentos where id = $1', [desconto]);
  await falha(
    db.query(
      "insert into public.folha_pagamentos_lancamentos (pagamento_id, lancamento_id, funcionario_id, natureza, tipo_id, tipo_nome, valor, data_lancamento) select $1, id, funcionario_id, natureza, tipo_id, 'X', valor, data_lancamento from public.folha_lancamentos where id = $2",
      [pag, desconto],
    ),
    /folha_pagamentos_lancamentos_ativo_unico_idx/,
  );
});

test('lancamento de outra funcionaria e recusado; descontos acima do bruto sao recusados', async () => {
  const db = await banco();
  await comoAutenticado(db, ADMIN, async () => {
    const compra = await tipoSeed(db, 'Compra na Padoca');
    const daMaria = await rpcCriar(db, MARIA, compra, 'desconto', 10);
    await falha(pagarPorHora(db, JORNADA_10, `{${daMaria}}`), /pertence a outra funcionaria/);
    const grande = await rpcCriar(db, SIMONE, compra, 'desconto', 80.01);
    await falha(pagarPorHora(db, JORNADA_10, `{${grande}}`), /ultrapassam o valor bruto/);
    assert.equal((await lancamento(db, grande)).status, 'pendente');
  });
  assert.equal(await valor(db, 'select count(*)::int from public.folha_pagamentos'), 0, 'nenhum pagamento parcial gravado');
});

test('cancelar o pagamento devolve os lancamentos a pendente e o snapshot fica no historico', async () => {
  const db = await banco();
  const { desconto } = await comLancamentos(db);
  await comoAutenticado(db, ADMIN, async () => {
    const pagamento = await pagarPorHora(db, JORNADA_10, `{${desconto}}`);
    await db.query("select public.folha_cancelar_pagamento($1, 'lancado errado')", [pagamento]);
    const l = await lancamento(db, desconto);
    assert.equal(l.status, 'pendente');
    assert.equal(l.pagamento_id, null);
    assert.equal(await valor(db, 'select pagamento_cancelado from public.folha_pagamentos_lancamentos where pagamento_id = $1', [pagamento]), true);
    const novo = await pagarPorHora(db, JORNADA_10, `{${desconto}}`);
    assert.equal((await lancamento(db, desconto)).pagamento_id, novo, 'reutilizavel em novo pagamento');
  });
});

test('historico mantem o snapshot apos renomear/inativar o tipo; pendente de tipo inativado ainda pode ser usado', async () => {
  const db = await banco();
  const { compra, desconto, acrescimo } = await comLancamentos(db);
  await comoAutenticado(db, ADMIN, async () => {
    const pagamento = await pagarPorHora(db, JORNADA_10, `{${desconto}}`);
    await rpcTipo(db, compra, 'Consumo interno', 'desconto', false);
    assert.equal(await valor(db, 'select tipo_nome from public.folha_pagamentos_lancamentos where pagamento_id = $1', [pagamento]), 'Compra na Padoca');
    const ajuste = await valor(db, 'select tipo_id from public.folha_lancamentos where id = $1', [acrescimo]);
    await rpcTipo(db, ajuste, 'Ajuste', 'acrescimo', false);
    await pagarPorHora(db, JORNADA_11, `{${acrescimo}}`);
    assert.equal((await lancamento(db, acrescimo)).status, 'utilizado');
  });
});

test('editar e cancelar: so pendente; cancelado e final e nao entra em pagamento', async () => {
  const db = await banco();
  const { compra, desconto, acrescimo } = await comLancamentos(db);
  await comoAutenticado(db, ADMIN, async () => {
    await db.query("select public.folha_lancamento_editar($1, $2, 'desconto', 40, '2026-02-13', '  ')", [desconto, compra]);
    const e = await lancamento(db, desconto);
    assert.deepEqual([e.valor, e.data_lancamento.toISOString().slice(0, 10), e.observacao, e.atualizado_por], ['40.00', '2026-02-13', null, ADMIN]);
    await falha(db.query("select public.folha_lancamento_cancelar($1, '  ')", [acrescimo]), /motivo do cancelamento e obrigatorio/);
    await db.query("select public.folha_lancamento_cancelar($1, 'nao era devido')", [acrescimo]);
    const c = await lancamento(db, acrescimo);
    assert.deepEqual([c.status, c.cancelado_por, c.motivo_cancelamento], ['cancelado', ADMIN, 'nao era devido']);
    await falha(db.query("select public.folha_lancamento_cancelar($1, 'de novo')", [acrescimo]), /so lancamento pendente pode ser cancelado/);
    await falha(db.query("select public.folha_lancamento_editar($1, $2, 'desconto', 1, '2026-02-13', null)", [acrescimo, compra]), /so lancamento pendente pode ser editado/);
    await falha(pagarPorHora(db, JORNADA_10, `{${acrescimo}}`), /nao esta pendente/);
    await pagarPorHora(db, JORNADA_10, `{${desconto}}`);
    await falha(db.query("select public.folha_lancamento_editar($1, $2, 'desconto', 1, '2026-02-13', null)", [desconto, compra]), /so lancamento pendente pode ser editado/);
    await falha(db.query("select public.folha_lancamento_cancelar($1, 'x')", [desconto]), /so lancamento pendente pode ser cancelado/);
  });
});

test('permissoes e RLS: sem permissao nao le nem escreve; visualizar so le; anon nada', async () => {
  const db = await banco();
  const { compra, desconto } = await comLancamentos(db);
  await comoAutenticado(db, GESTAO, async () => {
    assert.equal(await valor(db, 'select count(*)::int from public.folha_lancamentos'), 0, 'gestao nao ve');
    await falha(rpcCriar(db, SIMONE, compra, 'desconto', 1), /requer a permissao folha_pagamentos.editar/);
    await falha(rpcTipo(db, null, 'Novo', 'desconto'), /requer a permissao folha_pagamentos.regras/);
    await falha(db.query("select public.folha_lancamento_cancelar($1, 'x')", [desconto]), /requer a permissao/);
  });
  await comoAutenticado(db, FINANCEIRO, async () => {
    assert.equal(await valor(db, 'select count(*)::int from public.folha_lancamentos'), 2, 'visualizar le');
    assert.equal(await valor(db, 'select count(*)::int from public.folha_lancamentos_tipos'), 4, '3 iniciais + Ajuste');
    await falha(rpcCriar(db, SIMONE, compra, 'desconto', 1), /requer a permissao folha_pagamentos.editar/);
    await falha(pagarPorHora(db, JORNADA_10, `{${desconto}}`), /requer a permissao folha_pagamentos.confirmar/);
  });
  await como(db, null);
  await db.exec('set role anon');
  try {
    for (const t of ['folha_lancamentos_tipos', 'folha_lancamentos', 'folha_pagamentos_lancamentos']) {
      await falha(db.query(`select * from public.${t}`), /permission denied/);
    }
    await falha(db.query('select public.folha_lancamento_criar(null, null, null, null, null, null)'), /permission denied/);
  } finally {
    await db.exec('reset role');
  }
});

test('cliente nao adultera status/pagamento/autoria; guarda vale ate para o dono', async () => {
  const db = await banco();
  const { desconto, acrescimo } = await comLancamentos(db);
  await comoAutenticado(db, ADMIN, async () => {
    await falha(db.query("update public.folha_lancamentos set status = 'utilizado' where id = $1", [desconto]), /permission denied/);
    await falha(db.query('delete from public.folha_lancamentos where id = $1', [desconto]), /permission denied/);
    await falha(db.query("insert into public.folha_lancamentos (funcionario_id, tipo_id, natureza, valor, data_lancamento) select funcionario_id, tipo_id, natureza, 1, data_lancamento from public.folha_lancamentos limit 1"), /permission denied/);
    await falha(db.query('update public.folha_pagamentos_lancamentos set valor = 1'), /permission denied/);
    await pagarPorHora(db, JORNADA_10, `{${desconto}}`);
  });
  // Mesmo como dono (bypass de RLS/grants) a maquina de estados vale.
  const outroPagamento = await valor(db, 'select id from public.folha_pagamentos limit 1');
  await falha(db.query("update public.folha_lancamentos set status = 'utilizado', pagamento_id = $2, utilizado_em = now() where id = $1", [acrescimo, outroPagamento]), /so um pagamento confirmado desta funcionaria, que registrou/);
  await falha(db.query('update public.folha_lancamentos set valor = 1 where id = $1', [desconto]), /ja utilizado em pagamento e imutavel/);
  await falha(db.query("update public.folha_lancamentos set status = 'pendente', pagamento_id = null, utilizado_em = null where id = $1", [desconto]), /so volta a pendente com o cancelamento/);
  await falha(db.query('update public.folha_lancamentos set criado_por = null where id = $1', [acrescimo]), /autoria do lancamento sao imutaveis/);
  await falha(db.query('delete from public.folha_lancamentos where id = $1', [acrescimo]), /nunca e apagado/);
  await falha(db.query('update public.folha_pagamentos_lancamentos set valor = 1'), /snapshot de lancamento e imutavel/);
  await falha(db.query('update public.folha_pagamentos_lancamentos set pagamento_cancelado = true'), /so o cancelamento do pagamento libera/);
  await falha(db.query('delete from public.folha_pagamentos_lancamentos'), /nunca e apagado/);
  await falha(db.query('update public.folha_pagamentos set total_acrescimos = 5 where id = $1', [outroPagamento]), /pagamento confirmado e imutavel/);
});

test('regressao: pagamento sem lancamentos continua identico (chamada antiga, sem p_lancamentos)', async () => {
  const db = await banco();
  await comLancamentos(db);
  const pagamento = await comoAutenticado(db, ADMIN, () => pagarPorHora(db, JORNADA_10, null, JSON.stringify([{ tipo: 'Vale antigo', valor: 5 }])));
  const p = (await db.query('select valor_bruto, total_acrescimos, total_descontos, valor_liquido from public.folha_pagamentos where id = $1', [pagamento])).rows[0];
  assert.deepEqual(p, { valor_bruto: '80.00', total_acrescimos: '0.00', total_descontos: '5.00', valor_liquido: '75.00' });
  assert.equal(await valor(db, 'select count(*)::int from public.folha_pagamentos_lancamentos'), 0);
  assert.equal(await valor(db, "select count(*)::int from public.folha_lancamentos where status = 'pendente'"), 2, 'pendentes intocados');
});

test('mensal e regularizacao historica tambem consomem lancamentos', async () => {
  const db = await banco();
  await comoAutenticado(db, ADMIN, async () => {
    const compra = await tipoSeed(db, 'Compra na Padoca');
    const daMaria = await rpcCriar(db, MARIA, compra, 'desconto', 100);
    const mensal = await valor(
      db,
      "select public.folha_criar_pagamento_mensal($1, '2026-02-01', 'integral', 1500, '[]'::jsonb, '[]'::jsonb, '2026-03-05', null, $2::uuid[])",
      [MARIA, `{${daMaria}}`],
    );
    assert.equal(await valor(db, 'select valor_liquido from public.folha_pagamentos where id = $1', [mensal]), '1400.00');
    const daSimone = await rpcCriar(db, SIMONE, compra, 'desconto', 10);
    const historico = await valor(
      db,
      "select public.folha_criar_pagamento_regularizacao_historica($1, $2::jsonb, '[]'::jsonb, '2026-02-15', null, $3::uuid[])",
      [SIMONE, JSON.stringify([{ data: '2025-12-10', hora_inicio: '08:00', hora_fim: '12:00', valor: 70 }]), `{${daSimone}}`],
    );
    assert.equal(await valor(db, 'select valor_liquido from public.folha_pagamentos where id = $1', [historico]), '60.00');
    assert.equal((await lancamento(db, daSimone)).status, 'utilizado');
  });
});

test('SQLs PRE/POS da raiz rodam (zero FALHA) e o EXECUTAR e byte-identico a migration', async (t) => {
  if (!existsSync(PRE) || !existsSync(POS) || !existsSync(EXECUTAR)) {
    t.skip('arquivos PRE/POS/EXECUTAR ausentes nesta copia (nao versionados)');
    return;
  }
  assert.ok(readFileSync(EXECUTAR).equals(readFileSync(join(RAIZ, 'supabase', 'migrations', M76))), 'EXECUTAR difere da migration');
  // Criterio dos auditores: FALHA reprova; OK e INFO (so informativo) passam.
  const antes = await fabricaSem76();
  const pre = (await antes.query(readFileSync(PRE, 'utf8'))).rows;
  assert.ok(pre.length > 0, 'PRE devolve linhas');
  assert.deepEqual(pre.filter((l) => l.status === 'FALHA').map((l) => l.verificacao), [], 'PRE: nenhuma FALHA antes da 0076');
  const depois = await fabricaCom76();
  const pos = (await depois.query(readFileSync(POS, 'utf8'))).rows;
  assert.ok(pos.length > 0, 'POS devolve linhas');
  assert.deepEqual(pos.filter((l) => l.status === 'FALHA').map((l) => l.verificacao), [], 'POS: nenhuma FALHA depois da 0076');
  assert.ok(lerMigration(M76).includes('BEGIN;'));
});
