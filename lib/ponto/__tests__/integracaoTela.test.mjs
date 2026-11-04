// Cartão-Ponto, Etapa 2: INTEGRAÇÃO da camada da tela com o banco
// simulado. lib/ponto/consultas.js (o mesmo código que a tela usa) fala com
// a migration 0078 rodando no PGlite LOCAL através de um cliente Supabase
// falso (rpc / from) -- nenhuma rede, nenhuma credencial, nada de
// produção. Percorre o fluxo da tela: prévia sem gravar, abrir, lançar em
// lote (rascunhos), conflito de versão, pendência, atestado com prévia do
// impacto, conferir, fechar, exportar do snapshot, reabrir.
//
//   PGLITE_MODULE=/caminho/@electric-sql/pglite/dist/index.js \
//   node --experimental-test-module-mocks --import ./lib/funcionarios/__tests__/resolverImports.mjs \
//     --test lib/ponto/__tests__/integracaoTela.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

const modulo = process.env.PGLITE_MODULE;
const pular = modulo ? false : 'defina PGLITE_MODULE para rodar a integração com o SQL (PGlite local)';

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const LEITOR = '00000000-0000-0000-0000-0000000000c1';
const HOJE = '2026-11-20';

let db;
let usuarioAtual = ADMIN;

async function banco() {
  if (db) return db;
  const { PGlite } = await import(pathToFileURL(modulo).href);
  db = new PGlite();
  await db.exec(readFileSync(new URL('./sql/ambiente.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../../supabase/migrations/0078_folha_cartao_ponto.sql', import.meta.url), 'utf8'));
  await db.exec(`
    create or replace function public.folha_hoje() returns date language sql stable set search_path = '' as $$ select date '${HOJE}' $$;
    insert into auth.users values ('${ADMIN}'), ('${LEITOR}');
    insert into public.usuarios values ('${ADMIN}', 'Admin Tela', 'proprietario_admin', true), ('${LEITOR}', 'Leitor Tela', 'gestao', true);
    insert into public.usuario_permissoes values ('${LEITOR}', 'folha_ponto.visualizar', 'concede', null);
  `);
  return db;
}

async function comoUsuario(fn) {
  const d = await banco();
  await d.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${usuarioAtual}', false);`);
  try {
    return await fn(d);
  } finally {
    await d.exec('reset role;');
  }
}

const valorSql = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
const erroPg = (e) => ({ message: e.message, code: e.code });

// Cliente Supabase FALSO: rpc(nome, args) = select public.nome(p => $n);
// from(tabela) = select com RLS do usuário, devolvido como JSON (datas em
// texto, como o PostgREST).
function clienteFalso() {
  return {
    rpc: async (nome, args) => {
      const chaves = Object.keys(args);
      try {
        const r = await comoUsuario((d) => d.query(
          `select public.${nome}(${chaves.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, chaves.map((k) => valorSql(args[k]))));
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: erroPg(e) };
      }
    },
    from: (tabela) => {
      const q = { colunas: '*', filtros: [], ordem: [], um: false };
      const api = {
        select: (c) => { q.colunas = c; return api; },
        eq: (c, v) => { q.filtros.push([c, v]); return api; },
        order: (c, o = {}) => { q.ordem.push(`${c} ${o.ascending === false ? 'desc' : 'asc'}`); return api; },
        maybeSingle: () => { q.um = true; return api; },
        then: (ok, falha) => (async () => {
          const where = q.filtros.length ? `where ${q.filtros.map(([c], i) => `${c} = $${i + 1}`).join(' and ')}` : '';
          const ordem = q.ordem.length ? `order by ${q.ordem.join(', ')}` : '';
          try {
            const r = await comoUsuario((d) => d.query(
              `select to_jsonb(x) as j from (select ${q.colunas} from public.${tabela} ${where} ${ordem}) x`, q.filtros.map(([, v]) => v)));
            const linhas = r.rows.map((l) => l.j);
            return { data: q.um ? linhas[0] || null : linhas, error: null };
          } catch (e) {
            return { data: null, error: erroPg(e) };
          }
        })().then(ok, falha),
      };
      return api;
    },
  };
}

mock.module(new URL('../../supabase/client.js', import.meta.url).href, { namedExports: { createClient: clienteFalso } });

const consultas = await import('../consultas.js');
const {
  acoesDoCartao, baseComRascunhos, ehConflito, impactoDoAtestado, leituraDoCartao, mensagemErroPonto, montarLote, rascunhoDoDia,
  rascunhoIgualAoPrevisto, resumoDaBase, statusDoCartao,
} = await import('../apresentacao.js');
const { apurarCartao } = await import('../apuracao.js');
const { validarAtestado } = await import('../lancamento.js');
const { montarExportacaoCartao } = await import('../exportacao.js');
const { gerarPdfCartao } = await import('../pdf.js');

async function su(sql, params = []) {
  const d = await banco();
  return (await d.query(sql, params)).rows;
}

async function definirEscala(f, data, escala) {
  const [{ id }] = await su('insert into public.funcionarios_escala_dias (funcionario_id, data, tipo_dia) values ($1, $2, $3) returning id', [f, data, escala.tipo]);
  for (const p of escala.periodos || []) {
    await su('insert into public.funcionarios_escala_periodos (escala_dia_id, hora_inicio, hora_fim) values ($1, $2, $3)', [id, p.inicio, p.fim]);
  }
  if (escala.ocorrencia) await su('insert into public.funcionarios_escala_ocorrencias (escala_dia_id, tipo) values ($1, $2)', [id, escala.ocorrencia]);
}

const SEIS = { tipo: 'trabalho', periodos: [{ inicio: '06:00', fim: '12:00' }] };
const permissoesAdmin = { lancar: true, fechar: true, reabrir: true };

test('tela x banco: prévia, abrir, lote, conflito, pendência, atestado, conferir, fechar, exportar, reabrir', { skip: pular }, async () => {
  await banco();
  const [{ id: f }] = await su(`insert into public.funcionarios (nome, data_admissao, tipo_vinculo) values ('Sabrina Tela', '2025-01-10', 'funcionario') returning id`);
  for (let d = 1; d <= 31; d += 1) {
    const data = `2026-10-${String(d).padStart(2, '0')}`;
    if (d === 30) continue; // dia sem Escala
    const domingo = new Date(`${data}T12:00:00Z`).getUTCDay() === 0;
    await definirEscala(f, data, domingo ? { tipo: 'folga' } : d === 7 ? { ...SEIS, ocorrencia: 'falta' } : SEIS);
  }

  // 1. Quem só VISUALIZA: lista e prévia sem gravar nada; não abre cartão.
  usuarioAtual = LEITOR;
  const lista = await consultas.listarCompetencia('2026-10');
  assert.deepEqual(lista.map((l) => [l.nome, l.cartao_id]), [['Sabrina Tela', null]]);
  const previa = await consultas.carregarCartao(f, '2026-10');
  assert.equal(previa.cartao, null);
  assert.equal(statusDoCartao(previa.cartao), 'nao_aberto');
  assert.equal(resumoDaBase(previa).pendentes > 0, true, 'prévia já apura as pendências');
  assert.equal((await su('select count(*)::int n from public.folha_ponto_cartoes'))[0].n, 0, 'a prévia não cria registro');
  const semPermissao = await consultas.abrirCartao(f, '2026-10').catch((e) => e);
  assert.match(mensagemErroPonto(semPermissao), /permissão/);

  // 2. Abrir é ação EXPLÍCITA de quem lança.
  usuarioAtual = ADMIN;
  const aberto = await consultas.abrirCartao(f, '2026-10');
  assert.equal(aberto.criado, true);
  let base = await consultas.carregarCartao(f, '2026-10');
  assert.equal(statusDoCartao(base.cartao), 'em_preenchimento');

  // 3. Lote pela grade: "Igual ao previsto" em todos os dias de trabalho;
  //    05/10 com 06:30–12:30 (saldo zero, desvios de 30 min).
  const rascunhos = {};
  for (const d of base.dias) {
    if (d.escala?.tipo === 'trabalho' && !d.escala.ocorrencia) rascunhos[d.data] = rascunhoIgualAoPrevisto(d, rascunhoDoDia(d));
  }
  rascunhos['2026-10-05'] = { ...rascunhoDoDia(base.dias[4]), entrada: '06:30', saida: '12:30' };
  const previaLocal = apurarCartao(baseComRascunhos(base, rascunhos));
  const lote = montarLote(base, rascunhos);
  assert.deepEqual(lote.erros, {});
  const versao = await consultas.salvarDias(base.cartao.id, base.cartao.versao, lote.itens);
  assert.equal(versao, base.cartao.versao + 1);
  const conflito = await consultas.salvarDias(base.cartao.id, base.cartao.versao, lote.itens.slice(0, 1)).catch((e) => e);
  assert.equal(ehConflito(conflito), true, 'versão antiga = conflito com "Recarregar"');

  base = await consultas.carregarCartao(f, '2026-10');
  const salvo = apurarCartao(base);
  assert.deepEqual(salvo.totais, previaLocal.totais, 'o que a grade mostrou antes de salvar = o que ficou gravado');
  const d5 = salvo.dias[4];
  assert.deepEqual([d5.trabalhado_fora_previsto_min, d5.previsto_nao_coberto_min, d5.extra_min, d5.faltante_min], [30, 30, 0, 0]);

  // 4. Pendências: dia sem Escala e a Falta de 07/10 (sem pendência; conta como falta).
  assert.deepEqual(salvo.dias.filter((d) => d.pendencias.length).map((d) => d.data), ['2026-10-30']);
  assert.equal(acoesDoCartao({ status: 'em_preenchimento', apuracao: salvo, pode: permissoesAdmin }).conferir.habilitado, false);
  const ajuste = montarLote(base, { '2026-10-30': { ...rascunhoDoDia(base.dias[29]), situacao: 'folga', motivo: 'Folga combinada; Escala não lançada' } });
  await consultas.salvarDias(base.cartao.id, base.cartao.versao, ajuste.itens);

  // 5. Atestado (descrição nula) sobre a Falta de 07/10: prévia do impacto = resultado gravado.
  base = await consultas.carregarCartao(f, '2026-10');
  const { atestado } = validarAtestado({ tipo: 'atestado_medico', abrangencia: 'integral', data_inicio: '2026-10-07', data_fim: '2026-10-07', descricao: '  ' });
  assert.equal(atestado.descricao, null);
  const impacto = impactoDoAtestado(base, atestado);
  assert.deepEqual([impacto.totais.faltas_antes, impacto.totais.faltas_depois], [1, 0]);
  const registrado = await consultas.salvarAtestado({ funcionarioId: f, atestado });
  assert.equal(registrado.versao, 1);
  base = await consultas.carregarCartao(f, '2026-10');
  assert.equal(apurarCartao(base).totais.faltas_qtd, impacto.totais.faltas_depois);
  assert.equal(apurarCartao(base).totais.atestado_min, impacto.totais.atestado_depois);
  const atestados = await consultas.listarAtestados(f);
  assert.deepEqual(atestados.map((a) => [a.data_inicio, a.descricao, a.status, a.criado_por_nome]), [['2026-10-07', null, 'ativo', 'Admin Tela']]);

  // 6. Conferir e fechar (sempre com a versão esperada).
  const apur = apurarCartao(base);
  assert.equal(acoesDoCartao({ status: 'em_preenchimento', apuracao: apur, pode: permissoesAdmin }).conferir.habilitado, true);
  const v2 = await consultas.conferirCartao(base.cartao.id, base.cartao.versao);
  base = await consultas.carregarCartao(f, '2026-10');
  assert.equal(statusDoCartao(base.cartao), 'conferido');
  await consultas.fecharCartao(base.cartao.id, v2);
  base = await consultas.carregarCartao(f, '2026-10');
  assert.equal(statusDoCartao(base.cartao), 'fechado');
  assert.equal(leituraDoCartao(base).origem, 'snapshot');

  // 7. Exportar o fechado: só o snapshot, sem PRÉVIA, PDF gerado.
  const modelo = montarExportacaoCartao(base, { empresa: { nome_fantasia: 'Ignorada' } });
  assert.equal(modelo.previa, false);
  assert.equal(modelo.empresa.razao_social, 'Padoca Teste Ltda', 'empresa do snapshot');
  assert.equal(new TextDecoder('latin1').decode(new Uint8Array(gerarPdfCartao(modelo, { jsPDF, autoTable }))).slice(0, 5), '%PDF-');

  // 8. Fechado não aceita lançamento nem atestado; reabrir exige motivo e fica no histórico.
  const bloqueado = await consultas.salvarDias(base.cartao.id, base.cartao.versao, lote.itens.slice(0, 1)).catch((e) => e);
  assert.equal(mensagemErroPonto(bloqueado), 'Há cartão fechado nesse período. Reabra-o para alterar.');
  const atestadoFechado = await consultas.cancelarAtestado(registrado.atestado_id, 1, 'engano').catch((e) => e);
  assert.match(mensagemErroPonto(atestadoFechado), /fechado/);
  await consultas.reabrirCartao(base.cartao.id, base.cartao.versao, 'Contabilidade pediu correção');
  base = await consultas.carregarCartao(f, '2026-10');
  assert.equal(statusDoCartao(base.cartao), 'em_preenchimento');
  const eventos = await consultas.listarEventosDoCartao(base.cartao.id);
  assert.deepEqual(eventos.map((e) => e.acao), ['abrir', 'ajustar_situacao', 'conferir', 'fechar', 'reabrir']);
  assert.equal(eventos.at(-1).motivo, 'Contabilidade pediu correção');
  assert.equal('dados' in eventos[0], false, 'histórico do cartão sem o snapshot pesado');

  // 9. Reaberto: cancelar o atestado volta a ser possível; histórico do atestado.
  await consultas.cancelarAtestado(registrado.atestado_id, 1, 'Lançado por engano');
  const evAt = await consultas.listarEventosDoAtestado(registrado.atestado_id);
  assert.deepEqual(evAt.map((e) => e.acao), ['atestado_registrar', 'atestado_cancelar']);
  assert.equal((await consultas.listarAtestados(f)).length, 0);
  assert.equal((await consultas.listarAtestados(f, { incluirCancelados: true }))[0].status, 'cancelado');

  // 10. Quem só visualiza vê tudo, mas não grava.
  usuarioAtual = LEITOR;
  assert.equal((await consultas.listarEventosDoCartao(base.cartao.id)).length, 5);
  const leitorGrava = await consultas.reabrirCartao(base.cartao.id, base.cartao.versao, 'x').catch((e) => e);
  assert.equal(leitorGrava.code, '42501');
  usuarioAtual = ADMIN;
});

test('auditoria: usuário sem permissão não lê nada; consultas e prévias não gravam nada', { skip: pular }, async () => {
  await banco();
  const SEM = '00000000-0000-0000-0000-0000000000d1';
  await su(`insert into auth.users values ('${SEM}') on conflict do nothing`);
  await su(`insert into public.usuarios values ('${SEM}', 'Sem Permissão', 'gestao', true) on conflict do nothing`);
  const [{ id: f }] = await su(`insert into public.funcionarios (nome, data_admissao, tipo_vinculo) values ('Auditoria Leitura', '2025-01-10', 'funcionario') returning id`);
  await definirEscala(f, '2026-09-01', SEIS);
  const contagem = async () => (await su(`select
      (select count(*) from public.folha_ponto_cartoes)::int c, (select count(*) from public.folha_ponto_dias)::int d,
      (select count(*) from public.folha_ponto_periodos)::int p, (select count(*) from public.folha_ponto_atestados)::int a,
      (select count(*) from public.folha_ponto_eventos)::int e`))[0];
  const antes = await contagem();

  // Sem folha_ponto.visualizar: RPCs recusam com mensagem de permissão; tabelas voltam vazias (RLS).
  usuarioAtual = SEM;
  for (const chamada of [() => consultas.listarCompetencia('2026-09'), () => consultas.carregarCartao(f, '2026-09'), () => consultas.abrirCartao(f, '2026-09')]) {
    const erro = await chamada().catch((e) => e);
    assert.match(mensagemErroPonto(erro), /permissão/);
  }
  assert.deepEqual(await consultas.listarAtestados(f, { incluirCancelados: true }), []);

  // Leituras e prévias (lista, base, atestados, histórico) de quem pode ver: nada é gravado.
  usuarioAtual = ADMIN;
  await consultas.listarCompetencia('2026-09');
  await consultas.listarCompetencia('2026-10');
  const previa = await consultas.carregarCartao(f, '2026-09');
  assert.equal(previa.cartao, null);
  await consultas.listarAtestados(f, { incluirCancelados: true });
  montarExportacaoCartao(previa, { empresa: await consultas.carregarEmpresa() });
  assert.deepEqual(await contagem(), antes, 'nenhuma linha criada/alterada por consultas');
});

test('auditoria: atestado parcial no dia trabalhado, integral entre competências, conflito e cancelamento', { skip: pular }, async () => {
  await banco();
  usuarioAtual = ADMIN;
  const [{ id: f }] = await su(`insert into public.funcionarios (nome, data_admissao, tipo_vinculo) values ('Auditoria Atestado', '2025-01-10', 'funcionario') returning id`);
  for (const data of ['2026-10-15', '2026-10-30', '2026-11-02']) await definirEscala(f, data, SEIS);
  await consultas.abrirCartao(f, '2026-10');
  let base = await consultas.carregarCartao(f, '2026-10');
  const rascunhos = { '2026-10-15': { ...rascunhoDoDia(base.dias[14]), entrada: '06:00', saida: '10:00' } };
  await consultas.salvarDias(base.cartao.id, base.cartao.versao, montarLote(base, rascunhos).itens);

  // Parcial (10:00–12:00) convive com o trabalho: cobre o resto do previsto.
  base = await consultas.carregarCartao(f, '2026-10');
  const parcial = validarAtestado({ tipo: 'comparecimento', abrangencia: 'parcial', data_inicio: '2026-10-15', data_fim: '2026-10-15', hora_inicio: '10:00', hora_fim: '12:00', descricao: 'Consulta' }).atestado;
  const impacto = impactoDoAtestado(base, parcial);
  assert.deepEqual(impacto.diasComTrabalho, []);
  const p = await consultas.salvarAtestado({ funcionarioId: f, atestado: parcial });
  base = await consultas.carregarCartao(f, '2026-10');
  const d15 = apurarCartao(base).dias[14];
  assert.deepEqual([d15.situacao, d15.trabalhado_min, d15.atestado_min, d15.faltante_min], ['trabalho', 240, 120, 0]);
  assert.equal(apurarCartao(base).totais.atestado_min, impacto.totais.atestado_depois, 'prévia = gravado');

  // Conflito: alterar com versão antiga; depois cancelar com motivo.
  const conflito = await consultas.salvarAtestado({ id: p.atestado_id, versao: 99, funcionarioId: f, atestado: { ...parcial, hora_fim: '11:00' } }).catch((e) => e);
  assert.equal(ehConflito(conflito), true);
  await consultas.cancelarAtestado(p.atestado_id, p.versao, 'Lançado por engano');
  assert.equal(apurarCartao(await consultas.carregarCartao(f, '2026-10')).dias[14].atestado_min, 0);

  // Integral 30/10–02/11: um registro, efeito nas duas competências.
  const integral = validarAtestado({ tipo: 'atestado_medico', abrangencia: 'integral', data_inicio: '2026-10-30', data_fim: '2026-11-02', descricao: null }).atestado;
  await consultas.salvarAtestado({ funcionarioId: f, atestado: integral });
  const out = apurarCartao(await consultas.carregarCartao(f, '2026-10')).dias[29];
  const nov = apurarCartao(await consultas.carregarCartao(f, '2026-11')).dias[1];
  assert.deepEqual([out.situacao, out.atestado_min, nov.situacao, nov.atestado_min], ['atestado', 360, 'atestado', 360]);
  assert.equal((await consultas.listarAtestados(f)).length, 1, 'um registro só (o cancelado fica fora da lista padrão)');
});
