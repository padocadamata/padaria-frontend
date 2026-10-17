// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/funcionarios/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  montarMapaFeriados,
  nomeFeriado,
  rotuloFeriado,
  feriadosDoPeriodo,
  legendaFeriados,
  lerFeriadosPeriodo,
  MARCA_FERIADO,
} from '../escalaFeriados.js';
import { construirMapaEscala } from '../escala.js';
import { resolverCoberturaPeriodo } from '../escalaCobertura.js';

// Supabase FALSO (só memória -- nada toca o banco real).
function supabaseFalso({ linhas = [], erro = null } = {}) {
  const chamadas = [];
  return {
    chamadas,
    from(tabela) {
      const filtros = {};
      const q = {
        select() {
          return q;
        },
        gte(c, v) {
          filtros.gte = [c, v];
          return q;
        },
        lte(c, v) {
          filtros.lte = [c, v];
          return q;
        },
        order(c) {
          chamadas.push({ tabela, filtros: { ...filtros }, ordem: c });
          if (erro) return Promise.resolve({ data: null, error: erro });
          return Promise.resolve({ data: linhas.filter((l) => l.data >= filtros.gte[1] && l.data <= filtros.lte[1]), error: null });
        },
      };
      return q;
    },
  };
}

const LINHAS = [
  { data: '2026-10-12', nome: 'Nossa Senhora Aparecida' },
  { data: '2026-11-02', nome: 'Finados' },
  { data: '2026-11-15', nome: '  ' }, // nome vazio não some
];

test('mapa por data: data com feriado, data sem feriado, nome correto', () => {
  const mapa = montarMapaFeriados(LINHAS);
  assert.equal(nomeFeriado(mapa, '2026-10-12'), 'Nossa Senhora Aparecida');
  assert.equal(nomeFeriado(mapa, '2026-10-13'), null);
  assert.equal(nomeFeriado(mapa, '2026-11-15'), 'Feriado');
  assert.equal(nomeFeriado(null, '2026-10-12'), null);
  assert.equal(montarMapaFeriados(null).size, 0);
  assert.equal(rotuloFeriado('Finados'), 'Feriado: Finados');
  assert.equal(MARCA_FERIADO, 'F*');
});

test('período e legenda: só os feriados das datas exibidas, na ordem das datas', () => {
  const mapa = montarMapaFeriados(LINHAS);
  const semana = ['2026-10-12', '2026-10-13', '2026-10-14'];
  assert.deepEqual(feriadosDoPeriodo(mapa, semana), [{ data: '2026-10-12', nome: 'Nossa Senhora Aparecida' }]);
  assert.equal(legendaFeriados(mapa, semana), 'F* = feriado: 12/10 Nossa Senhora Aparecida');
  assert.equal(legendaFeriados(mapa, ['2026-10-20']), null);
  assert.equal(legendaFeriados(mapa, ['2026-11-02', '2026-10-12']), 'F* = feriado: 02/11 Finados; 12/10 Nossa Senhora Aparecida');
});

test('leitura: consulta feriados_nacionais só no período exibido', async () => {
  const supabase = supabaseFalso({ linhas: LINHAS });
  const { feriados, error } = await lerFeriadosPeriodo(supabase, '2026-10-01', '2026-10-31');
  assert.equal(error, null);
  assert.deepEqual([...feriados], [['2026-10-12', 'Nossa Senhora Aparecida']]);
  assert.deepEqual(supabase.chamadas, [{ tabela: 'feriados_nacionais', filtros: { gte: ['data', '2026-10-01'], lte: ['data', '2026-10-31'] }, ordem: 'data' }]);
});

test('leitura com falha: devolve ERRO (nunca "sem feriados" silencioso)', async () => {
  const { feriados, error } = await lerFeriadosPeriodo(supabaseFalso({ erro: { message: 'rede' } }), '2026-10-01', '2026-10-31');
  assert.equal(feriados, null);
  assert.equal(error.message, 'rede');
});

test('feriado não tem efeito automático sobre a escala nem sobre a cobertura', () => {
  // A cobertura é calculada só com mapaEscala + funcionárias: não existe
  // entrada de feriado no motor -- mesmo resultado com ou sem feriado na data.
  const f = { id: 'f1', nome: 'Ana Souza', cargo_id: 'c1', funcionarios_cargos: { nome: 'Atendente' } };
  const mapa = construirMapaEscala(
    [{ id: 'd1', funcionario_id: 'f1', data: '2026-10-12', tipo_dia: 'trabalho' }],
    new Map([['d1', [{ hora_inicio: '06:00:00', hora_fim: '12:00:00' }]]]),
    new Map()
  );
  const antes = resolverCoberturaPeriodo({ funcionarios: [f], mapaEscala: mapa, dias: ['2026-10-12'] });
  montarMapaFeriados(LINHAS); // feriado conhecido para a data
  const depois = resolverCoberturaPeriodo({ funcionarios: [f], mapaEscala: mapa, dias: ['2026-10-12'] });
  assert.deepEqual(depois.faixasPorDia.get('2026-10-12'), antes.faixasPorDia.get('2026-10-12'));
  assert.equal(mapa.get('f1').get('2026-10-12').tipo, 'trabalho'); // nenhuma folga automática
  assert.equal(resolverCoberturaPeriodo.length, 1); // assinatura sem parâmetro de feriado
});
