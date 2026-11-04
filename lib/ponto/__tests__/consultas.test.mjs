// Cartão-Ponto, Etapa 2 / Fase 0: consultas (somente leitura) com o
// cliente Supabase simulado (sem rede, sem chave real), permissões e
// navegação.
//
//   node --experimental-test-module-mocks \
//     --import ./lib/funcionarios/__tests__/resolverImports.mjs \
//     --test lib/ponto/__tests__/consultas.test.mjs
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chamadas = [];
let resposta = { data: null, error: null };
beforeEach(() => {
  chamadas.length = 0;
  resposta = { data: null, error: null };
});

// Query builder encadeável: registra cada passo; `await` devolve `resposta`.
function consulta(tabela) {
  const passos = [];
  const q = {
    then: (ok, falha) => Promise.resolve(resposta).then(ok, falha),
  };
  q.maybeSingle = () => {
    passos.push(['maybeSingle']);
    return q;
  };
  for (const metodo of ['select', 'eq', 'order', 'insert', 'update', 'upsert', 'delete']) {
    q[metodo] = (...args) => {
      passos.push([metodo, ...args]);
      return q;
    };
  }
  chamadas.push({ tabela, passos });
  return q;
}

mock.module(new URL('../../supabase/client.js', import.meta.url).href, {
  namedExports: {
    createClient: () => ({
      rpc: async (nome, args) => {
        chamadas.push({ rpc: nome, args });
        return resposta;
      },
      from: consulta,
    }),
  },
});

const {
  RPCS_ESCRITA, RPCS_LEITURA, abrirCartao, cancelarAtestado, carregarCartao, carregarEmpresa, competenciaDe, conferirCartao, fecharCartao,
  listarAtestados, listarCompetencia, listarEventosDoAtestado, listarEventosDoCartao, reabrirCartao, salvarAtestado, salvarDias,
} = await import('../consultas.js');
const { PERMISSOES, MODULOS, moduloVisivel } = await import('../../auth/permissoes.js');
const { MODULOS_MATRIZ, ACAO_LABEL, codigosDoGrupo } = await import('../../auth/matrizPermissoes.js');
const { subitensDoModulo, telasNavegaveis } = await import('../../nav/navegacao.js');

const PONTO = ['folha_ponto.visualizar', 'folha_ponto.lancar', 'folha_ponto.fechar', 'folha_ponto.reabrir'];

// --- Consultas ---------------------------------------------------------------

test('competência: AAAA-MM ou AAAA-MM-DD vira o dia 1; inválida é recusada antes de chamar o banco', () => {
  assert.equal(competenciaDe('2026-11'), '2026-11-01');
  assert.equal(competenciaDe('2026-11-20'), '2026-11-01');
  for (const ruim of ['', null, '2026-13', '2026-00', '11/2026', '2026-1']) assert.throws(() => competenciaDe(ruim), /competência inválida/);
});

test('listarCompetencia: só a RPC de resumo, competência no dia 1', async () => {
  resposta = { data: [{ funcionario_id: 'f1', nome: 'Sabrina', cartao_id: null, status: null }], error: null };
  const lista = await listarCompetencia('2026-11');
  assert.deepEqual(chamadas, [{ rpc: 'folha_ponto_competencia_resumo', args: { p_competencia: '2026-11-01' } }]);
  assert.equal(lista[0].cartao_id, null);
  resposta = { data: null, error: null };
  assert.deepEqual(await listarCompetencia('2026-11'), [], 'sem linhas = lista vazia');
});

test('carregarCartao: prévia (cartão null) só lê -- nenhuma RPC de escrita', async () => {
  resposta = { data: { competencia: '2026-11-01', dias: [], atestados: [], cartao: null }, error: null };
  const base = await carregarCartao('f1', '2026-11-03');
  assert.equal(base.cartao, null);
  assert.deepEqual(chamadas, [{ rpc: 'folha_ponto_base', args: { p_funcionario_id: 'f1', p_competencia: '2026-11-01' } }]);
  await assert.rejects(carregarCartao('', '2026-11'), /funcionária/);
  assert.equal(chamadas.length, 1, 'sem funcionária: nada chega ao banco');
});

test('erros do banco sobem como vieram (a tela traduz o código)', async () => {
  const erro = { message: 'folha_ponto: [competencia_invalida] informe a competencia.', code: 'P0001' };
  resposta = { data: null, error: erro };
  await assert.rejects(listarCompetencia('2026-11'), (e) => e === erro);
  resposta = { data: null, error: { message: 'requer a permissao folha_ponto.visualizar', code: '42501' } };
  await assert.rejects(carregarCartao('f1', '2026-11'), (e) => e.code === '42501');
});

test('atestados da funcionária: tabela por RLS, ativos por padrão, mais recentes primeiro', async () => {
  resposta = { data: [{ id: 'a1' }], error: null };
  assert.deepEqual(await listarAtestados('f1'), [{ id: 'a1' }]);
  const [{ tabela, passos }] = chamadas;
  assert.equal(tabela, 'folha_ponto_atestados');
  assert.deepEqual(passos.slice(1), [['eq', 'funcionario_id', 'f1'], ['order', 'data_inicio', { ascending: false }], ['eq', 'status', 'ativo']]);
  assert.doesNotMatch(passos[0][1], /\*/, 'colunas explícitas');
  chamadas.length = 0;
  await listarAtestados('f1', { incluirCancelados: true });
  assert.equal(chamadas[0].passos.some(([m, c]) => m === 'eq' && c === 'status'), false);
});

test('histórico: cartão sem `dados` (snapshot pesado); atestado com antes/depois', async () => {
  resposta = { data: [], error: null };
  await listarEventosDoCartao('c1');
  await listarEventosDoAtestado('a1');
  const [cartao, atestado] = chamadas;
  assert.equal(cartao.tabela, 'folha_ponto_eventos');
  assert.doesNotMatch(cartao.passos[0][1], /dados/);
  assert.deepEqual(cartao.passos[1], ['eq', 'cartao_id', 'c1']);
  assert.match(atestado.passos[0][1], /, dados$/);
  assert.deepEqual(atestado.passos[1], ['eq', 'atestado_id', 'a1']);
});

test('consultas.js: escrita SÓ pelas 7 RPCs da 0078 (nunca insert/update/delete direto) e nada de Pagamentos', () => {
  const fonte = readFileSync(new URL('../consultas.js', import.meta.url), 'utf8');
  const rpcs = [...fonte.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(rpcs)].sort(), [...RPCS_LEITURA, ...RPCS_ESCRITA].sort());
  assert.equal(RPCS_ESCRITA.length, 7);
  assert.doesNotMatch(fonte, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(fonte, /folha_pagamentos|folha_lancamentos|pagamentos/i);
});

test('escrita: argumentos exatos das RPCs, com a versão esperada', async () => {
  resposta = { data: 7, error: null };
  await abrirCartao('f1', '2026-10');
  await salvarDias('c1', 3, [{ data: '2026-10-05', situacao: null, motivo: null, observacao: null, periodos: [] }]);
  await salvarAtestado({ funcionarioId: 'f1', atestado: { tipo: 'atestado_medico', abrangencia: 'integral', data_inicio: '2026-10-05', data_fim: '2027-03-01', hora_inicio: null, hora_fim: null, descricao: null } });
  await salvarAtestado({ id: 'a1', versao: 2, funcionarioId: 'f1', atestado: { tipo: 'comparecimento', abrangencia: 'parcial', data_inicio: '2026-10-05', data_fim: '2026-10-05', hora_inicio: '08:00', hora_fim: '10:00', descricao: 'x' } });
  await cancelarAtestado('a1', 3, 'engano');
  await conferirCartao('c1', 4);
  await fecharCartao('c1', 5);
  await reabrirCartao('c1', 6, 'correção');
  assert.deepEqual(chamadas.map((c) => c.rpc), RPCS_ESCRITA.flatMap((n) => (n === 'folha_ponto_atestado_salvar' ? [n, n] : [n])));
  assert.deepEqual(chamadas[0].args, { p_funcionario_id: 'f1', p_competencia: '2026-10-01' });
  assert.deepEqual(chamadas[1].args.p_versao_esperada, 3);
  assert.deepEqual(chamadas[2].args, {
    p_atestado_id: null, p_versao_esperada: null, p_funcionario_id: 'f1', p_tipo: 'atestado_medico', p_abrangencia: 'integral',
    p_data_inicio: '2026-10-05', p_data_fim: '2027-03-01', p_hora_inicio: null, p_hora_fim: null, p_descricao: null,
  });
  assert.deepEqual([chamadas[3].args.p_atestado_id, chamadas[3].args.p_versao_esperada], ['a1', 2]);
  assert.deepEqual(chamadas[4].args, { p_atestado_id: 'a1', p_versao_esperada: 3, p_motivo: 'engano' });
  assert.deepEqual(chamadas[7].args, { p_cartao_id: 'c1', p_versao_esperada: 6, p_motivo: 'correção' });
  resposta = { data: null, error: { message: 'folha_ponto: [cartao_alterado] x' } };
  await assert.rejects(conferirCartao('c1', 1), (e) => /cartao_alterado/.test(e.message));
});

test('empresa: sem acesso (RLS da 0077) devolve null, nunca erro', async () => {
  resposta = { data: null, error: { code: '42501', message: 'sem acesso' } };
  assert.equal(await carregarEmpresa(), null);
  resposta = { data: { nome_fantasia: 'Padoca' }, error: null };
  assert.deepEqual(await carregarEmpresa(), { nome_fantasia: 'Padoca' });
  assert.equal(chamadas[0].tabela, 'folha_documentos_config');
});

// --- Permissões, matriz e navegação -----------------------------------------------

test('as 4 permissões existem com os códigos da 0078', () => {
  assert.deepEqual(
    [PERMISSOES.FOLHA_PONTO_VISUALIZAR, PERMISSOES.FOLHA_PONTO_LANCAR, PERMISSOES.FOLHA_PONTO_FECHAR, PERMISSOES.FOLHA_PONTO_REABRIR], PONTO);
});

test('matriz de acessos: grupo Cartão-Ponto na Folha, logo depois da Escala, com rótulos', () => {
  const indice = MODULOS_MATRIZ.findIndex((m) => m.chave === 'funcionarios_ponto');
  const modulo = MODULOS_MATRIZ[indice];
  assert.equal(modulo.grupo, 'funcionarios');
  assert.equal(modulo.label, 'Folha de Pagamento — Cartão-Ponto');
  assert.equal(MODULOS_MATRIZ[indice - 1].chave, 'funcionarios_escala');
  assert.deepEqual(modulo.itens.map((i) => i.codigo), PONTO);
  for (const i of modulo.itens) assert.ok(ACAO_LABEL[i.acao], i.acao);
  for (const c of PONTO) assert.ok(codigosDoGrupo('funcionarios').includes(c), c);
});

test('navegação: aba Cartão-Ponto depois da Escala, só com folha_ponto.visualizar', () => {
  const so = new Set(['folha_ponto.visualizar']);
  assert.deepEqual(subitensDoModulo('funcionarios', so).map((s) => [s.chave, s.rotulo, s.rota]), [['ponto', 'Cartão-Ponto', '/funcionarios/ponto']]);
  assert.equal(moduloVisivel(so, MODULOS.funcionarios), true, 'só o Cartão-Ponto já abre a Folha no menu');
  // lancar/fechar/reabrir sozinhos não abrem a aba (as ações exigem ver o cartão).
  assert.deepEqual(subitensDoModulo('funcionarios', new Set(['folha_ponto.lancar', 'folha_ponto.fechar'])), []);
  const chaves = subitensDoModulo('funcionarios', new Set(['escala.visualizar', 'folha_ponto.visualizar', 'folha_pagamentos.visualizar'])).map((s) => s.chave);
  assert.deepEqual(chaves, ['escala', 'ponto', 'pagamentos']);
  assert.ok(telasNavegaveis().some((t) => t.rota === '/funcionarios/ponto'), 'disponível para favoritos');
});

test('rotas (lista e cartão) protegidas por folha_ponto.visualizar, aba ativa "ponto", sem nada de Pagamentos', () => {
  for (const arquivo of ['index.js', '[funcionarioId].js']) {
    const pagina = readFileSync(new URL(`../../../pages/funcionarios/ponto/${arquivo}`, import.meta.url), 'utf8');
    assert.match(pagina, /<RequireAuth permissao=\{PERMISSOES\.FOLHA_PONTO_VISUALIZAR\}>/, arquivo);
    assert.match(pagina, /<FuncionariosSubNav ativo="ponto" \/>/, arquivo);
    assert.doesNotMatch(pagina, /from '[^']*(pagamentos|supabase)[^']*'|\.rpc\(/i, arquivo);
  }
});
