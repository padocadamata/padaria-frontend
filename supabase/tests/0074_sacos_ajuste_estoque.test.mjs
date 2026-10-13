// Testes da migration 0074 (Ajuste de Estoque em Sacos Fechados) sobre as
// migrations REAIS 0001..0073 (ambiente_pedidos.mjs), em PostgreSQL
// embutido (PGlite). Também roda os SQLs PRE/POS da raiz e confere que o
// EXECUTAR é byte-idêntico à migration. Nada aqui toca o Supabase real.
//
//   npm i --no-save @electric-sql/pglite
//   node --test supabase/tests/0074_sacos_ajuste_estoque.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADMIN, GESTAO, OPERACIONAL, FORNECEDOR_A, RAIZ,
  como, fabricaDeBancos, fecharBancos, lerMigration, novoBanco, valor,
} from './ambiente_pedidos.mjs';

const M74 = '0074_sacos_ajuste_estoque.sql';
const PRE = join(RAIZ, '0074_pre_auditoria_sacos_ajuste_estoque_EXECUTAR.sql');
const POS = join(RAIZ, '0074_pos_auditoria_sacos_ajuste_estoque_EXECUTAR.sql');
const EXECUTAR = join(RAIZ, '0074_sacos_ajuste_estoque_EXECUTAR.sql');

const PRODUTO = '00000000-0000-0000-0000-0000000000a1';
const CONFIG = '00000000-0000-0000-0000-0000000000c1';
const CONFIG_INATIVA = '00000000-0000-0000-0000-0000000000c2';
const PESO = 25;

after(fecharBancos);

const CATALOGO = `
  insert into public.produtos (id, nome, unidade_medida) values ('${PRODUTO}', 'PAO FRANCES TESTE', 'KG');
  insert into public.produto_fornecedores (id, produto_id, fornecedor_id, unidade_comercial, ativo, controla_sacos_fechados, peso_por_saco_kg)
  values ('${CONFIG}', '${PRODUTO}', '${FORNECEDOR_A}', 'SC', true, true, ${PESO}),
         ('${CONFIG_INATIVA}', '${PRODUTO}', '${FORNECEDOR_A}', 'SC', false, true, ${PESO});
`;

const banco = fabricaDeBancos({ extras: ['0073_contas_pagar.sql', M74] });

async function bancoComSaldo3() {
  const db = await banco();
  await db.exec(CATALOGO);
  await db.query('select public.registrar_saldo_inicial_sacos($1, 5, gen_random_uuid(), null)', [CONFIG]);
  await db.query('select public.registrar_abertura_saco($1, 2, gen_random_uuid(), null)', [CONFIG]);
  return db;
}

const saldoSacos = (db, config = CONFIG) =>
  valor(db, 'select coalesce(sum(quantidade_sacos), 0)::int from public.sacos_fechados_movimentacoes where produto_fornecedor_id = $1', [config]);
const saldoKg = (db) =>
  valor(db, 'select coalesce(sum(quantidade), 0)::float8 from public.estoque_movimentacoes where produto_id = $1', [PRODUTO]);
const contar = async (db, sql, params = []) => Number(await valor(db, sql, params));

function ajustar(db, { fisico, esperado, motivo = 'correcao de estoque', operacao = null, observacao = null, config = CONFIG }) {
  return db.query(
    'select * from public.registrar_ajuste_sacos($1, $2, $3, $4, coalesce($5::uuid, gen_random_uuid()), $6)',
    [config, fisico, esperado, motivo, operacao, observacao],
  );
}

async function fotografia(db) {
  return {
    sacos: await contar(db, 'select count(*) from public.sacos_fechados_movimentacoes'),
    estoque: await contar(db, 'select count(*) from public.estoque_movimentacoes'),
    logs: await contar(db, 'select count(*) from public.logs_auditoria'),
  };
}

test('zerar: grava ajuste −3, estoque −75 kg, auditoria e saldo final 0 (caso Pão Francês)', async () => {
  const db = await bancoComSaldo3();
  assert.equal(await saldoSacos(db), 3);
  assert.equal(await saldoKg(db), 75);

  const { rows } = await ajustar(db, { fisico: 0, esperado: 3, motivo: '  baixas lancadas por engano  ', observacao: 'contagem 13/10' });
  const mov = rows[0];
  assert.equal(mov.tipo, 'ajuste_manual');
  assert.equal(mov.origem, 'ajuste_manual');
  assert.equal(mov.quantidade_sacos, -3);
  assert.equal(mov.saldo_anterior_sacos, 3);
  assert.equal(mov.motivo, 'baixas lancadas por engano');
  assert.equal(mov.observacao, 'contagem 13/10');
  assert.equal(mov.criado_por, ADMIN);
  assert.equal(Number(mov.peso_por_saco_kg_snapshot), PESO);

  assert.equal(await saldoSacos(db), 0);
  assert.equal(await saldoKg(db), 0);

  const est = await db.query('select quantidade::float8 q, unidade, observacao from public.estoque_movimentacoes where origem = $1 and origem_id = $2', ['sacos_fechados_ajuste', mov.id]);
  assert.deepEqual(est.rows, [{ q: -75, unidade: 'KG', observacao: 'baixas lancadas por engano' }]);

  const log = await db.query('select usuario_id, entidade, acao, campo, valor_anterior, valor_novo from public.logs_auditoria where registro_id = $1', [mov.id]);
  assert.deepEqual(log.rows, [{
    usuario_id: ADMIN, entidade: 'sacos_fechados_movimentacao', acao: 'ajustou_estoque',
    campo: 'saldo_sacos', valor_anterior: '3', valor_novo: '0',
  }]);
});

test('ajuste positivo: físico acima do saldo gera entrada (+4) e nunca exige digitar o sinal', async () => {
  const db = await bancoComSaldo3();
  const { rows } = await ajustar(db, { fisico: 7, esperado: 3 });
  assert.equal(rows[0].quantidade_sacos, 4);
  assert.equal(await saldoSacos(db), 7);
  assert.equal(await saldoKg(db), 175);
});

test('idempotência: reenviar o mesmo operacao_id devolve o mesmo ajuste, sem duplicar', async () => {
  const db = await bancoComSaldo3();
  const op = '00000000-0000-0000-0000-00000000aaaa';
  const a = (await ajustar(db, { fisico: 0, esperado: 3, operacao: op })).rows[0];
  const antes = await fotografia(db);
  // O retry chega com o MESMO saldo esperado (3), que já não é o real (0):
  // a idempotência precisa vencer a checagem de concorrência.
  const b = (await ajustar(db, { fisico: 0, esperado: 3, operacao: op })).rows[0];
  assert.equal(b.id, a.id);
  assert.deepEqual(await fotografia(db), antes);
});

test('operacao_id de outra movimentação é recusado (nunca devolve linha alheia)', async () => {
  const db = await bancoComSaldo3();
  const abertura = await valor(db, "select operacao_id from public.sacos_fechados_movimentacoes where tipo = 'abertura'");
  await assert.rejects(ajustar(db, { fisico: 0, esperado: 3, operacao: abertura }), /operacao_id ja utilizado por outra movimentacao/);
});

test('concorrência: saldo mudou desde a tela -> recusa sem gravar nada', async () => {
  const db = await bancoComSaldo3();
  // Tela carregou com saldo 3; outra pessoa abriu 1 saco antes da confirmação.
  await db.query('select public.registrar_abertura_saco($1, 1, gen_random_uuid(), null)', [CONFIG]);
  const antes = await fotografia(db);
  await assert.rejects(ajustar(db, { fisico: 0, esperado: 3 }), /o saldo mudou desde que a tela foi carregada \(esperado: 3 sacos, atual: 2 sacos\)/);
  assert.deepEqual(await fotografia(db), antes);
  assert.equal(await saldoSacos(db), 2);
});

test('validações: ajuste zero, físico negativo/nulo, motivo vazio/longo, esperado nulo', async () => {
  const db = await bancoComSaldo3();
  const antes = await fotografia(db);
  await assert.rejects(ajustar(db, { fisico: 3, esperado: 3 }), /nenhum ajuste necessario/);
  await assert.rejects(ajustar(db, { fisico: -1, esperado: 3 }), /estoque fisico deve ser um inteiro maior ou igual a zero/);
  await assert.rejects(ajustar(db, { fisico: null, esperado: 3 }), /estoque fisico deve ser um inteiro maior ou igual a zero/);
  await assert.rejects(ajustar(db, { fisico: 0, esperado: null }), /saldo esperado e obrigatorio/);
  await assert.rejects(ajustar(db, { fisico: 0, esperado: 3, motivo: '   ' }), /registrar_ajuste_sacos: motivo e obrigatorio/);
  await assert.rejects(ajustar(db, { fisico: 0, esperado: 3, motivo: null }), /registrar_ajuste_sacos: motivo e obrigatorio/);
  await assert.rejects(ajustar(db, { fisico: 0, esperado: 3, motivo: 'x'.repeat(501) }), /motivo excede 500 caracteres/);
  await assert.rejects(
    db.query('select public.registrar_ajuste_sacos($1, 0, 3, $2, null, null)', [CONFIG, 'm']),
    /operacao_id e obrigatorio/,
  );
  assert.deepEqual(await fotografia(db), antes);
});

test('configuração inativa, inexistente ou sem controle de sacos é recusada', async () => {
  const db = await bancoComSaldo3();
  await assert.rejects(ajustar(db, { fisico: 0, esperado: 0, config: CONFIG_INATIVA }), /esta inativa/);
  await assert.rejects(ajustar(db, { fisico: 0, esperado: 0, config: '00000000-0000-0000-0000-0000000000ff' }), /nao encontrada/);
  await db.query('update public.produto_fornecedores set controla_sacos_fechados = false, peso_por_saco_kg = null where id = $1', [CONFIG_INATIVA]);
  await db.query('update public.produto_fornecedores set ativo = true where id = $1', [CONFIG_INATIVA]);
  await assert.rejects(ajustar(db, { fisico: 1, esperado: 0, config: CONFIG_INATIVA }), /nao esta marcada para controle de sacos fechados/);
});

test('permissão: só proprietario_admin no banco; override individual concede/nega; sem sessão recusa', async () => {
  const db = await bancoComSaldo3();
  const perfis = await db.query("select perfil from public.perfil_permissoes where permissao = 'producao_sacos.ajustar' order by perfil");
  assert.deepEqual(perfis.rows, [{ perfil: 'proprietario_admin' }]);
  assert.equal(await valor(db, "select count(*)::int from public.permissoes where codigo = 'producao_sacos.ajustar' and modulo = 'producao_sacos' and acao = 'ajustar'"), 1);

  for (const uid of [OPERACIONAL, GESTAO]) {
    await como(db, uid);
    await assert.rejects(ajustar(db, { fisico: 0, esperado: 3 }), (e) => e.code === '42501' && /producao_sacos\.ajustar/.test(e.message));
  }

  await como(db, '');
  await assert.rejects(ajustar(db, { fisico: 0, esperado: 3 }), /requer sessao autenticada/);

  await db.query("insert into public.usuario_permissoes (usuario_id, permissao, efeito) values ($1, 'producao_sacos.ajustar', 'concede')", [OPERACIONAL]);
  await como(db, OPERACIONAL);
  const { rows } = await ajustar(db, { fisico: 2, esperado: 3 });
  assert.equal(rows[0].criado_por, OPERACIONAL);

  await db.query("insert into public.usuario_permissoes (usuario_id, permissao, efeito) values ($1, 'producao_sacos.ajustar', 'nega')", [ADMIN]);
  await como(db, ADMIN);
  await assert.rejects(ajustar(db, { fisico: 0, esperado: 2 }), (e) => e.code === '42501');
});

test('EXECUTE: só authenticated (anon/service_role/PUBLIC revogados)', async () => {
  const db = await banco();
  const r = await db.query(`select
    has_function_privilege('anon', 'public.registrar_ajuste_sacos(uuid,integer,integer,text,uuid,text)', 'execute') anon,
    has_function_privilege('service_role', 'public.registrar_ajuste_sacos(uuid,integer,integer,text,uuid,text)', 'execute') srv,
    has_function_privilege('authenticated', 'public.registrar_ajuste_sacos(uuid,integer,integer,text,uuid,text)', 'execute') auth,
    (select prosecdef from pg_proc where oid = 'public.registrar_ajuste_sacos(uuid,integer,integer,text,uuid,text)'::regprocedure) definer`);
  assert.deepEqual(r.rows[0], { anon: false, srv: false, auth: true, definer: true });
});

test('ajuste é imutável: editar/excluir RPC recusam; UPDATE direto recusado pela trigger', async () => {
  const db = await bancoComSaldo3();
  const mov = (await ajustar(db, { fisico: 0, esperado: 3 })).rows[0];
  const antes = await fotografia(db);

  await assert.rejects(db.query('select public.editar_movimentacao_saco($1, -1, null)', [mov.id]), /ajustes nao podem ser editados/);
  await assert.rejects(db.query("select public.excluir_movimentacao_saco($1, 'teste')", [mov.id]), /ajustes nao podem ser excluidos/);
  await assert.rejects(db.query("update public.sacos_fechados_movimentacoes set observacao = 'x' where id = $1", [mov.id]), /ajuste de estoque e imutavel/);
  await assert.rejects(db.query('update public.sacos_fechados_movimentacoes set quantidade_sacos = -1 where id = $1', [mov.id]), /ajuste de estoque e imutavel/);
  assert.deepEqual(await fotografia(db), antes);
  assert.equal(await saldoSacos(db), 0);
});

test('regressão: editar/excluir abertura e saldo inicial continuam sincronizando o estoque', async () => {
  const db = await bancoComSaldo3();
  const abertura = await valor(db, "select id from public.sacos_fechados_movimentacoes where tipo = 'abertura'");
  await db.query('select public.editar_movimentacao_saco($1, -1, null)', [abertura]);
  assert.equal(await saldoSacos(db), 4);
  assert.equal(await saldoKg(db), 100);
  await assert.rejects(db.query('select public.editar_movimentacao_saco($1, 1, null)', [abertura]), /precisa continuar negativa/);

  await db.query("select public.excluir_movimentacao_saco($1, 'teste')", [abertura]);
  assert.equal(await saldoSacos(db), 5);
  assert.equal(await saldoKg(db), 125);

  const inicial = await valor(db, "select id from public.sacos_fechados_movimentacoes where tipo = 'saldo_inicial'");
  await db.query('select public.editar_movimentacao_saco($1, 6, null)', [inicial]);
  assert.equal(await saldoKg(db), 150);

  // Ajuste depois de correções históricas: saldo_anterior é o do instante.
  const mov = (await ajustar(db, { fisico: 0, esperado: 6 })).rows[0];
  assert.equal(mov.saldo_anterior_sacos, 6);
  assert.equal(await saldoKg(db), 0);

  // Excluir o saldo inicial agora deixaria o saldo negativo (ajuste −6 fica).
  await assert.rejects(db.query("select public.excluir_movimentacao_saco($1, 'teste')", [inicial]), /deixaria o saldo de sacos fechados negativo/);
});

test('trigger: motivo/saldo_anterior_sacos imutáveis também nas demais linhas', async () => {
  const db = await bancoComSaldo3();
  const abertura = await valor(db, "select id from public.sacos_fechados_movimentacoes where tipo = 'abertura'");
  await assert.rejects(db.query("update public.sacos_fechados_movimentacoes set motivo = 'x' where id = $1", [abertura]), /motivo e imutavel/);
  await assert.rejects(db.query('update public.sacos_fechados_movimentacoes set saldo_anterior_sacos = 1 where id = $1', [abertura]), /saldo_anterior_sacos e imutavel/);
});

test('CHECK: ajuste exige motivo/saldo anterior/operacao e novo saldo >= 0; demais tipos nunca os têm', async () => {
  const db = await bancoComSaldo3();
  const inserir = (campos) => db.query(
    `insert into public.sacos_fechados_movimentacoes (produto_fornecedor_id, quantidade_sacos, peso_por_saco_kg_snapshot, tipo, origem, operacao_id, motivo, saldo_anterior_sacos)
     values ($1, $2, 25, $3, $3, $4, $5, $6)`,
    [CONFIG, campos.q, campos.tipo, campos.op ?? null, campos.motivo ?? null, campos.saldo ?? null],
  );
  const op = () => crypto.randomUUID();
  await assert.rejects(inserir({ tipo: 'ajuste_manual', q: -1, op: op(), saldo: 3 }), /ajuste_coerente_check/);
  await assert.rejects(inserir({ tipo: 'ajuste_manual', q: -1, op: op(), motivo: 'm' }), /ajuste_coerente_check/);
  await assert.rejects(inserir({ tipo: 'ajuste_manual', q: -1, motivo: 'm', saldo: 3 }), /ajuste_coerente_check/);
  await assert.rejects(inserir({ tipo: 'ajuste_manual', q: -4, op: op(), motivo: 'm', saldo: 3 }), /ajuste_coerente_check/);
  await assert.rejects(
    db.query(`insert into public.sacos_fechados_movimentacoes (produto_fornecedor_id, quantidade_sacos, peso_por_saco_kg_snapshot, tipo, origem, operacao_id, motivo)
      values ($1, -1, 25, 'abertura', 'abertura_manual', gen_random_uuid(), 'm')`, [CONFIG]),
    /ajuste_coerente_check/,
  );
});

test('histórico: ajuste aparece na mesma relação cronológica, legível pela RLS de visualizar', async () => {
  const db = await bancoComSaldo3();
  await ajustar(db, { fisico: 0, esperado: 3 });
  const tipos = await db.query('select tipo, quantidade_sacos, saldo_anterior_sacos from public.sacos_fechados_movimentacoes where produto_fornecedor_id = $1 order by criado_em, id', [CONFIG]);
  assert.deepEqual(tipos.rows.map((r) => r.tipo).sort(), ['abertura', 'ajuste_manual', 'saldo_inicial']);
  const listagem = await db.query('select saldo_sacos from public.listar_sacos_fechados_configuracoes() where produto_fornecedor_id = $1', [CONFIG]);
  assert.equal(Number(listagem.rows[0].saldo_sacos), 0);
});

test('guarda: reaplicar a 0074 aborta; corpo de função divergente aborta sem criar nada', async () => {
  const db = await banco();
  await assert.rejects(db.exec(lerMigration(M74)), /0074 abortada: objetos de ajuste de estoque ja existem/);

  const limpo = await novoBanco({ extras: ['0073_contas_pagar.sql'] });
  await limpo.exec(`create or replace function public.excluir_movimentacao_saco(p_movimentacao_id uuid, p_motivo text)
    returns public.sacos_fechados_movimentacoes language plpgsql security definer set search_path = '' as $$ begin return null; end; $$;`);
  await assert.rejects(limpo.exec(lerMigration(M74)), /0074 abortada: excluir_movimentacao_saco nao esta na versao da 0050/);
  await limpo.exec('rollback'); // a sessao fica abortada dentro do BEGIN da migration
  assert.equal(await valor(limpo, "select to_regprocedure('public.registrar_ajuste_sacos(uuid,integer,integer,text,uuid,text)') is null"), true);
  assert.equal(await valor(limpo, "select count(*)::int from pg_attribute where attrelid = 'public.sacos_fechados_movimentacoes'::regclass and attname = 'motivo'"), 0);
});

test('guarda: linha ajuste_manual pré-existente aborta a 0074', async () => {
  const db = await novoBanco({ extras: ['0073_contas_pagar.sql'] });
  await db.exec(CATALOGO);
  await db.query(`insert into public.sacos_fechados_movimentacoes (produto_fornecedor_id, quantidade_sacos, peso_por_saco_kg_snapshot, tipo, origem)
    values ($1, 1, 25, 'ajuste_manual', 'ajuste_manual')`, [CONFIG]);
  await assert.rejects(db.exec(lerMigration(M74)), /ja existem linhas de ajuste_manual/);
});

test('PRE (antes da 0074) e POS (depois): resultset único, tudo OK; EXECUTAR byte-idêntico', async (t) => {
  if (!existsSync(PRE) || !existsSync(POS) || !existsSync(EXECUTAR)) {
    t.skip('arquivos PRE/POS/EXECUTAR ausentes nesta cópia');
    return;
  }
  assert.ok(readFileSync(EXECUTAR).equals(readFileSync(join(RAIZ, 'supabase', 'migrations', M74))), 'EXECUTAR byte-idêntico');

  const db = await novoBanco({ extras: ['0073_contas_pagar.sql'] });
  await db.exec(CATALOGO);
  const pre = await db.query(readFileSync(PRE, 'utf8'));
  assert.ok(pre.rows.length > 5);
  assert.deepEqual(pre.rows.filter((r) => !['OK', 'INFO'].includes(r.resultado)), []);
  assert.ok(pre.rows.some((r) => r.checagem.startsWith('INFO pao frances: PAO FRANCES TESTE')));

  await db.exec(lerMigration(M74));
  const pos = await db.query(readFileSync(POS, 'utf8'));
  assert.ok(pos.rows.length > 5);
  assert.deepEqual(pos.rows.filter((r) => !['OK', 'INFO'].includes(r.resultado)), []);
});

test('diagnóstico do Pão Francês: roda read-only, mostra movimentos, auditoria de exclusão e resumo', async (t) => {
  const DIAG = join(RAIZ, '0074_diagnostico_pao_frances_LEITURA.sql');
  if (!existsSync(DIAG)) return t.skip('SQL de leitura da raiz ausente nesta copia (nao versionado)');
  const db = await bancoComSaldo3();
  const abertura = await valor(db, "select id from public.sacos_fechados_movimentacoes where tipo = 'abertura'");
  await db.query("select public.excluir_movimentacao_saco($1, 'baixa errada')", [abertura]);
  await ajustar(db, { fisico: 0, esperado: 5 });
  const antes = await fotografia(db);
  const { rows } = await db.query(readFileSync(DIAG, 'utf8'));
  assert.deepEqual(await fotografia(db), antes);
  assert.equal(rows[0].linha, 'RESUMO');
  assert.equal(rows.filter((r) => r.produto_fornecedor_id === CONFIG && r.linha === 'RESUMO')[0].sacos, '0');
  assert.ok(rows.some((r) => r.linha === 'AUDITORIA' && r.movimento === 'excluiu' && r.notas.includes('baixa errada')));
  assert.ok(rows.some((r) => r.linha === 'AUDITORIA' && r.movimento === 'ajustou_estoque saldo_sacos'));
  const movs = rows.filter((r) => r.linha === 'MOVIMENTO' && r.produto_fornecedor_id === CONFIG);
  assert.deepEqual(movs.map((r) => r.saldo_corrido_sacos), ['5', '0']);
  assert.ok(movs.every((r) => r.estoque_vinculado !== 'SEM ESPELHO'));
});

// Cenário REAL do diagnóstico de 13/10/2026 (Pão Francês): o mesmo
// produto_id tem duas configurações (GoldPao e Massas Daiana); o
// Boleado GoldPao é OUTRO produto_id. Peso 8 kg/saco em todas.
test('cenário real: zerar Pão Francês GoldPao (15 → 0) não toca Massas Daiana nem o Boleado', async () => {
  const { FORNECEDOR_B } = await import('./ambiente_pedidos.mjs');
  const FRANCES = '00000000-0000-0000-0000-0000000000b1';
  const BOLEADO = '00000000-0000-0000-0000-0000000000b2';
  const GOLD = '00000000-0000-0000-0000-0000000000d1';
  const DAIANA = '00000000-0000-0000-0000-0000000000d2';
  const GOLD_BOLEADO = '00000000-0000-0000-0000-0000000000d3';
  const db = await banco();
  await db.exec(`
    insert into public.produtos (id, nome, unidade_medida) values
      ('${FRANCES}', 'PÃO FRANCÊS', 'KG'), ('${BOLEADO}', 'PÃO FRANCÊS BOLEADO', 'KG');
    insert into public.produto_fornecedores (id, produto_id, fornecedor_id, unidade_comercial, ativo, controla_sacos_fechados, peso_por_saco_kg) values
      ('${GOLD}', '${FRANCES}', '${FORNECEDOR_A}', 'SC', true, true, 8),
      ('${DAIANA}', '${FRANCES}', '${FORNECEDOR_B}', 'SC', true, true, 8),
      ('${GOLD_BOLEADO}', '${BOLEADO}', '${FORNECEDOR_A}', 'SC', true, true, 8);
  `);
  const rpc = (sql, cfg, n) => db.query(sql, [cfg, n]);
  await rpc('select public.registrar_saldo_inicial_sacos($1, $2, gen_random_uuid(), null)', GOLD, 20);
  await rpc('select public.registrar_abertura_saco($1, $2, gen_random_uuid(), null)', GOLD, 5);
  await rpc('select public.registrar_saldo_inicial_sacos($1, $2, gen_random_uuid(), null)', DAIANA, 5);
  await rpc('select public.registrar_saldo_inicial_sacos($1, $2, gen_random_uuid(), null)', GOLD_BOLEADO, 16);

  const kgProduto = (p) => valor(db, 'select coalesce(sum(quantidade), 0)::float8 from public.estoque_movimentacoes where produto_id = $1', [p]);
  const kgConfig = (c) => valor(db, 'select coalesce(sum(quantidade_sacos * peso_por_saco_kg_snapshot), 0)::float8 from public.sacos_fechados_movimentacoes where produto_fornecedor_id = $1', [c]);

  // Estado equivalente ao diagnóstico real.
  assert.equal(await saldoSacos(db, GOLD), 15);
  assert.equal(await kgConfig(GOLD), 120);
  assert.equal(await saldoSacos(db, DAIANA), 5);
  assert.equal(await kgConfig(DAIANA), 40);
  assert.equal(await kgProduto(FRANCES), 160); // agregado por produto_id = 120 + 40
  assert.equal(await saldoSacos(db, GOLD_BOLEADO), 16);
  assert.equal(await kgProduto(BOLEADO), 128);

  // Concorrência em OUTRA configuração do mesmo produto não invalida o
  // ajuste da GoldPao (o saldo conferido é por configuração).
  await rpc('select public.registrar_abertura_saco($1, $2, gen_random_uuid(), null)', DAIANA, 1);
  await db.query("select public.editar_movimentacao_saco((select id from public.sacos_fechados_movimentacoes where produto_fornecedor_id = $1 and tipo = 'abertura'), -1, null)", [DAIANA]);
  await db.query("select public.excluir_movimentacao_saco((select id from public.sacos_fechados_movimentacoes where produto_fornecedor_id = $1 and tipo = 'abertura'), 'teste')", [DAIANA]);
  assert.equal(await saldoSacos(db, DAIANA), 5);

  const mov = (await ajustar(db, { fisico: 0, esperado: 15, config: GOLD, motivo: 'correcao de estoque' })).rows[0];
  assert.equal(mov.quantidade_sacos, -15);
  assert.equal(mov.saldo_anterior_sacos, 15);
  const espelho = await valor(db, "select quantidade::float8 from public.estoque_movimentacoes where origem = 'sacos_fechados_ajuste' and origem_id = $1", [mov.id]);
  assert.equal(espelho, -120);
  assert.equal(await valor(db, "select produto_id from public.estoque_movimentacoes where origem = 'sacos_fechados_ajuste' and origem_id = $1", [mov.id]), FRANCES);

  assert.equal(await saldoSacos(db, GOLD), 0);
  assert.equal(await saldoSacos(db, DAIANA), 5); // intacto
  assert.equal(await kgConfig(DAIANA), 40);
  assert.equal(await kgProduto(FRANCES), 40); // 160 → 40, NÃO zero
  assert.equal(await saldoSacos(db, GOLD_BOLEADO), 16); // outro produto_id, intacto
  assert.equal(await kgProduto(BOLEADO), 128);
  assert.equal(await valor(db, "select count(*)::int from public.sacos_fechados_movimentacoes where tipo = 'ajuste_manual'"), 1);

  // Saldo de OUTRA config (5) ou do agregado em sacos (5) nunca serve como
  // saldo conferido da GoldPao (agora 0): recusa sem gravar.
  await assert.rejects(ajustar(db, { fisico: 1, esperado: 5, config: GOLD }), /o saldo mudou desde que a tela foi carregada \(esperado: 5 sacos, atual: 0 sacos\)/);
  assert.equal(await kgProduto(FRANCES), 40);
});

test('reconciliação sacos x kg: cenário real OK antes/depois do ajuste; detecta kg órfão e divergente', async (t) => {
  const REC = join(RAIZ, '0074_reconciliacao_sacos_kg_LEITURA.sql');
  if (!existsSync(REC)) return t.skip('SQL de leitura da raiz ausente nesta copia (nao versionado)');
  const { FORNECEDOR_B } = await import('./ambiente_pedidos.mjs');
  const FRANCES = '00000000-0000-0000-0000-0000000000b1';
  const GOLD = '00000000-0000-0000-0000-0000000000d1';
  const DAIANA = '00000000-0000-0000-0000-0000000000d2';
  const db = await banco();
  await db.exec(`
    insert into public.produtos (id, nome, unidade_medida) values ('${FRANCES}', 'PÃO FRANCÊS', 'KG');
    insert into public.produto_fornecedores (id, produto_id, fornecedor_id, unidade_comercial, ativo, controla_sacos_fechados, peso_por_saco_kg) values
      ('${GOLD}', '${FRANCES}', '${FORNECEDOR_A}', 'SC', true, true, 8),
      ('${DAIANA}', '${FRANCES}', '${FORNECEDOR_B}', 'SC', true, true, 8);
  `);
  await db.query('select public.registrar_saldo_inicial_sacos($1, 20, gen_random_uuid(), null)', [GOLD]);
  await db.query('select public.registrar_abertura_saco($1, 5, gen_random_uuid(), null)', [GOLD]);
  await db.query('select public.registrar_saldo_inicial_sacos($1, 5, gen_random_uuid(), null)', [DAIANA]);

  const rodar = async () => (await db.query(readFileSync(REC, 'utf8'))).rows;
  const falhas = (rows) => rows.filter((r) => r.resultado === 'FALHA').map((r) => r.checagem);
  const linha = (rows, prefixo) => rows.find((r) => r.checagem.startsWith(prefixo));

  let rows = await rodar();
  assert.deepEqual(falhas(rows), []);
  assert.match(linha(rows, 'PAO FRANCES config: PÃO FRANCÊS | MOINHO A').detalhe, /sacos=15; kg_pelos_sacos\(snapshot\)=120\.000; kg_tela\(saldo x peso atual\)=120\.000; kg_no_estoque_vinculado_a_esta_config=120\.000/);
  assert.match(linha(rows, 'PAO FRANCES config: PÃO FRANCÊS | MERCADO B').detalhe, /sacos=5; .*kg_no_estoque_vinculado_a_esta_config=40\.000/);
  assert.match(linha(rows, 'PAO FRANCES produto').detalhe, /kg_total_estoque_movimentacoes=160\.000; soma_das_configs=MOINHO A 120\.000 \+ MERCADO B 40\.000; linhas_estoque_do_produto_sem_saco=0/);

  await ajustar(db, { fisico: 0, esperado: 15, config: GOLD });
  rows = await rodar();
  assert.deepEqual(falhas(rows), []);
  assert.match(linha(rows, 'PAO FRANCES config: PÃO FRANCÊS | MOINHO A').detalhe, /sacos=0; kg_pelos_sacos\(snapshot\)=0\.000; kg_tela\(saldo x peso atual\)=0\.000; kg_no_estoque_vinculado_a_esta_config=0\.000/);
  assert.match(linha(rows, 'PAO FRANCES produto').detalhe, /kg_total_estoque_movimentacoes=40\.000; soma_das_configs=MOINHO A 0\.000 \+ MERCADO B 40\.000/);

  // Divergência só seria possível por escrita manual fora das RPCs (SQL
  // Editor/superusuário): a reconciliação precisa apontá-la.
  await db.query("insert into public.estoque_movimentacoes (produto_id, quantidade, unidade, origem) values ($1, 120, 'KG', 'manual_fora_das_rpcs')", [FRANCES]);
  rows = await rodar();
  assert.ok(falhas(rows).some((c) => c.includes('SEM movimentacao de sacos')));
  assert.ok(falhas(rows).some((c) => c.startsWith('PAO FRANCES produto')));
  assert.equal(linha(rows, 'PAO FRANCES config: PÃO FRANCÊS | MOINHO A').resultado, 'OK'); // o órfão não é atribuível à GoldPao
});

test('investigação de peso x snapshot: identifica a configuração, movimentos afetados e diferença de kg (read-only)', async (t) => {
  const INV = join(RAIZ, '0074_investigacao_peso_snapshot_LEITURA.sql');
  if (!existsSync(INV)) return t.skip('SQL de leitura da raiz ausente nesta copia (nao versionado)');
  for (const extras of [['0073_contas_pagar.sql'], ['0073_contas_pagar.sql', M74]]) {
    const db = await novoBanco({ extras });
    await db.exec(CATALOGO);
    await db.query('select public.registrar_saldo_inicial_sacos($1, 5, gen_random_uuid(), null)', [CONFIG]); // 5 x 25
    await db.query('select public.registrar_abertura_saco($1, 2, gen_random_uuid(), null)', [CONFIG]); // -2 x 25
    // Pelo sistema é impossível trocar o peso com movimentações existentes:
    await assert.rejects(db.query('update public.produto_fornecedores set peso_por_saco_kg = 30 where id = $1', [CONFIG]), /peso_por_saco_kg nao pode ser alterado/);
    // Só com a trigger desligada (fora do sistema) -- é isso que a investigação precisa revelar.
    await db.exec('alter table public.produto_fornecedores disable trigger produto_fornecedores_protecao_trigger');
    await db.query('update public.produto_fornecedores set peso_por_saco_kg = 30 where id = $1', [CONFIG]);
    await db.exec('alter table public.produto_fornecedores enable trigger produto_fornecedores_protecao_trigger');
    await db.query('select public.registrar_abertura_saco($1, 1, gen_random_uuid(), null)', [CONFIG]); // -1 x 30

    const antes = await fotografia(db);
    const { rows, fields } = await db.query(readFileSync(INV, 'utf8'));
    assert.deepEqual(await fotografia(db), antes);
    assert.equal(fields.length, 14);

    const amb = rows.filter((r) => r.linha === 'AMBIENTE');
    assert.match(amb[0].detalhe, /tgenabled=O .*regra de peso imutavel=true/);
    assert.equal(amb[1].detalhe, '1');

    const cfg = rows.find((r) => r.linha === 'CONFIG');
    assert.equal(cfg.produto_fornecedor_id, CONFIG);
    assert.equal(cfg.sacos, '2');
    assert.equal(cfg.peso_atual, '30.000');
    assert.equal(cfg.peso_snapshot, '25.000, 30.000');
    assert.equal(Number(cfg.kg_estoque_registrado), 45); // 125 - 50 - 30
    assert.equal(Number(cfg.kg_com_peso_atual), 60); // tela: 2 x 30
    assert.equal(Number(cfg.diferenca_kg), 15);
    assert.match(cfg.detalhe, /kg_correto_ledger\(snapshots\)=45\.000; kg_tela_hoje\(saldo x peso atual\)=60\.000; diferenca_total_kg\(tela - ledger\)=15\.000; movimentos=3 \(com snapshot diferente=2\)/);

    const movs = rows.filter((r) => r.linha === 'MOVIMENTO');
    assert.equal(movs.length, 3);
    assert.deepEqual(movs.map((m) => m.detalhe.split(';')[0]), ['afetada=SIM', 'afetada=SIM', 'afetada=nao']);
    assert.deepEqual(movs.map((m) => Number(m.diferenca_kg)), [25, -10, 0]);
  }
});

test('reconciliação: mudança histórica de peso já zerada = ATENCAO (caso Pão de Hambúrguer); divergência atual = FALHA', async (t) => {
  const REC = join(RAIZ, '0074_reconciliacao_sacos_kg_LEITURA.sql');
  if (!existsSync(REC)) return t.skip('SQL de leitura da raiz ausente nesta copia (nao versionado)');
  const trocarPeso = async (db, peso) => {
    await db.exec('alter table public.produto_fornecedores disable trigger produto_fornecedores_protecao_trigger');
    await db.query('update public.produto_fornecedores set peso_por_saco_kg = $2 where id = $1', [CONFIG, peso]);
    await db.exec('alter table public.produto_fornecedores enable trigger produto_fornecedores_protecao_trigger');
  };
  const rodar = async (db) => (await db.query(readFileSync(REC, 'utf8'))).rows;
  const porInicio = (rows, p) => rows.find((r) => r.checagem.startsWith(p));
  const HIST = 'GLOBAL: configuracoes com mudanca historica de peso';
  const ATUAL = 'GLOBAL: configuracoes cujo kg exibido hoje';

  // Caso real: +1 x 8 (saldo inicial), -1 x 8 (abertura), peso corrigido para 5, +1 x 5.
  const db = await banco();
  await db.exec(CATALOGO);
  await db.query('update public.produto_fornecedores set peso_por_saco_kg = 8 where id = $1', [CONFIG]);
  await db.query('select public.registrar_saldo_inicial_sacos($1, 1, gen_random_uuid(), null)', [CONFIG]);
  await db.query('select public.registrar_abertura_saco($1, 1, gen_random_uuid(), null)', [CONFIG]);
  await trocarPeso(db, 5);
  await db.query('select public.registrar_ajuste_sacos($1, 1, 0, $2, gen_random_uuid(), null)', [CONFIG, 'entrada de 1 saco de 5 kg']);
  let rows = await rodar(db);
  assert.equal(porInicio(rows, HIST).resultado, 'ATENCAO');
  assert.match(porInicio(rows, HIST).detalhe, /^1 -- PAO FRANCES TESTE \| MOINHO A .*peso atual 5\.000, snapshots 5\.000\/8\.000/);
  assert.equal(porInicio(rows, ATUAL).resultado, 'OK');
  assert.deepEqual(rows.filter((r) => r.resultado === 'FALHA'), []);

  // Divergência ATUAL: saldo ainda em sacos do peso antigo -> tela != ledger.
  const db2 = await banco();
  await db2.exec(CATALOGO);
  await db2.query('select public.registrar_saldo_inicial_sacos($1, 2, gen_random_uuid(), null)', [CONFIG]); // 2 x 25
  await trocarPeso(db2, 30);
  rows = await rodar(db2);
  assert.equal(porInicio(rows, HIST).resultado, 'ATENCAO');
  assert.equal(porInicio(rows, ATUAL).resultado, 'FALHA');
  assert.match(porInicio(rows, ATUAL).detalhe, /tela 60\.000 kg x ledger 50\.000 kg/);
  // As demais verificações continuam OK: o espelho por movimento está íntegro.
  assert.equal(porInicio(rows, 'GLOBAL: linhas de estoque com kg diferente').resultado, 'OK');
  assert.equal(porInicio(rows, 'GLOBAL: produtos cujo kg').resultado, 'OK');
});
