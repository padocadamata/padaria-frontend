// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/funcionarios/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerEscalaPeriodo, dividirEmBlocos, TAMANHO_BLOCO_IDS, obterEstadoDia, resumirResultadoAplicacaoPadrao } from '../escala.js';
import { calcularAlturaGrade, ALTURA_MINIMA_GRADE } from '../escalaAltura.js';
import { diasDoMes } from '../../data/dataLocal.js';

// ------------------------------------------------------------
// Supabase FALSO (somente memória -- nada toca o banco real). Imita o que
// importa do PostgREST: filtros in/gte/lte, order, range e o corte
// silencioso de max_rows (1000 linhas por resposta, sem erro).
// ------------------------------------------------------------
function criarSupabaseFalso(tabelas, { maxRows = 1000, falhar } = {}) {
  const chamadas = [];
  return {
    chamadas,
    from(tabela) {
      const estado = { tabela, campoIn: null, valoresIn: null, filtros: [], ordem: [] };
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
        lte(campo, valor) {
          estado.filtros.push((l) => l[campo] <= valor);
          return consulta;
        },
        order(campo) {
          estado.ordem.push(campo);
          return consulta;
        },
        range(de, ate) {
          chamadas.push({ tabela, campoIn: estado.campoIn, tamanhoIn: estado.valoresIn?.length ?? 0, de, ate, ordem: [...estado.ordem] });
          if (falhar && falhar({ tabela, de, chamada: chamadas.length })) {
            return Promise.resolve({ data: null, error: { message: `falha simulada em ${tabela}` } });
          }
          const ids = new Set(estado.valoresIn || []);
          const linhas = (tabelas[tabela] || [])
            .filter((l) => !estado.campoIn || ids.has(l[estado.campoIn]))
            .filter((l) => estado.filtros.every((f) => f(l)))
            .sort((a, b) => {
              for (const campo of estado.ordem) {
                if (a[campo] < b[campo]) return -1;
                if (a[campo] > b[campo]) return 1;
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

const OUTUBRO = diasDoMes('2026-10-01');

// Mês "cheio": N funcionárias × 31 dias de trabalho × 2 períodos, e uma
// falta por funcionária no dia 10 -- passa de 1000 períodos com 17+.
function montarMesCheio(qtdFuncionarias) {
  const funcionarioIds = Array.from({ length: qtdFuncionarias }, (_, i) => `f${String(i).padStart(3, '0')}`);
  const dias = [];
  const periodos = [];
  const ocorrencias = [];
  let n = 0;
  for (const funcionario_id of funcionarioIds) {
    for (const data of OUTUBRO) {
      const id = `d${String(++n).padStart(5, '0')}`;
      dias.push({ id, funcionario_id, data, tipo_dia: 'trabalho', observacao: null });
      periodos.push({ id: `${id}-p1`, escala_dia_id: id, hora_inicio: '06:00:00', hora_fim: '10:00:00', natureza_financeira: 'normal' });
      periodos.push({ id: `${id}-p2`, escala_dia_id: id, hora_inicio: '12:00:00', hora_fim: '16:00:00', natureza_financeira: 'normal' });
      if (data === '2026-10-10') ocorrencias.push({ id: `${id}-o`, escala_dia_id: id, tipo: 'falta', observacao: null });
    }
  }
  // Fora da janela: nunca pode entrar no mapa.
  dias.push({ id: 'fora', funcionario_id: funcionarioIds[0], data: '2026-11-01', tipo_dia: 'folga', observacao: null });
  return { funcionarioIds, tabelas: { funcionarios_escala_dias: dias, funcionarios_escala_periodos: periodos, funcionarios_escala_ocorrencias: ocorrencias } };
}

test('fake: uma consulta única seria cortada em 1000 linhas sem erro (o risco real)', async () => {
  const { tabelas } = montarMesCheio(20);
  const supabase = criarSupabaseFalso(tabelas);
  const { data, error } = await supabase.from('funcionarios_escala_periodos').select('*').range(0, 99999);
  assert.equal(error, null);
  assert.equal(tabelas.funcionarios_escala_periodos.length, 1240);
  assert.equal(data.length, 1000);
});

test('leitura: mês com 1.240 períodos e 620 dias volta COMPLETO, no formato de sempre', async () => {
  const { funcionarioIds, tabelas } = montarMesCheio(20);
  const supabase = criarSupabaseFalso(tabelas);
  const { mapa, error } = await lerEscalaPeriodo(supabase, funcionarioIds, OUTUBRO[0], OUTUBRO[30]);
  assert.equal(error, null);
  assert.ok(mapa instanceof Map);
  assert.equal(mapa.size, 20);

  let dias = 0;
  let periodos = 0;
  let faltas = 0;
  for (const porData of mapa.values()) {
    for (const estado of porData.values()) {
      dias += 1;
      periodos += estado.periodos.length;
      if (estado.ocorrencia?.tipo === 'falta') faltas += 1;
    }
  }
  assert.equal(dias, 620);
  assert.equal(periodos, 1240);
  assert.equal(faltas, 20);

  // Formato EstadoDia preservado (id, tipo, períodos ordenados, ocorrência).
  const estado = obterEstadoDia(mapa, 'f019', '2026-10-31');
  assert.deepEqual(Object.keys(estado).sort(), ['id', 'ocorrencia', 'periodos', 'tipo']);
  assert.equal(estado.tipo, 'trabalho');
  assert.deepEqual(estado.periodos.map((p) => p.hora_inicio), ['06:00:00', '12:00:00']);
  assert.equal(obterEstadoDia(mapa, 'f000', '2026-10-10').ocorrencia.tipo, 'falta');
  assert.equal(obterEstadoDia(mapa, 'f000', '2026-11-01'), null); // fora da janela
});

test('leitura: ids em blocos de até 200 e ordem determinística em toda consulta', async () => {
  const { funcionarioIds, tabelas } = montarMesCheio(20);
  const supabase = criarSupabaseFalso(tabelas);
  await lerEscalaPeriodo(supabase, funcionarioIds, OUTUBRO[0], OUTUBRO[30]);
  assert.ok(supabase.chamadas.every((c) => c.tamanhoIn <= TAMANHO_BLOCO_IDS), 'nenhum .in() acima do bloco');
  const blocosDePeriodos = supabase.chamadas.filter((c) => c.tabela === 'funcionarios_escala_periodos' && c.de === 0);
  assert.equal(blocosDePeriodos.length, Math.ceil(620 / TAMANHO_BLOCO_IDS));
  for (const c of supabase.chamadas) {
    assert.deepEqual(c.ordem, c.tabela === 'funcionarios_escala_dias' ? ['data', 'id'] : ['id']);
  }
});

test('leitura: bloco com mais de 1000 linhas é lido em vários lotes (range), sem perder nada', async () => {
  // 40 funcionárias × 31 dias = 1240 dias -> um único bloco de funcionárias
  // (40 ids) devolve mais de 1000 dias e precisa de 2 lotes.
  const { funcionarioIds, tabelas } = montarMesCheio(40);
  const supabase = criarSupabaseFalso(tabelas);
  const { mapa, error } = await lerEscalaPeriodo(supabase, funcionarioIds, OUTUBRO[0], OUTUBRO[30]);
  assert.equal(error, null);
  const lotesDias = supabase.chamadas.filter((c) => c.tabela === 'funcionarios_escala_dias');
  assert.deepEqual(lotesDias.map((c) => c.de), [0, 1000]);
  let total = 0;
  for (const porData of mapa.values()) total += porData.size;
  assert.equal(total, 1240);
});

test('leitura: erro em QUALQUER bloco devolve erro e nenhum mapa parcial', async () => {
  const { funcionarioIds, tabelas } = montarMesCheio(20);
  for (const tabela of ['funcionarios_escala_dias', 'funcionarios_escala_periodos', 'funcionarios_escala_ocorrencias']) {
    let blocos = 0;
    const supabase = criarSupabaseFalso(tabelas, {
      // falha no 2º bloco da tabela (ou no 1º, se ela só tiver um)
      falhar: (c) => c.tabela === tabela && c.de === 0 && ++blocos === (tabela === 'funcionarios_escala_dias' ? 1 : 2),
    });
    const { mapa, error } = await lerEscalaPeriodo(supabase, funcionarioIds, OUTUBRO[0], OUTUBRO[30]);
    assert.equal(mapa, null, `sem mapa parcial (${tabela})`);
    assert.match(error.message, new RegExp(tabela));
  }
});

test('leitura: sem funcionárias não consulta nada; sem dias não busca períodos', async () => {
  const supabase = criarSupabaseFalso({ funcionarios_escala_dias: [] });
  assert.equal((await lerEscalaPeriodo(supabase, [], OUTUBRO[0], OUTUBRO[30])).mapa.size, 0);
  assert.equal(supabase.chamadas.length, 0);
  const { mapa } = await lerEscalaPeriodo(supabase, ['f1', 'f1', null], OUTUBRO[0], OUTUBRO[30]);
  assert.equal(mapa.size, 0);
  assert.deepEqual(supabase.chamadas.map((c) => [c.tabela, c.tamanhoIn]), [['funcionarios_escala_dias', 1]]);
});

test('blocos: divide sem perder nem repetir', () => {
  const itens = Array.from({ length: 450 }, (_, i) => i);
  const blocos = dividirEmBlocos(itens);
  assert.deepEqual(blocos.map((b) => b.length), [200, 200, 50]);
  assert.deepEqual(blocos.flat(), itens);
  assert.deepEqual(dividirEmBlocos([]), []);
});

// ------------------------------------------------------------
// Escala Padrão do mês: resumo do resultado da RPC
// ------------------------------------------------------------
test('escala padrão: resumo conta situações e preenchidos de hoje ou anteriores', () => {
  const linhas = [
    { funcionario_id: 'a', data: '2026-10-01', situacao: 'preenchido' },
    { funcionario_id: 'a', data: '2026-10-17', situacao: 'preenchido' }, // hoje conta
    { funcionario_id: 'a', data: '2026-10-18', situacao: 'preenchido' },
    { funcionario_id: 'b', data: '2026-10-02', situacao: 'ignorado' },
    { funcionario_id: 'b', data: '2026-10-03', situacao: 'sem_padrao' },
    { funcionario_id: 'c', data: '2026-10-03', situacao: 'funcionario_inativo' },
  ];
  assert.deepEqual(resumirResultadoAplicacaoPadrao(linhas, { hoje: '2026-10-17' }), {
    preenchido: 3,
    ignorado: 1,
    sem_padrao: 1,
    funcionario_inativo: 1,
    preenchidoAteHoje: 2,
  });
  // Sem `hoje` (Semanal): mesmo resumo de sempre, sem contagem retroativa.
  assert.equal(resumirResultadoAplicacaoPadrao(linhas).preenchidoAteHoje, 0);
  assert.equal(resumirResultadoAplicacaoPadrao(null).preenchido, 0);
});

// ------------------------------------------------------------
// Altura da grade (Cobertura; a Mensal cresce com a página)
// ------------------------------------------------------------
test('altura: ocupa a janela abaixo do topo da grade, com mínimo', () => {
  assert.equal(calcularAlturaGrade({ alturaJanela: 1080, topoGrade: 260, reservaInferior: 96 }), 724);
  assert.equal(calcularAlturaGrade({ alturaJanela: 768, topoGrade: 260, reservaInferior: 96 }), 412);
  assert.equal(calcularAlturaGrade({ alturaJanela: 600, topoGrade: 300, reservaInferior: 96 }), ALTURA_MINIMA_GRADE);
  assert.equal(calcularAlturaGrade({ alturaJanela: 1440.6, topoGrade: 250.2, reservaInferior: 96 }), 1094);
  assert.equal(calcularAlturaGrade({ alturaJanela: Number.NaN, topoGrade: 10 }), null);
});
