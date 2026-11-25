// BI Gerencial (frontend) -- regras puras do painel /bi.
//   node --test lib/bi/__tests__/bi.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  ATALHOS, ATALHOS_ATE_ULTIMO_COMPLETO, periodoDoAtalho, periodoReferencia, inicioDaSemana, mesmoDiaMesAnterior, diasNoFiltro, diasNoIntervalo, dataValida, LIMITES,
} from '../datas.js';
import { moeda, numero, quantidade, percentual, variacao, nomeDosDias, moedaEixo, SEM_DADOS, pontosPercentuais, intervalo, dataComDia, comSinal } from '../formatos.js';
import {
  FILTROS_BI, filtrosEfetivos, alternarDia, alternarSelecionado, blocosValidos, selecionadosValidos, MAX_SELECIONADOS,
  RANKING_TOPS, TAMANHOS_PAGINA, precisaSelecaoInicial, codigosSelecaoInicial,
} from '../filtros.js';
import { RPCS, chaveConsulta, criarClienteBi, mensagemDeErro } from '../consultas.js';
import {
  pontosSerie, juntarSeries, analisarHorarios, faixaDeHoras, curvasProdutoHorario, topPorHora, variacaoValida, situacaoComparacao, segmentosParticipacao, contagemCobertura, diasForaDasMedias, marcaDoDia,
  situacaoDoDia, situacaoDoGrupo, compararValores, escalaCalor,
} from '../modelos.js';
import { atribuirCores, PALETA_PRODUTOS, PALETA_SECUNDARIA, corCalor, coresParticipacao, CORES_MARCA } from '../cores.js';
import { montarExportacaoProdutos, mediaPorDia } from '../exportacao.js';
import { gerarXlsx } from '../../exportacao/xlsx.js';
import { sanearValores } from '../../filtros/persistenciaFiltros.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(aqui, '..', '..', '..');
const REF = { hoje: '2026-11-25', ultimoCompleto: '2026-11-24' }; // quarta-feira

// ---------------------------------------------------------------------------
// Datas e atalhos
// ---------------------------------------------------------------------------
test('atalhos: os 9 na ordem; "Últimos 7/30 dias" (rótulo revisto na homologação) terminam no último dia completo', () => {
  assert.deepEqual(ATALHOS.map((a) => a.rotulo), [
    'Hoje', 'Ontem', 'Últimos 7 dias', 'Últimos 30 dias', 'Semana atual', 'Semana anterior', 'Mês atual', 'Mês anterior', 'Personalizado',
  ]);
  assert.equal(FILTROS_BI.padrao.atalho, '7');
  assert.deepEqual([...ATALHOS_ATE_ULTIMO_COMPLETO].sort(), ['30', '7']);
  // 19/11 sem importação continua DENTRO dos 7 dias (sem ampliar o intervalo)
  const p = periodoDoAtalho('7', REF);
  assert.equal(diasNoIntervalo(p.de, p.ate), 7);
  assert.ok(p.de <= '2026-11-19' && '2026-11-19' <= p.ate);
});

test('periodoDoAtalho: semana de segunda a domingo; últimos N terminam no último dia completo', () => {
  assert.deepEqual(periodoDoAtalho('hoje', REF), { de: '2026-11-25', ate: '2026-11-25' });
  assert.deepEqual(periodoDoAtalho('ontem', REF), { de: '2026-11-24', ate: '2026-11-24' });
  assert.deepEqual(periodoDoAtalho('7', REF), { de: '2026-11-18', ate: '2026-11-24' });
  assert.deepEqual(periodoDoAtalho('30', REF), { de: '2026-10-26', ate: '2026-11-24' });
  assert.deepEqual(periodoDoAtalho('semana', REF), { de: '2026-11-23', ate: '2026-11-25' });
  assert.deepEqual(periodoDoAtalho('semana_anterior', REF), { de: '2026-11-16', ate: '2026-11-22' });
  assert.deepEqual(periodoDoAtalho('mes', REF), { de: '2026-11-01', ate: '2026-11-25' });
  assert.deepEqual(periodoDoAtalho('mes_anterior', REF), { de: '2026-10-01', ate: '2026-10-31' });
  assert.equal(periodoDoAtalho('personalizado', REF), null);
  // último completo atrasado (ex.: dia sem importação): os 7 dias terminam nele
  assert.deepEqual(periodoDoAtalho('7', { hoje: '2026-11-25', ultimoCompleto: '2026-11-18' }), { de: '2026-11-12', ate: '2026-11-18' });
  // sem nenhum dia completo: termina ontem
  assert.deepEqual(periodoDoAtalho('7', { hoje: '2026-11-25', ultimoCompleto: null }), { de: '2026-11-18', ate: '2026-11-24' });
  assert.equal(inicioDaSemana('2026-11-29'), '2026-11-23'); // domingo pertence à semana iniciada na segunda
  assert.equal(inicioDaSemana('2026-11-23'), '2026-11-23');
});

test('periodoReferencia: anterior equivalente, mês anterior (fim de mês), semana, livre e desativada', () => {
  assert.deepEqual(periodoReferencia({ de: '2026-11-18', ate: '2026-11-24' }, 'anterior', { atalho: '7' }), { de: '2026-11-11', ate: '2026-11-17' });
  assert.deepEqual(periodoReferencia({ de: '2026-11-01', ate: '2026-11-24' }, 'anterior', { atalho: 'mes' }), { de: '2026-10-01', ate: '2026-10-24' });
  assert.deepEqual(periodoReferencia({ de: '2026-11-23', ate: '2026-11-25' }, 'anterior', { atalho: 'semana' }), { de: '2026-11-16', ate: '2026-11-18' });
  assert.deepEqual(periodoReferencia({ de: '2027-03-01', ate: '2027-03-31' }, 'mes_anterior'), { de: '2027-02-01', ate: '2027-02-28' });
  assert.equal(mesmoDiaMesAnterior('2028-03-31'), '2028-02-29');
  assert.deepEqual(periodoReferencia({ de: '2026-11-18', ate: '2026-11-24' }, 'semana_anterior'), { de: '2026-11-11', ate: '2026-11-17' });
  assert.deepEqual(periodoReferencia({ de: '2026-11-18', ate: '2026-11-24' }, 'livre', { livre: { de: '2026-09-01', ate: '2026-09-30' } }), { de: '2026-09-01', ate: '2026-09-30' });
  assert.equal(periodoReferencia({ de: '2026-11-18', ate: '2026-11-24' }, 'livre', { livre: { de: '2026-09-30', ate: '2026-09-01' } }), null);
  assert.equal(periodoReferencia({ de: '2026-11-18', ate: '2026-11-24' }, 'nenhuma'), null);
  assert.equal(periodoReferencia({ de: '2026-11-24', ate: '2026-11-18' }, 'anterior'), null);
});

test('datas puras: validação, contagens e filtro de dias da semana sem depender do fuso', () => {
  assert.ok(dataValida('2026-02-28'));
  assert.ok(!dataValida('2026-02-30'));
  assert.ok(!dataValida('28/02/2026'));
  assert.equal(diasNoIntervalo('2026-10-01', '2026-10-31'), 31);
  assert.equal(diasNoIntervalo('2026-10-25', '2026-10-26'), 2); // fim do horário de verão em outros fusos não afeta
  assert.deepEqual(diasNoFiltro('2026-11-16', '2026-11-22', [0, 6]), ['2026-11-21', '2026-11-22']);
  assert.deepEqual(LIMITES, { geral: 1830, serieDia: 400, comparacao: 366 });
});

// ---------------------------------------------------------------------------
// Formatação: sem dados nunca vira zero; centavos sempre; sem unidade
// ---------------------------------------------------------------------------
test('formatos: R$ com centavos, "sem dados" para ausência, quantidade sem unidade', () => {
  const nb = (s) => s.replace(/ /g, ' ');
  assert.equal(nb(moeda(1234.5)), 'R$ 1.234,50');
  assert.equal(nb(moeda(0)), 'R$ 0,00'); // zero de verdade continua zero
  assert.equal(moeda(null), SEM_DADOS);
  assert.equal(moeda(undefined), SEM_DADOS);
  assert.equal(numero(null), SEM_DADOS);
  assert.equal(quantidade(1.25), '1,25');
  assert.equal(quantidade(3), '3');
  assert.ok(!/kg|un/i.test(quantidade(0.375)));
  assert.equal(percentual(0.1234), '12,3%');
  assert.equal(percentual(null), '—');
  assert.equal(pontosPercentuais(-0.0061), '-0,61 p.p.');
  assert.equal(moedaEixo(4200), 'R$ 4,2 mil');
  assert.equal(moedaEixo(1500000), 'R$ 1,5 mi');
  assert.deepEqual(variacao(0.0634), { texto: '▲ +6,3%', sentido: 'sobe' });
  assert.equal(variacao(-0.2).sentido, 'desce');
  assert.equal(variacao(null), null);
  assert.equal(nomeDosDias([0, 1, 2, 3, 4, 5, 6]), 'todos os dias');
  assert.equal(nomeDosDias([1, 2, 3, 4, 5]), 'dias úteis');
  assert.equal(nomeDosDias([6, 0]), 'fins de semana');
  assert.equal(nomeDosDias([0, 5]), 'sexta, domingo');
  assert.equal(intervalo('2026-11-01', '2026-11-01'), '01/11/2026');
});

// ---------------------------------------------------------------------------
// Filtros gerais e individuais
// ---------------------------------------------------------------------------
const GERAL = { atalho: '7', de: '2026-11-18', ate: '2026-11-24', dias: [0, 1, 2, 3, 4, 5, 6], agrupamento: 'dia', referencia: 'anterior', refDe: '', refAte: '' };

test('filtrosEfetivos: herda os gerais; filtro próprio substitui só o campo escolhido; campo que o bloco não usa é ignorado', () => {
  const h = filtrosEfetivos(GERAL, {}, 'evolucao');
  assert.equal(h.de, '2026-11-18');
  assert.deepEqual(h.proprios, []);
  const p = filtrosEfetivos(GERAL, { evolucao: { agrupamento: 'semana', dias: [5] } }, 'evolucao');
  assert.equal(p.agrupamento, 'semana');
  assert.deepEqual(p.dias, [5]);
  assert.equal(p.de, GERAL.de); // período continua herdado
  assert.deepEqual(p.proprios.sort(), ['agrupamento', 'dias']);
  // ranking não usa agrupamento: um valor salvo é ignorado
  const r = filtrosEfetivos(GERAL, { ranking: { agrupamento: 'mes' } }, 'ranking');
  assert.equal(r.agrupamento, 'dia');
  assert.deepEqual(r.proprios, []);
  // período próprio: a referência "equivalente" deixa de usar o atalho geral
  const pp = filtrosEfetivos(GERAL, { curva: { periodo: { de: '2026-10-01', ate: '2026-10-31' } } }, 'curva');
  assert.equal(pp.atalho, 'personalizado');
  // o geral nunca é alterado por um bloco
  assert.equal(GERAL.agrupamento, 'dia');
});

test('filtros: pelo menos um dia da semana; seleção de produtos limitada a 5 e na ordem de escolha', () => {
  assert.deepEqual(alternarDia([5], 5), [5]);
  assert.deepEqual(alternarDia([0, 5], 5), [0]);
  assert.deepEqual(alternarDia([5], 1), [1, 5]);
  let sel = [];
  for (const c of ['900', '120', '300', '410', '520', '610']) sel = alternarSelecionado(sel, c);
  assert.equal(sel.length, MAX_SELECIONADOS);
  assert.deepEqual(sel, ['900', '120', '300', '410', '520']);
  assert.deepEqual(alternarSelecionado(sel, '120'), ['900', '300', '410', '520']);
});

test('persistência: estado salvo inválido volta ao padrão campo a campo (nunca quebra o painel)', () => {
  const salvo = { atalho: 'xpto', dias: [9], agrupamento: 'semana', blocos: { evolucao: { agrupamento: 'ano' } }, selecionados: ['1', '1'], referencia: 'livre', refDe: '2026-02-30' };
  const v = sanearValores(salvo, FILTROS_BI.padrao, FILTROS_BI.validadores);
  assert.equal(v.atalho, '7');
  assert.deepEqual(v.dias, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(v.agrupamento, 'semana');
  assert.deepEqual(v.blocos, {});
  assert.deepEqual(v.selecionados, []);
  assert.equal(v.referencia, 'livre');
  assert.equal(v.refDe, '');
  assert.ok(blocosValidos({ tabela: { periodo: { de: '2026-11-01', ate: '2026-11-02' }, dias: [1] } }));
  assert.ok(!blocosValidos({ tabela: { periodo: { de: '2026-11-03', ate: '2026-11-02' } } }));
  assert.ok(!blocosValidos({ desconhecido: {} }));
  assert.ok(selecionadosValidos(['311', '341']));
  assert.ok(!selecionadosValidos(['a', 'b', 'c', 'd', 'e', 'f']));
});

// ---------------------------------------------------------------------------
// Consultas: contrato com as migrations, cache, fila e erros
// ---------------------------------------------------------------------------
function assinaturas() {
  const sql = readFileSync(path.join(RAIZ, 'supabase', 'migrations', '0083_bi_gerencial.sql'), 'utf8') + readFileSync(path.join(RAIZ, 'supabase', 'migrations', '0084_bi_complementar.sql'), 'utf8');
  const mapa = {};
  for (const m of sql.matchAll(/create function public\.(bi_[a-z0-9_]+)\(([^)]*)\)/g)) {
    mapa[m[1]] = [...m[2].matchAll(/(p_[a-z_]+)\s+[a-z]/g)].map((x) => x[1]);
  }
  return mapa;
}

test('contrato: cada consulta chama uma RPC existente com EXATAMENTE os parâmetros nomeados da assinatura (0083/0084)', () => {
  const sig = assinaturas();
  const exemplos = {
    status: {},
    calendario: { de: '2026-11-01', ate: '2026-11-24' },
    resumo: { de: '2026-11-01', ate: '2026-11-24', dias: [5] },
    serie: { de: '2026-11-01', ate: '2026-11-24', agrupamento: 'dia', dias: null },
    produtos: { de: '2026-11-01', ate: '2026-11-24' },
    produtoSerie: { codigos: ['900'], de: '2026-11-01', ate: '2026-11-24', agrupamento: 'semana' },
    horarios: { de: '2026-11-01', ate: '2026-11-24' },
    produtosHorario: { de: '2026-11-01', ate: '2026-11-24' },
    produtoHorarios: { codigos: ['900'], de: '2026-11-01', ate: '2026-11-24' },
    comparar: { a: { de: '2026-11-18', ate: '2026-11-24' }, b: { de: '2026-11-11', ate: '2026-11-17' } },
  };
  for (const [tipo, def] of Object.entries(RPCS)) {
    assert.ok(sig[def.nome], `${def.nome} não existe nas migrations`);
    assert.deepEqual(Object.keys(def.params(exemplos[tipo])).sort(), [...sig[def.nome]].sort(), `parâmetros de ${def.nome}`);
  }
  // nenhuma RPC v1 substituída é usada pelo painel novo (usa as _v2)
  const usados = Object.values(RPCS).map((d) => d.nome);
  for (const v1 of ['bi_resumo', 'bi_serie', 'bi_produtos', 'bi_produto_serie', 'bi_produtos_horario', 'bi_comparar']) assert.ok(!usados.includes(v1), v1);
});

test('consultas: filtro com os 7 dias vira null (mesma chave de cache); busca curta não é enviada', () => {
  assert.equal(RPCS.resumo.params({ de: 'a', ate: 'b', dias: [0, 1, 2, 3, 4, 5, 6] }).p_dias_semana, null);
  assert.deepEqual(RPCS.resumo.params({ de: 'a', ate: 'b', dias: [5, 1, 5] }).p_dias_semana, [1, 5]);
  assert.equal(chaveConsulta('resumo', { de: 'a', ate: 'b', dias: [0, 1, 2, 3, 4, 5, 6] }), chaveConsulta('resumo', { de: 'a', ate: 'b', dias: null }));
  assert.equal(RPCS.produtos.params({ de: 'a', ate: 'b', busca: 'p' }).p_busca, null);
  assert.equal(RPCS.produtos.params({ de: 'a', ate: 'b', busca: ' pao ' }).p_busca, 'pao');
});

function supabaseFalso({ atraso = 5, falhar = null } = {}) {
  const log = { chamadas: [], simultaneas: 0, maximo: 0 };
  return {
    log,
    rpc: async (nome, params) => {
      log.chamadas.push([nome, params]);
      log.simultaneas += 1;
      log.maximo = Math.max(log.maximo, log.simultaneas);
      await new Promise((r) => setTimeout(r, atraso));
      log.simultaneas -= 1;
      if (falhar && falhar(nome, params)) return { data: null, error: falhar(nome, params) };
      return { data: { nome, params }, error: null };
    },
  };
}

test('cliente: chamadas iguais são reaproveitadas (1 chamada real); no máximo 3 simultâneas', async () => {
  const sb = supabaseFalso();
  const c = criarClienteBi(sb);
  const args = { de: '2026-11-18', ate: '2026-11-24', dias: null };
  const [a, b] = await Promise.all([c.consultar('resumo', args), c.consultar('resumo', { ...args })]);
  assert.equal(a, b);
  assert.equal(sb.log.chamadas.length, 1);
  await c.consultar('resumo', args); // do cache
  assert.equal(sb.log.chamadas.length, 1);
  await Promise.all(Array.from({ length: 10 }, (_, i) => c.consultar('serie', { de: '2026-11-01', ate: `2026-11-${String(10 + i).padStart(2, '0')}`, agrupamento: 'dia' })));
  assert.equal(sb.log.chamadas.length, 11);
  assert.ok(sb.log.maximo <= 3, `máximo simultâneo ${sb.log.maximo}`);
});

test('cliente: erro não fica em cache (tentar de novo refaz a chamada) e vira mensagem simples', async () => {
  let falha = true;
  const sb = supabaseFalso({ falhar: () => (falha ? { code: '42501', message: 'Acesso negado' } : null) });
  const c = criarClienteBi(sb);
  await assert.rejects(c.consultar('status', {}), /proprietário\/administrador/);
  falha = false;
  await c.consultar('status', {});
  assert.equal(sb.log.chamadas.length, 2);
  assert.match(mensagemDeErro({ code: 'PGRST202', message: 'Could not find the function' }), /migration 0084/);
  assert.match(mensagemDeErro({ code: '22023', message: 'Periodo maior que o maximo permitido (366 dias).' }), /Filtro inválido/);
  assert.match(mensagemDeErro({ message: 'TypeError: Failed to fetch' }), /conectar/);
});

// ---------------------------------------------------------------------------
// Modelos: lacunas, marcas, horários, comparação
// ---------------------------------------------------------------------------
const linhaSerie = (inicio, classe, media, extra = {}) => ({ inicio, fim: inicio, rotulo: inicio, classe, media_diaria_bruto: media, ticket_media: media === null ? null : 21.5, dias_validos: media === null ? 0 : 1, dias_calendario: 1, ...extra });

test('série: dia parcial e sem importação viram LACUNA marcada (nunca zero); dia completo sem vendas é zero real', () => {
  const p = pontosSerie([
    linhaSerie('2026-11-18', 'completo', 4100),
    linhaSerie('2026-11-19', 'sem_importacao', null),
    linhaSerie('2026-11-20', 'completo_sem_vendas', 0),
    linhaSerie('2026-11-25', 'parcial', null),
    linhaSerie('2026-07-24', 'cobertura_nao_confirmada', null),
  ], 'bruto', 'dia');
  assert.deepEqual(p.map((x) => x.valor), [4100, null, 0, null, null]);
  // cada situação com marca própria (faixa e legenda distintas)
  assert.deepEqual(p.map((x) => x.marca), [null, 'lacuna', null, 'parcial', 'nc']);
  assert.equal(marcaDoDia('sem_operacao'), 'semop');
  assert.equal(marcaDoDia('com_pendencias'), 'parcial');
  assert.equal(marcaDoDia('completo_sem_vendas'), null);
  assert.equal(new Set(Object.values(CORES_MARCA)).size, 4);
  // semana/mês: sem marca por dia
  assert.equal(pontosSerie([linhaSerie('2026-11-16', 'parcial', 3000)], 'bruto', 'semana')[0].marca, null);
  const j = juntarSeries(p.slice(0, 2), [{ rotulo: 'x', valor: 1 }]);
  assert.deepEqual(j.map((x) => [x.a, x.b]), [[4100, 1], [null, null]]);
});

test('horários: médias = soma ÷ dias considerados; dia da semana fora do filtro = sem dados', () => {
  const rows = [
    { dia_semana: null, hora: 7, vendas: 30, bruto: 600, liquido: 590, dias_considerados: 3 },
    { dia_semana: null, hora: 8, vendas: 0, bruto: 0, liquido: 0, dias_considerados: 3 },
    { dia_semana: 5, hora: 7, vendas: 20, bruto: 400, liquido: 395, dias_considerados: 2 },
    { dia_semana: 5, hora: 8, vendas: 0, bruto: 0, liquido: 0, dias_considerados: 2 },
    { dia_semana: 6, hora: 7, vendas: 10, bruto: 200, liquido: 195, dias_considerados: 1 },
  ];
  const h = analisarHorarios(rows);
  assert.equal(h.curva[0].bruto, 200);
  assert.equal(h.curva[0].vendas, 10);
  assert.ok(Math.abs(h.curva[0].ticket - 590 / 30) < 1e-9);
  assert.equal(h.curva[1].ticket, null); // sem vendas: ticket indefinido, não zero
  const sex = h.diaSemana.find((d) => d.dow === 5);
  assert.equal(sex.media, 200);
  assert.equal(h.diaSemana.find((d) => d.dow === 1).media, null);
  assert.equal(h.diaSemana[0].dow, 1); // começa na segunda
  assert.equal(h.calor.find((d) => d.dow === 5).valores[7], 200);
  assert.equal(h.calor.find((d) => d.dow === 2).valores[7], null);
  assert.equal(h.diasConsiderados, 3);
  assert.deepEqual(faixaDeHoras(h.curva), { inicio: 7, fim: 7 });
});

test('produto por horário: curva por código (linhas sem dia da semana); top por hora ordenado', () => {
  const rows = [
    { codigo: '311', descricao: 'OVO', dia_semana: null, hora: 7, vendas: 3, bruto: 3, participacao_no_produto: 0.75, media_bruto_dia: 1, dias_considerados: 3 },
    { codigo: '341', descricao: 'OVO', dia_semana: null, hora: 7, vendas: 1, bruto: 1.1, participacao_no_produto: 1, media_bruto_dia: 0.37, dias_considerados: 3 },
    { codigo: '311', descricao: 'OVO', dia_semana: null, hora: null, vendas: 4, bruto: 4, participacao_no_produto: 1, dias_considerados: 3 },
    { codigo: '311', descricao: 'OVO', dia_semana: 5, hora: 7, vendas: 1, bruto: 1, participacao_no_produto: 1, dias_considerados: 1 },
  ];
  const c = curvasProdutoHorario(rows);
  assert.equal(c.size, 2); // descrições iguais, códigos separados
  assert.equal(c.get('311').horas.get(7).participacao, 0.75);
  assert.equal(c.get('311').total, 4);
  const t = topPorHora([
    { hora: 8, posicao: 2, codigo: 'b', descricao: 'B', media_bruto_dia: 1 },
    { hora: 8, posicao: 1, codigo: 'a', descricao: 'A', media_bruto_dia: 2 },
    { hora: 7, posicao: 1, codigo: 'c', descricao: 'C', media_bruto_dia: 3 },
  ]);
  assert.deepEqual(t.map((x) => [x.hora, x.itens.map((i) => i.codigo)]), [[7, ['c']], [8, ['a', 'b']]]);
});

test('comparação: variação só com comparavel=true; totais nulos no critério média; motivo exposto', () => {
  const ok = { criterio: 'pareado', geral: { comparavel: true, variacoes: { bruto: 0.1, ticket: -0.02 } } };
  assert.equal(variacaoValida(ok, 'bruto'), 0.1);
  const media = { criterio: 'media', geral: { comparavel: true, variacoes: { bruto: null, media_diaria_bruto: 0.05 } } };
  assert.equal(variacaoValida(media, 'bruto'), null);
  assert.equal(variacaoValida(media, 'media_diaria_bruto'), 0.05);
  const nao = { criterio: 'pareado', geral: { comparavel: false, motivo: 'cobertura_insuficiente', variacoes: null } };
  assert.equal(variacaoValida(nao, 'bruto'), null);
  assert.deepEqual(situacaoComparacao(nao), { estado: 'nao_comparavel', motivo: 'cobertura_insuficiente' });
  assert.deepEqual(situacaoComparacao(ok), { estado: 'ok', criterio: 'pareado', pareado: true });
});

test('participação: 5 maiores + demais sobre o total de todos os itens; cobertura e dias fora das médias', () => {
  const resp = { totais: { produtos_distintos: 8, bruto_total_periodo: 1000 }, produtos: [0.3, 0.2, 0.1, 0.1, 0.05, 0.05].map((p, i) => ({ codigo: String(i), descricao: `P${i}`, participacao: p })) };
  const s = segmentosParticipacao(resp, 5);
  assert.equal(s.top.length, 5);
  assert.equal(s.demais.quantidade, 3);
  assert.ok(Math.abs(s.demais.participacao - 0.25) < 1e-9);
  assert.deepEqual(contagemCobertura({ completo: 5, completo_sem_vendas: 1, parcial: 1, sem_importacao: 1, cobertura_nao_confirmada: 2 }), {
    completos: 6, semVendas: 1, parciais: 1, pendencias: 0, semImportacao: 1, naoConfirmados: 2, semOperacao: 0,
  });
  const cal = [
    { dia: '2026-11-19', classe_vendas: 'sem_importacao', entra_media_vendas: false },
    { dia: '2026-11-20', classe_vendas: 'completo', entra_media_vendas: true },
    { dia: '2026-11-25', classe_vendas: 'parcial', entra_media_vendas: false, hora_limite_vendas: '12:44:00' },
  ];
  assert.deepEqual(diasForaDasMedias(cal, null).map((d) => [d.dia, d.classe, d.horaLimite]), [['2026-11-19', 'sem_importacao', null], ['2026-11-25', 'parcial', '12:44']]);
  assert.deepEqual(diasForaDasMedias(cal, [3]).map((d) => d.dia), ['2026-11-25']); // 25/11 é quarta
});

// ---------------------------------------------------------------------------
// Ajustes da homologação visual
// ---------------------------------------------------------------------------
test('filtros: Top 5/10/20 (padrão 10) e 10/20/50/100 por página (padrão 20), validados', () => {
  assert.deepEqual(RANKING_TOPS, [5, 10, 20]);
  assert.deepEqual(TAMANHOS_PAGINA, [10, 20, 50, 100]);
  assert.equal(FILTROS_BI.padrao.rankingTop, 10);
  assert.equal(FILTROS_BI.padrao.porPagina, 20);
  assert.equal(FILTROS_BI.padrao.selecaoIniciada, false);
  const s = sanearValores({ rankingTop: 15, porPagina: 1000, selecaoIniciada: 'sim' }, FILTROS_BI.padrao, FILTROS_BI.validadores);
  assert.equal(s.rankingTop, 10);
  assert.equal(s.porPagina, 20);
  assert.equal(s.selecaoIniciada, false);
  const ok = sanearValores({ rankingTop: 20, porPagina: 100, selecaoIniciada: true }, FILTROS_BI.padrao, FILTROS_BI.validadores);
  assert.deepEqual([ok.rankingTop, ok.porPagina, ok.selecaoIniciada], [20, 100, true]);
});

test('seleção inicial: só sem seleção registrada; 3 maiores códigos G3 (311 e 341 separados); remover todos não reativa', () => {
  assert.equal(precisaSelecaoInicial({ selecaoIniciada: false, selecionados: [] }), true);
  assert.equal(precisaSelecaoInicial({ selecaoIniciada: true, selecionados: [] }), false); // usuário removeu todos
  assert.equal(precisaSelecaoInicial({ selecaoIniciada: false, selecionados: ['900'] }), false); // seleção salva antiga
  const prods = [
    { codigo: '311', descricao: 'OVO', bruto: 50 },
    { codigo: '341', descricao: 'OVO', bruto: 40 },
    { codigo: '311', descricao: 'OVO', bruto: 50 },
    { codigo: '900', descricao: 'PAO', bruto: 30 },
    { codigo: '120', descricao: 'X', bruto: 20 },
  ];
  assert.deepEqual(codigosSelecaoInicial(prods), ['311', '341', '900']);
  assert.deepEqual(codigosSelecaoInicial([{ codigo: '1', bruto: 0 }, { codigo: '2', bruto: null }]), []);
  assert.deepEqual(codigosSelecaoInicial(null), []);
});

test('tooltip: situação distingue completo, completo sem vendas, parcial, sem importação, não confirmada', () => {
  assert.deepEqual(situacaoDoDia('completo'), { texto: 'dia completo', valido: true });
  assert.match(situacaoDoDia('completo_sem_vendas').texto, /zero real/);
  assert.equal(situacaoDoDia('completo_sem_vendas').valido, true);
  assert.match(situacaoDoDia('parcial', '12:44:00').texto, /parcial \(dados até 12:44\)/);
  assert.match(situacaoDoDia('sem_importacao').texto, /lacuna, não é zero/);
  assert.match(situacaoDoDia('cobertura_nao_confirmada').texto, /não confirmada/);
  assert.match(situacaoDoDia('sem_conciliacao').texto, /conciliação/);
  const textos = ['completo', 'completo_sem_vendas', 'parcial', 'com_pendencias', 'sem_importacao', 'cobertura_nao_confirmada', 'sem_operacao', 'sem_conciliacao'].map((c) => situacaoDoDia(c).texto);
  assert.equal(new Set(textos).size, textos.length);
  assert.match(situacaoDoGrupo(0, 7).texto, /não é zero/);
  assert.match(situacaoDoGrupo(6, 7).texto, /6 de 7/);
  assert.equal(situacaoDoGrupo(7, 7).valido, true);
});

test('tooltip: diferença e variação só com os dois lados válidos; B = 0 sem variação percentual', () => {
  assert.deepEqual(compararValores(110, 100), { diferenca: 10, variacao: 0.1, motivo: null });
  assert.deepEqual(compararValores(null, 100), { diferenca: null, variacao: null, motivo: 'sem_a' });
  assert.deepEqual(compararValores(100, null), { diferenca: null, variacao: null, motivo: 'sem_b' });
  assert.deepEqual(compararValores(null, undefined), { diferenca: null, variacao: null, motivo: 'sem_dados' });
  assert.deepEqual(compararValores(50, 0), { diferenca: 50, variacao: null, motivo: 'base_zero' });
  assert.deepEqual(compararValores(0, 0), { diferenca: 0, variacao: null, motivo: 'base_zero' });
  assert.equal(dataComDia('2026-11-18'), 'qua, 18/11/2026');
  assert.equal(comSinal(-12.3, moeda).replace(/\s/g, ' '), '−R$ 12,30');
  assert.equal(comSinal(null, moeda), SEM_DADOS);
  // série: o ponto carrega classe/hora de A e B e o registrado do dia parcial
  const pa = pontosSerie([{ inicio: '2026-11-25', fim: '2026-11-25', rotulo: '25/11/2026', classe: 'parcial', hora_limite: '12:44:00', media_diaria_bruto: null, bruto: 1500.25, dias_validos: 0, dias_calendario: 1 }], 'bruto', 'dia');
  const pb = pontosSerie([{ inicio: '2026-11-18', fim: '2026-11-18', rotulo: '18/11/2026', classe: 'completo', media_diaria_bruto: 4100, bruto: 4100, dias_validos: 1, dias_calendario: 1 }], 'bruto', 'dia');
  const j = juntarSeries(pa, pb)[0];
  assert.deepEqual([j.a, j.b, j.registradoA, j.classe, j.classeB, j.horaA, j.inicioB], [null, 4100, 1500.25, 'parcial', 'completo', '12:44:00', '2026-11-18']);
  assert.equal(compararValores(j.a, j.b).diferenca, null); // parcial nunca vira variação
});

test('mapa de calor: faturamento e vendas por dia completo do dia da semana; ticket = líquido ÷ vendas (razão dos totais)', () => {
  const rows = [
    { dia_semana: null, hora: 7, vendas: 6, bruto: 120, liquido: 118, dias_considerados: 3 },
    { dia_semana: 2, hora: 7, vendas: 4, bruto: 100, liquido: 90, dias_considerados: 2 },
    { dia_semana: 2, hora: 8, vendas: 0, bruto: 0, liquido: 0, dias_considerados: 2 },
    { dia_semana: 5, hora: 7, vendas: 2, bruto: 20, liquido: 28, dias_considerados: 1 },
  ];
  const h = analisarHorarios(rows);
  const ter = h.calor.find((d) => d.dow === 2);
  assert.equal(ter.dias, 2);
  assert.equal(ter.bruto[7], 50);
  assert.equal(ter.vendas[7], 2);
  assert.equal(ter.ticket[7], 90 / 4); // nunca média de tickets individuais
  assert.equal(ter.bruto[8], 0); // dia completo sem vendas na hora: zero real
  assert.equal(ter.ticket[8], null); // sem vendas: ticket não se aplica (não zero)
  const seg = h.calor.find((d) => d.dow === 1);
  assert.deepEqual([seg.dias, seg.bruto[7], seg.vendas[7], seg.ticket[7]], [0, null, null, null]); // sem dados
  const e = escalaCalor(h.calor, 'ticket', [7, 8]);
  assert.deepEqual(e, { minimo: 14, maximo: 22.5, vazio: false });
  assert.deepEqual(escalaCalor(h.calor, 'bruto', [7, 8]), { minimo: 0, maximo: 50, vazio: false });
  assert.equal(escalaCalor([], 'bruto', [7]).vazio, true);
  assert.equal(corCalor(14, 22.5, 14), corCalor(0, 10)); // ponta clara da escala
  assert.equal(corCalor(22.5, 22.5, 14), corCalor(10, 10)); // ponta escura
});

test('participação: proporções pelos valores monetários originais; demais = total − 5 maiores; denominador fixo', () => {
  const resp = {
    totais: { produtos_distintos: 7, bruto_total_periodo: 300 },
    produtos: [
      { codigo: 'a', descricao: 'A', bruto: 100, participacao: 0.3333 },
      { codigo: 'b', descricao: 'B', bruto: 50, participacao: 0.1667 },
      { codigo: 'c', descricao: 'C', bruto: 25, participacao: 0.0833 },
      { codigo: 'd', descricao: 'D', bruto: 25, participacao: 0.0833 },
      { codigo: 'e', descricao: 'E', bruto: 20, participacao: 0.0667 },
    ],
  };
  const s = segmentosParticipacao(resp, 5);
  assert.equal(s.top[0].participacao, 100 / 300); // não o 0,3333 arredondado
  assert.equal(s.demais.bruto, 80);
  assert.equal(s.demais.quantidade, 2);
  const soma = s.top.reduce((a, p) => a + p.participacao, 0) + s.demais.participacao;
  assert.ok(Math.abs(soma - 1) < 1e-12);
  assert.equal(s.bruto, 300);
  const cores = coresParticipacao(['a', 'b', 'c'], { b: PALETA_PRODUTOS[2] });
  assert.equal(cores.b, PALETA_PRODUTOS[2]); // selecionado mantém a própria cor
  assert.equal(cores.a, PALETA_SECUNDARIA[0]);
  assert.ok(!PALETA_PRODUTOS.includes(cores.a) && !PALETA_PRODUTOS.includes(cores.c));
});

test('cliente: invalidar() muda a chave dos blocos, descarta o cache e não repete chamada em andamento', async () => {
  const sb = supabaseFalso({ atraso: 15 });
  const c = criarClienteBi(sb);
  const args = { de: '2026-11-18', ate: '2026-11-24', dias: null };
  const k1 = c.chave('resumo', args);
  const eventos = [];
  const sair = c.assinar(() => eventos.push(c.ocupado()));
  const p1 = c.consultar('resumo', args);
  assert.equal(c.ocupado(), true);
  await p1;
  await new Promise((r) => setTimeout(r, 0)); // contador cai no finally (próximo tique)
  assert.equal(c.ocupado(), false);
  await c.consultar('resumo', args);
  assert.equal(sb.log.chamadas.length, 1);
  c.invalidar();
  const k2 = c.chave('resumo', args);
  assert.notEqual(k1, k2);
  await c.consultar('resumo', args);
  assert.equal(sb.log.chamadas.length, 2); // cache descartado
  await c.consultar('status', {});
  await c.consultar('status', {}, { ignorarCache: true });
  assert.equal(sb.log.chamadas.length, 4);
  sair();
  assert.ok(eventos.includes(true) && eventos.includes(false));
  assert.equal(c.estatisticas().geracao, 1);
});

test('cores: seguem o produto (remover um não repinta os demais); paleta de 5; rampa do mapa de calor', () => {
  const m1 = atribuirCores(['900', '120', '300']);
  assert.deepEqual(['900', '120', '300'].map((c) => m1[c]), PALETA_PRODUTOS.slice(0, 3));
  const m2 = atribuirCores(['900', '300', '410'], m1);
  assert.equal(m2['900'], m1['900']);
  assert.equal(m2['300'], m1['300']);
  assert.equal(m2['410'], PALETA_PRODUTOS[1]); // reutiliza a cor liberada
  assert.equal(corCalor(null, 10), '#f4f6f5');
  assert.notEqual(corCalor(0, 10), corCalor(10, 10));
});

// ---------------------------------------------------------------------------
// Exportação da tabela de produtos
// ---------------------------------------------------------------------------
test('exportação: conjunto inteiro, valores numéricos no Excel com 2 casas, média/dia só sem dia parcial', async () => {
  const produtos = [
    { codigo: '311', descricao: 'OVO FICTICIO', quantidade: 12, vendas: 10, bruto: 12, preco_medio: 1, participacao: 0.01, descricao_compartilhada: true },
    { codigo: '900', descricao: 'PAO FRANCES FICTICIO', quantidade: 3.375, vendas: 9, bruto: 63.79, preco_medio: 18.9, participacao: 0.2 },
  ];
  const cob = { dias_validos: 7, dias_com_dados: 7 };
  assert.ok(Math.abs(mediaPorDia(produtos[1], cob) - 63.79 / 7) < 1e-9);
  assert.equal(mediaPorDia(produtos[1], { dias_validos: 6, dias_com_dados: 7 }), null);
  const m = montarExportacaoProdutos({ produtos, cobertura: cob, filtros: { de: '2026-11-18', ate: '2026-11-24', dias: [0, 1, 2, 3, 4, 5, 6] }, busca: '', ordemRotulo: 'Faturamento (decrescente)', geradoEm: '25/11/2026 10:00' });
  assert.equal(m.planilhas[0].linhas.length, 2);
  assert.equal(m.planilhas[0].linhas[1][2], 3.375);
  assert.equal(m.pdf.secoes[0].linhas[0][1], 'OVO FICTICIO (descrição em mais de um código)');
  assert.ok(m.pdf.secoes[0].cabecalho.every((c) => !/desconto/i.test(c)));
  const bytes = gerarXlsx({ planilhas: m.planilhas, titulo: m.titulo });
  assert.ok(bytes.length > 500);
  const texto = Buffer.from(bytes).toString('latin1');
  assert.ok(texto.includes('xl/styles.xml'));
});

// ---------------------------------------------------------------------------
// Navegação oficial: BI no grupo administrativo, só para proprietario_admin
// ---------------------------------------------------------------------------
test('menu: BI Gerencial entra no grupo administrativo, antes de Importações G3, só para o admin ativo', async () => {
  const { navegacaoDoUsuario, destinosMobile, moduloEstaAtivo } = await import('../../nav/navegacao.js');
  const admin = { perfil: 'proprietario_admin', ativo: true };
  const nav = navegacaoDoUsuario(new Set(), admin);
  const chaves = nav.admin.map((i) => i.chave);
  assert.ok(chaves.includes('bi'));
  assert.ok(chaves.indexOf('bi') < chaves.indexOf('importacoes'));
  assert.equal(nav.admin.find((i) => i.chave === 'bi').href, '/bi');
  assert.ok(destinosMobile(new Set(), admin).maisAdmin.some((i) => i.chave === 'bi'));
  for (const outro of [{ perfil: 'gestao', ativo: true }, { perfil: 'proprietario_admin', ativo: false }, null]) {
    assert.ok(!navegacaoDoUsuario(new Set(['producao.visualizar']), outro).admin.some((i) => i.chave === 'bi'), JSON.stringify(outro));
  }
  assert.ok(moduloEstaAtivo('/bi', '/bi'));
  assert.ok(!moduloEstaAtivo('/bichos', '/bi'));
});
