// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/pedidos/__tests__/menorPreco.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JANELA_MENOR_PRECO_MESES,
  TAMANHO_BLOCO_IDS_HISTORICO,
  buscarMenorPrecoJanela,
  compararCandidatosMenorPreco,
  inicioJanelaMenorPreco,
  reduzirMenorPrecoJanela,
  unidadeDoMenorPreco,
} from '../menorPreco.js';
import { buscarHistoricoComprasEmLote, formatarPrecoBase } from '../historicoCompras.js';

const HOJE = '2026-10-23';
const INICIO = '2026-07-23';

// ------------------------------------------------------------
// Supabase FALSO (somente memória -- nada toca o banco real). Imita o que
// importa do PostgREST: in/gte/not is null, order asc/desc, range e o
// corte silencioso de max_rows (1000 linhas por resposta, sem erro).
// ------------------------------------------------------------
function criarSupabaseFalso(tabelas, { maxRows = 1000, falhar } = {}) {
  const chamadas = [];
  return {
    chamadas,
    from(tabela) {
      const estado = { campoIn: null, valoresIn: null, filtros: [], ordem: [] };
      const consulta = {
        select() {
          return consulta;
        },
        in(campo, valores) {
          estado.campoIn = campo;
          estado.valoresIn = valores;
          return consulta;
        },
        gte(campo, valor) {
          estado.filtros.push((l) => l[campo] >= valor);
          return consulta;
        },
        not(campo, operador, valor) {
          assert.equal(operador, 'is');
          assert.equal(valor, null);
          estado.filtros.push((l) => l[campo] != null);
          return consulta;
        },
        order(campo, { ascending = true } = {}) {
          estado.ordem.push({ campo, ascending });
          return consulta;
        },
        range(de, ate) {
          chamadas.push({ tabela, campoIn: estado.campoIn, tamanhoIn: estado.valoresIn?.length ?? 0, de, ate, ordem: estado.ordem.map((o) => `${o.campo}${o.ascending ? '' : ' desc'}`) });
          if (falhar && falhar({ tabela, de })) {
            return Promise.resolve({ data: null, error: { message: `falha simulada em ${tabela}` } });
          }
          const ids = new Set(estado.valoresIn || []);
          const linhas = (tabelas[tabela] || [])
            .filter((l) => !estado.campoIn || ids.has(l[estado.campoIn]))
            .filter((l) => estado.filtros.every((f) => f(l)))
            .sort((a, b) => {
              for (const { campo, ascending } of estado.ordem) {
                if (a[campo] < b[campo]) return ascending ? -1 : 1;
                if (a[campo] > b[campo]) return ascending ? 1 : -1;
              }
              return 0;
            });
          return Promise.resolve({ data: linhas.slice(de, Math.min(ate + 1, de + maxRows)), error: null });
        },
      };
      return consulta;
    },
  };
}

let seq = 0;
function compra(produto_id, preco, data, extra = {}) {
  seq += 1;
  return {
    id: `h${String(seq).padStart(6, '0')}`,
    produto_id,
    fornecedor_id: 'fA',
    preco_unitario_base: preco,
    data_compra: data,
    criado_em: `${data}T10:00:00.000000+00:00`,
    unidade_base_no_momento: 'kg',
    ...extra,
  };
}

const FORNECEDORES = [
  { id: 'fA', nome: 'legado A', nome_fantasia: 'Atacadão Centro', razao_social: 'A LTDA', ativo: true },
  { id: 'fB', nome: 'legado B', nome_fantasia: null, razao_social: 'Distribuidora B LTDA', ativo: false },
];

// ------------------------------------------------------------ regra pura

test('janela: 3 meses de calendário a partir de hoje', () => {
  assert.equal(JANELA_MENOR_PRECO_MESES, 3);
  assert.equal(inicioJanelaMenorPreco(HOJE), INICIO);
});

test('menor preço simples: vence o menor preco_unitario_base', () => {
  const mapa = reduzirMenorPrecoJanela([
    compra('p1', 15.98, '2026-10-01'),
    compra('p1', 14.5, '2026-09-01', { fornecedor_id: 'fB' }),
    compra('p1', 16, '2026-10-20'),
  ]);
  assert.equal(mapa.get('p1').linha.preco_unitario_base, 14.5);
  assert.equal(mapa.get('p1').linha.fornecedor_id, 'fB');
});

test('produto sem histórico não aparece no resultado', () => {
  const mapa = reduzirMenorPrecoJanela([compra('p1', 10, '2026-10-01')]);
  assert.equal(mapa.has('p2'), false);
  assert.equal(reduzirMenorPrecoJanela([]).size, 0);
  assert.equal(reduzirMenorPrecoJanela(null).size, 0);
});

test('preço-base nulo / compra não comparável não participa', () => {
  const mapa = reduzirMenorPrecoJanela([
    compra('p1', null, '2026-10-01'),
    compra('p1', 'abc', '2026-10-02'),
    compra('p1', 20, '2026-09-01'),
    compra('p2', null, '2026-10-01'),
  ]);
  assert.equal(mapa.get('p1').linha.preco_unitario_base, 20);
  // só compras sem fator: nenhuma comparável -> sem menor preço
  assert.equal(mapa.has('p2'), false);
});

test('preço vindo como texto numérico (numeric do PostgREST) compara como número', () => {
  const mapa = reduzirMenorPrecoJanela([compra('p1', '9.5', '2026-10-01'), compra('p1', '10', '2026-10-02')]);
  assert.equal(mapa.get('p1').linha.preco_unitario_base, '9.5');
});

test('empate de preço: vence a compra mais recente', () => {
  const antiga = compra('p1', 12, '2026-08-01', { fornecedor_id: 'fA' });
  const recente = compra('p1', 12, '2026-10-01', { fornecedor_id: 'fB' });
  assert.equal(reduzirMenorPrecoJanela([antiga, recente]).get('p1').linha, recente);
  assert.equal(reduzirMenorPrecoJanela([recente, antiga]).get('p1').linha, recente);
});

test('desempate determinístico: mesma data -> criado_em desc -> id desc, em qualquer ordem de entrada', () => {
  const a = { ...compra('p1', 12, '2026-10-01'), criado_em: '2026-10-01T10:00:00.000001+00:00', id: 'a' };
  const b = { ...compra('p1', 12, '2026-10-01'), criado_em: '2026-10-01T10:00:00.000002+00:00', id: 'b' };
  const c = { ...compra('p1', 12, '2026-10-01'), criado_em: '2026-10-01T10:00:00.000002+00:00', id: 'c' };
  const permutacoes = [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
  for (const linhas of permutacoes) {
    assert.equal(reduzirMenorPrecoJanela(linhas).get('p1').linha.id, 'c');
  }
  // criado_em diferente em milissegundos decide antes do id
  const d = { ...a, id: 'z', criado_em: '2026-10-01T09:00:00.000000+00:00' };
  const e = { ...a, id: 'y', criado_em: '2026-10-01T11:00:00.000000+00:00' };
  assert.equal(reduzirMenorPrecoJanela([d, e]).get('p1').linha.id, 'y');
  assert.ok(compararCandidatosMenorPreco(e, d) < 0);
});

test('janela exata: o dia inicial entra, o dia anterior não', () => {
  const mapa = reduzirMenorPrecoJanela(
    [compra('p1', 5, '2026-07-22'), compra('p1', 8, '2026-07-23'), compra('p2', 1, '2026-07-22')],
    { inicioJanela: INICIO }
  );
  assert.equal(mapa.get('p1').linha.preco_unitario_base, 8);
  assert.equal(mapa.has('p2'), false);
});

test('unidade-base histórica: snapshot da compra vencedora, sem conversão', () => {
  const snapshotIgual = unidadeDoMenorPreco({ unidadeBase: 'kg', unidadesNaJanela: ['kg'] }, 'KG ');
  assert.deepEqual(snapshotIgual, { unidade: 'kg', unidadeAtual: 'KG', divergente: false, unidadesMistas: false });

  // cadastro mudou de unidade depois da compra: mantém a da compra e avisa
  const divergente = unidadeDoMenorPreco({ unidadeBase: 'kg', unidadesNaJanela: ['kg'] }, 'un');
  assert.equal(divergente.unidade, 'kg');
  assert.equal(divergente.divergente, true);
  assert.equal(formatarPrecoBase(15.98, divergente.unidade).replace(/\s/g, ' '), 'R$ 15,98/kg');

  // registro anterior à 0026 (sem snapshot): única informação é o cadastro
  const legado = unidadeDoMenorPreco({ unidadeBase: null, unidadesNaJanela: [] }, 'un');
  assert.deepEqual(legado, { unidade: 'un', unidadeAtual: 'un', divergente: false, unidadesMistas: false });

  // sem nenhuma unidade conhecida: preço sem unidade, nada inventado
  assert.equal(unidadeDoMenorPreco({ unidadeBase: null }, '').unidade, null);
});

test('unidades diferentes dentro da janela são sinalizadas (vencedor não muda)', () => {
  const mapa = reduzirMenorPrecoJanela([
    compra('p1', 3, '2026-10-01', { unidade_base_no_momento: 'un' }),
    compra('p1', 30, '2026-08-01', { unidade_base_no_momento: 'kg' }),
    compra('p1', 31, '2026-08-02', { unidade_base_no_momento: ' KG' }),
  ]);
  const item = mapa.get('p1');
  assert.equal(item.linha.preco_unitario_base, 3);
  assert.deepEqual(item.unidadesNaJanela, ['un', 'kg']);
  assert.equal(unidadeDoMenorPreco({ unidadeBase: 'un', unidadesNaJanela: item.unidadesNaJanela }, 'un').unidadesMistas, true);
});

// ------------------------------------------------- leitura (Catálogo)

test('Catálogo: janela inteira SEM .in(), >1000 linhas lidas por completo, vencedor no último lote', async () => {
  const historico = [];
  for (let i = 0; i < 2500; i += 1) historico.push(compra(`p${i % 3}`, 50 + (i % 7), '2026-10-10'));
  // o mais barato de p1 é o MAIS ANTIGO -> chega só no último lote (ordem data desc)
  historico.push(compra('p1', 1.23, '2026-07-24', { fornecedor_id: 'fB', unidade_base_no_momento: 'un' }));
  // fora da janela, mais barato ainda: não pode vencer
  historico.push(compra('p1', 0.5, '2026-07-01'));

  const supabase = criarSupabaseFalso({ produtos_historico_compras: historico, fornecedores: FORNECEDORES });
  const { mapa, error } = await buscarMenorPrecoJanela(supabase, { hoje: HOJE });

  assert.equal(error, null);
  assert.deepEqual(mapa.get('p1'), {
    precoBase: 1.23,
    data: '2026-07-24',
    fornecedorId: 'fB',
    fornecedor: 'Distribuidora B LTDA',
    fornecedorAtivo: false,
    unidadeBase: 'un',
    unidadesNaJanela: ['kg', 'un'],
  });
  assert.equal(mapa.get('p0').precoBase, 50);

  const janela = supabase.chamadas.filter((c) => c.tabela === 'produtos_historico_compras');
  assert.equal(janela.length, 3, '2501 linhas na janela = 3 lotes de 1000');
  assert.ok(janela.every((c) => c.campoIn === null), 'nunca .in() na leitura do Catálogo');
  assert.deepEqual(janela[0].ordem, ['data_compra desc', 'criado_em desc', 'id desc']);
  // nomes: 1 consulta para os fornecedores vencedores (não 1 por produto)
  assert.equal(supabase.chamadas.filter((c) => c.tabela === 'fornecedores').length, 1);
});

test('Catálogo: nº de consultas não depende da quantidade de produtos (sem N+1)', async () => {
  const historico = [];
  for (let i = 0; i < 600; i += 1) historico.push(compra(`p${i}`, 10, '2026-10-01'));
  const supabase = criarSupabaseFalso({ produtos_historico_compras: historico, fornecedores: FORNECEDORES });
  const { mapa } = await buscarMenorPrecoJanela(supabase, { hoje: HOJE });
  assert.equal(mapa.size, 600);
  assert.equal(supabase.chamadas.length, 2); // 1 lote de janela + 1 de fornecedores
});

test('fornecedor inexistente/invisível: fornecedor null (quem apresenta decide), inativo identificado', async () => {
  const supabase = criarSupabaseFalso({
    produtos_historico_compras: [compra('p1', 9, '2026-10-01', { fornecedor_id: 'fX' }), compra('p2', 9, '2026-10-01', { fornecedor_id: 'fB' })],
    fornecedores: FORNECEDORES,
  });
  const { mapa } = await buscarMenorPrecoJanela(supabase, { hoje: HOJE });
  assert.equal(mapa.get('p1').fornecedor, null);
  assert.equal(mapa.get('p1').fornecedorAtivo, null);
  assert.equal(mapa.get('p2').fornecedor, 'Distribuidora B LTDA');
  assert.equal(mapa.get('p2').fornecedorAtivo, false);
});

test('erro de consulta vira `error` -- nunca um mapa vazio que pareceria "sem histórico"', async () => {
  const historico = [];
  for (let i = 0; i < 1500; i += 1) historico.push(compra('p1', 10, '2026-10-01'));
  const falhaNoSegundoLote = criarSupabaseFalso(
    { produtos_historico_compras: historico, fornecedores: FORNECEDORES },
    { falhar: ({ tabela, de }) => tabela === 'produtos_historico_compras' && de >= 1000 }
  );
  const r1 = await buscarMenorPrecoJanela(falhaNoSegundoLote, { hoje: HOJE });
  assert.equal(r1.mapa, null);
  assert.match(r1.error.message, /falha simulada/);

  const falhaFornecedores = criarSupabaseFalso(
    { produtos_historico_compras: historico, fornecedores: FORNECEDORES },
    { falhar: ({ tabela }) => tabela === 'fornecedores' }
  );
  const r2 = await buscarMenorPrecoJanela(falhaFornecedores, { hoje: HOJE });
  assert.equal(r2.mapa, null);
  assert.ok(r2.error);
});

// ------------------------------------- API de Solicitações (sem regressão)

function ambienteSolicitacoes(qtdProdutos = 3) {
  const historico = [
    compra('p0', 20, '2026-10-01', { fornecedor_id: 'fA' }),
    compra('p0', 18, '2026-09-01', { fornecedor_id: 'fB', unidade_base_no_momento: null }),
    compra('p0', 5, '2026-01-01'), // fora da janela
    compra('p1', null, '2026-10-05'), // só compra sem conversão
  ];
  const resumo = [
    { produto_id: 'p0', ultima_compra_data: '2026-10-01', ultima_compra_fornecedor_id: 'fA', ultima_compra_preco_base: 20 },
    { produto_id: 'p1', ultima_compra_data: '2026-10-05', ultima_compra_fornecedor_id: 'fB', ultima_compra_preco_base: null },
  ];
  const ids = Array.from({ length: qtdProdutos }, (_, i) => `p${i}`);
  return { ids, tabelas: { produtos_historico_compras: historico, produtos_resumo_compras: resumo, fornecedores: FORNECEDORES } };
}

test('Solicitações: mesma API e mesmo formato de resultado', async () => {
  const { ids, tabelas } = ambienteSolicitacoes(3);
  const supabase = criarSupabaseFalso(tabelas);
  const mapa = await buscarHistoricoComprasEmLote([...ids, 'p0', null], { supabase, hoje: HOJE });

  assert.deepEqual([...mapa.keys()], ['p0', 'p1', 'p2']);
  assert.deepEqual(mapa.get('p0'), {
    ultimaCompra: { data: '2026-10-01', fornecedor: 'Atacadão Centro', precoBase: 20 },
    menorPreco3Meses: { data: '2026-09-01', fornecedor: 'Distribuidora B LTDA', precoBase: 18, unidadeBase: null },
  });
  // comprado, mas nada comparável na janela
  assert.deepEqual(mapa.get('p1'), {
    ultimaCompra: { data: '2026-10-05', fornecedor: 'Distribuidora B LTDA', precoBase: null },
    menorPreco3Meses: null,
  });
  // nunca comprado
  assert.deepEqual(mapa.get('p2'), { ultimaCompra: null, menorPreco3Meses: null });
});

test('Solicitações: lista vazia não consulta nada', async () => {
  const supabase = criarSupabaseFalso({});
  const mapa = await buscarHistoricoComprasEmLote([], { supabase, hoje: HOJE });
  assert.equal(mapa.size, 0);
  assert.equal(supabase.chamadas.length, 0);
});

test('Solicitações: centenas de produtos -> ids em blocos (sem .in() gigante)', async () => {
  const { ids, tabelas } = ambienteSolicitacoes(450);
  const supabase = criarSupabaseFalso(tabelas);
  await buscarHistoricoComprasEmLote(ids, { supabase, hoje: HOJE });
  const comIn = supabase.chamadas.filter((c) => c.campoIn);
  assert.ok(comIn.every((c) => c.tamanhoIn <= TAMANHO_BLOCO_IDS_HISTORICO));
  assert.equal(supabase.chamadas.filter((c) => c.tabela === 'produtos_historico_compras').length, 3);
  assert.equal(supabase.chamadas.filter((c) => c.tabela === 'produtos_resumo_compras').length, 3);
});

test('Solicitações: >1000 linhas de um mesmo bloco são lidas por completo', async () => {
  const historico = [];
  for (let i = 0; i < 1200; i += 1) historico.push(compra('p0', 40, '2026-10-15'));
  historico.push(compra('p0', 2, '2026-07-30', { fornecedor_id: 'fB' }));
  const supabase = criarSupabaseFalso({ produtos_historico_compras: historico, produtos_resumo_compras: [], fornecedores: FORNECEDORES });
  const mapa = await buscarHistoricoComprasEmLote(['p0'], { supabase, hoje: HOJE });
  assert.equal(mapa.get('p0').menorPreco3Meses.precoBase, 2);
});

test('Solicitações: erro de consulta LANÇA (tela mostra "Não foi possível carregar"), nunca "sem histórico"', async () => {
  const { ids, tabelas } = ambienteSolicitacoes(2);
  for (const tabela of ['produtos_resumo_compras', 'produtos_historico_compras', 'fornecedores']) {
    const supabase = criarSupabaseFalso(tabelas, { falhar: (c) => c.tabela === tabela });
    const consoleErro = console.error;
    console.error = () => {};
    try {
      await assert.rejects(buscarHistoricoComprasEmLote(ids, { supabase, hoje: HOJE }), `falha em ${tabela} deve rejeitar`);
    } finally {
      console.error = consoleErro;
    }
  }
});
