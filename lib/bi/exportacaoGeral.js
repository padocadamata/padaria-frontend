// BI Gerencial -- EXPORTAÇÃO GERAL (Excel com várias abas + PDF gerencial).
//
// Princípios:
//  - Instantâneo: o registro dos blocos (filtros efetivos, parâmetros da tela
//    e argumentos EXATOS das consultas -- ver useRegistroExportacao) é copiado
//    no clique; mudar os filtros durante a geração não afeta o arquivo.
//  - Mesmas consultas e mesmas regras: os dados vêm das MESMAS RPCs, pelo
//    MESMO cliente (cache + fila; o que o painel já carregou não é consultado
//    de novo), e as linhas saem das MESMAS funções de lib/bi/modelos usadas
//    pelos gráficos e tabelas da tela. Nenhum recálculo com outro critério.
//  - Ausência nunca vira zero (célula vazia no Excel, "sem dados" no PDF);
//    variações só quando válidas; descontos nunca atribuídos a produtos;
//    quantidades sem unidade; sem custo/lucro/margem.
//  - Bloco com erro, indisponível ou sem dados é declarado no arquivo (aba
//    "Filtros e Cobertura", quadro "Situação dos blocos" do PDF e aviso na
//    capa/resumo) -- nunca um relatório incompleto que pareça completo.

import { NOMES_DIA, NOMES_DIA_CURTO, REFERENCIAS, diaDaSemana } from './datas.js';
import {
  AVISO_COMPARACAO, AVISO_PERIODO, MOTIVO_COMPARACAO, MOTIVO_PERIODO, ROTULO_AGRUPAMENTO, ROTULO_CLASSE,
  data, dataHora, intervalo, moeda, moedaEixo, nomeDosDias, numero, numeroEixo, percentual, percentualEixo, plural, pontosPercentuais, quantidade,
} from './formatos.js';
import {
  INDICADORES_COMPARATIVO, METRICAS_SERIE, analisarHorarios, compararValores, contagemCobertura, curvasProdutoHorario, diasForaDasMedias,
  escalaCalor, faixaDeHoras, juntarSeries, linhaComparativoGeral, pontosSerie, rotuloGrupo, segmentosParticipacao, situacaoDoDia,
  situacaoDoGrupo, situacaoVariacaoCartao, topPorHora, ORDENS_RANKING,
} from './modelos.js';
import { COR_DEMAIS, COR_SERIE_A, COR_SERIE_B, CORES_MARCA, ROTULO_MARCA, corCalor, coresParticipacao } from './cores.js';
import { montarExportacaoProdutos } from './exportacao.js';
import {
  desenharCartoes, desenharGraficoColunas, desenharGraficoLinhas, desenharMapaCalor, desenharRosca,
} from '../exportacao/graficosPdf.js';

// Número ou null. Remove só o ruído de ponto flutuante das médias calculadas
// (ex.: 2946.1400000000003 -> 2946.14), sem arredondar a precisão real.
const num = (v) => {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return null;
  return Math.round(Number(v) * 1e8) / 1e8;
};
// Dias sem registro: os totais "registrados" do calendário não são zero, são ausência.
const CLASSES_SEM_REGISTRO = new Set(['sem_importacao', 'sem_operacao', 'pre_operacao', 'futuro']);
const tipado = (valor, tipo) => ({ valor: num(valor), tipo });

export const PAGINA_EXPORTACAO = 500;

// Ordem e títulos dos blocos (mesma ordem da página).
export const BLOCOS_EXPORTACAO = [
  ['resumo', 'Indicadores gerais'],
  ['evolucao', 'Evolução do faturamento'],
  ['semana', 'Média diária por dia da semana'],
  ['ranking', 'Ranking de produtos'],
  ['participacao', 'Participação no faturamento'],
  ['evoprod', 'Evolução de produtos selecionados'],
  ['tabela', 'Tabela de produtos'],
  ['curva', 'Distribuição das vendas por horário'],
  ['calor', 'Mapa de calor'],
  ['prodhora', 'Produtos por horário'],
  ['comparativo', 'Comparativo entre períodos'],
];
const TITULO = Object.fromEntries(BLOCOS_EXPORTACAO);

// ---------------------------------------------------------------------------
// Instantâneo e coleta
// ---------------------------------------------------------------------------

// Cópia profunda e IMUTÁVEL do estado do painel no momento do clique.
export function capturarInstantaneo({ registro, geral, status, selecionados, descricoes, cores, geradoEm, geradoEmIso }) {
  return JSON.parse(JSON.stringify({ registro: registro || {}, geral, status, selecionados: selecionados || [], descricoes: descricoes || {}, cores: cores || {}, geradoEm, geradoEmIso }));
}

async function todasAsPaginas(cliente, args) {
  const produtos = [];
  let primeira = null;
  let deslocamento = 0;
  for (let volta = 0; volta < 1000; volta += 1) {
    const r = await cliente.consultar('produtos', { ...args, limite: PAGINA_EXPORTACAO, deslocamento });
    if (!primeira) primeira = r;
    produtos.push(...((r && r.produtos) || []));
    if (!r || !r.paginacao || !r.paginacao.tem_mais) break;
    deslocamento += PAGINA_EXPORTACAO;
  }
  return { ...(primeira || {}), produtos };
}

// Executa as consultas registradas (com o cache/fila do cliente). Cada
// consulta tem estado próprio: ok | erro | inativa (sem argumentos).
export async function coletarDadosExportacao(cliente, instantaneo, { aoProgredir } = {}) {
  const dados = {};
  const tarefas = [];
  let feitas = 0;
  for (const [bloco] of BLOCOS_EXPORTACAO) {
    const r = instantaneo.registro[bloco];
    dados[bloco] = {};
    if (!r) continue;
    for (const [nome, c] of Object.entries(r.consultas || {})) {
      if (!c) {
        dados[bloco][nome] = { estado: 'inativa' };
        continue;
      }
      tarefas.push(
        (async () => {
          try {
            const valor = c.paginado ? await todasAsPaginas(cliente, c.args) : await cliente.consultar(c.tipo, c.args);
            dados[bloco][nome] = { estado: 'ok', dados: valor };
          } catch (e) {
            dados[bloco][nome] = { estado: 'erro', erro: e && e.message ? e.message : 'Não foi possível carregar.' };
          } finally {
            feitas += 1;
            if (aoProgredir) aoProgredir(feitas, tarefas.length);
          }
        })()
      );
    }
  }
  await Promise.all(tarefas);
  return dados;
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

const ROTULO_REFERENCIA = Object.fromEntries(REFERENCIAS.map((r) => [r.valor, r.rotulo.replace(/^vs\. /, '')]));
const ROTULO_CAMPO = { periodo: 'período', dias: 'dias da semana', agrupamento: 'agrupamento', referencia: 'comparação' };

export function descreverFiltros(f, { ref = null, agrupamento = false } = {}) {
  if (!f) return '';
  const partes = [`Período ${intervalo(f.de, f.ate)}`, `Dias: ${nomeDosDias(f.dias)}`];
  if (agrupamento && f.agrupamento) partes.push(`Agrupamento: ${ROTULO_AGRUPAMENTO[f.agrupamento]}`);
  if (ref) partes.push(`Referência (B): ${intervalo(ref.de, ref.ate)}`);
  partes.push(f.proprios && f.proprios.length ? `Filtro próprio do bloco: ${f.proprios.map((c) => ROTULO_CAMPO[c] || c).join(', ')}` : 'Filtros gerais');
  return partes.join(' · ');
}

// Texto seguro para as fontes padrão do PDF (WinAnsi): setas e sinais fora
// do conjunto viram equivalentes; o número já carrega o sinal.
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function textoPdf(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[▲▼■]\s?/g, '')
    .replace(/[−]/g, '-')
    .replace(/[  ]/g, ' ')
    .split('')
    .filter((ch) => ch.charCodeAt(0) <= 0xff || WINANSI_EXTRA.includes(ch))
    .join('');
}

function variacaoPdf(v) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${percentual(n)}`;
}
const difPdf = (v, fmt) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${fmt(v)}`);
const ouSemDados = (v, fmt) => (v === null || v === undefined ? 'sem dados' : fmt(v));

// ---------------------------------------------------------------------------
// Blocos -> { situacao, planilhas, secoes }
// ---------------------------------------------------------------------------

function situacao(bloco, estado, mensagem = '') {
  return { bloco, titulo: TITULO[bloco], estado, mensagem };
}

// Consulta principal de um bloco: devolve { ok, dados, sit } padronizado.
function principal(inst, dados, bloco, nome) {
  const r = inst.registro[bloco];
  if (!r) return { sit: situacao(bloco, 'indisponivel', 'Bloco não exibido no painel (período geral acima do limite).') };
  if (r.indisponivel) return { sit: situacao(bloco, 'indisponivel', r.indisponivel) };
  const c = dados[bloco] && dados[bloco][nome];
  if (!c || c.estado === 'inativa') return { sit: situacao(bloco, 'indisponivel', 'Sem consulta para os filtros atuais.') };
  if (c.estado === 'erro') return { sit: situacao(bloco, 'erro', c.erro) };
  return { ok: true, dados: c.dados, r };
}

// Referência (B): ok, ausente (sem referência) ou erro (declarado).
function referencia(dados, bloco, nome) {
  const c = dados[bloco] && dados[bloco][nome];
  if (!c || c.estado === 'inativa') return { dados: null, erro: null };
  if (c.estado === 'erro') return { dados: null, erro: c.erro };
  return { dados: c.dados, erro: null };
}

const notasPlanilha = (inst, titulo, linhas) => [
  { texto: `BI Gerencial · ${titulo}`, destaque: true },
  ...linhas.filter(Boolean),
  `Gerado em ${inst.geradoEm}`,
];

// ---- Indicadores gerais ----------------------------------------------------
const CARTOES = [
  { campo: 'bruto', rotulo: 'Faturamento bruto', tipo: 'moeda', total: true },
  { campo: 'liquido', rotulo: 'Faturamento líquido', tipo: 'moeda', total: true },
  { campo: 'vendas', rotulo: 'Vendas', tipo: 'numero', total: true },
  { campo: 'ticket', rotulo: 'Ticket médio', tipo: 'moeda' },
  { campo: 'descontos', rotulo: 'Descontos', tipo: 'moeda', total: true, bom: false },
  { campo: 'media_diaria_bruto', rotulo: 'Média diária (bruto)', tipo: 'moeda' },
];
const EXTRAS_RESUMO = [
  { campo: 'media_diaria_vendas', rotulo: 'Média diária de vendas', tipo: 'numero1' },
  { campo: 'media_diaria_descontos', rotulo: 'Média diária de descontos', tipo: 'moeda' },
  { campo: 'percentual_descontos', rotulo: '% de desconto sobre o bruto', tipo: 'percentual' },
];
const TIPO_XLSX = { moeda: 'decimal', numero: 'numero', numero1: 'decimal', percentual: 'percentual' };
const UNIDADE = { moeda: 'R$', numero: 'vendas', numero1: 'vendas/dia', percentual: '%' };
const FMT = { moeda, numero: (v) => numero(v), numero1: (v) => numero(v, 1), percentual: (v) => percentual(v, 2) };

const TEXTO_VARIACAO = {
  desativada: 'variação desativada',
  limite: 'comparação disponível até 366 dias',
  indisponivel: 'variação indisponível',
  nao_comparavel: 'não comparável',
  so_medias: 'total: só médias comparáveis (durações diferentes)',
  base_zero: 'referência zero: sem variação percentual',
  sem_valor: '',
};

function blocoResumo(inst, dados) {
  const p = principal(inst, dados, 'resumo', 'resumo');
  if (!p.ok) return { sit: p.sit, planilhas: [], secoes: [], cobertura: null };
  const r = p.dados;
  const reg = p.r;
  const compC = dados.resumo.comparar;
  const comp = compC && compC.estado === 'ok' ? compC.dados : null;
  const compErro = compC && compC.estado === 'erro' ? compC.erro : null;
  const calC = dados.resumo.calendario;
  const calendario = calC && calC.estado === 'ok' ? calC.dados : null;
  const f = reg.filtros;
  const ref = reg.ref;

  if (r.motivo) {
    const msg = MOTIVO_PERIODO[r.motivo] || 'Período sem dados.';
    return { sit: situacao('resumo', 'vazio', msg), planilhas: [], secoes: [{ titulo: 'Indicadores gerais', texto: [{ texto: `${msg} Os indicadores ficam "sem dados".`, tom: 'suave' }] }], cobertura: null };
  }
  const base = r.base_media || {};
  const registrado = r.registrado || null;
  const temBase = Number(base.dias_validos || 0) > 0;
  const soParcial = !temBase && !!registrado;

  const valorA = (campo) => {
    if (temBase) return num(base[campo]);
    if (soParcial && campo in registrado && !campo.startsWith('media_diaria')) return num(registrado[campo]);
    return null;
  };
  const linhas = [...CARTOES, ...EXTRAS_RESUMO].map((def) => {
    const a = valorA(def.campo);
    let b = null;
    let dif = null;
    let variacao = null;
    let obs = '';
    if (soParcial) obs = def.campo.startsWith('media_diaria') ? 'sem dia completo no período: sem dados' : 'parcial: registrado até a última importação; fora das médias e das comparações';
    else if (!temBase) obs = 'sem dias completos: sem dados (não é zero)';
    else if (!ref) obs = TEXTO_VARIACAO.desativada;
    else if (compErro) obs = `variação indisponível: ${compErro}`;
    else {
      const v = situacaoVariacaoCartao(comp, def.campo, { total: !!def.total, temReferencia: !!ref, podeComparar: !!reg.parametros.podeComparar });
      if (comp && comp.geral) {
        b = num(comp.geral.b ? comp.geral.b[def.campo] : null);
        dif = comp.geral.comparavel && comp.geral.diferencas ? num(comp.geral.diferencas[def.campo]) : null;
      }
      if (v.estado === 'ok') variacao = v.valor;
      else obs = v.estado === 'nao_comparavel' ? `não comparável: ${MOTIVO_COMPARACAO[v.motivo] || v.motivo || ''}`.trim() : TEXTO_VARIACAO[v.estado] || '';
    }
    return { def, a, b, dif, variacao, obs };
  });
  const regBruto = registrado ? num(registrado.bruto) : null;

  const cob = r.dias ? contagemCobertura(r.dias) : null;
  const fora = calendario ? diasForaDasMedias(calendario, f.dias) : [];
  const textoCobertura = cob
    ? [
        plural(cob.completos, 'dia completo', 'dias completos') + (cob.semVendas ? ` (${numero(cob.semVendas)} sem vendas: zero real)` : ''),
        cob.parciais + cob.pendencias ? `${plural(cob.parciais + cob.pendencias, 'parcial', 'parciais')} (fora das médias)` : '',
        cob.semImportacao ? `${numero(cob.semImportacao)} sem importação (lacuna, não zero)` : '',
        cob.semOperacao ? `${numero(cob.semOperacao)} sem operação` : '',
        cob.naoConfirmados ? `${numero(cob.naoConfirmados)} com cobertura não confirmada` : '',
      ].filter(Boolean).join(' · ')
    : 'cobertura indisponível';
  const textoFora = fora.length
    ? `Fora das médias: ${fora.slice(0, 12).map((d) => `${data(d.dia)} ${ROTULO_CLASSE[d.classe] || d.classe}${d.horaLimite ? ` (até ${d.horaLimite})` : ''}`).join('; ')}${fora.length > 12 ? `; e mais ${fora.length - 12}` : ''}`
    : '';
  const textoComparacao = !ref
    ? 'Variação nos cartões desativada.'
    : comp
      ? `Referência (B): ${intervalo(comp.periodos.b.de, comp.periodos.b.ate)} · Critério: ${comp.criterio === 'pareado' ? `pareado (${numero(comp.pareamento ? comp.pareamento.pares_validos_vendas : 0)} de ${numero(comp.pareamento ? comp.pareamento.pares : 0)} pares válidos)` : 'média por dia válido'} · Cobertura A ${percentual(comp.geral.a.cobertura, 0)} · B ${percentual(comp.geral.b.cobertura, 0)} (mínimo ${percentual(comp.cobertura_minima, 0)})${comp.geral.comparavel ? '' : ` · NÃO COMPARÁVEL: ${MOTIVO_COMPARACAO[comp.geral.motivo] || comp.geral.motivo}`}`
      : compErro
        ? `Referência (B): variação indisponível (${compErro}).`
        : `Referência (B): ${ref ? intervalo(ref.de, ref.ate) : '—'} · ${(reg.avisos || []).join(' ')}`;
  const avisos = [
    ...(comp && comp.avisos ? comp.avisos.map((a) => AVISO_COMPARACAO[a] || a) : []),
    ...((r.avisos || []).filter((a) => AVISO_PERIODO[a] && a !== 'contem_dia_parcial').map((a) => AVISO_PERIODO[a])),
  ];

  const planilha = {
    nome: 'Resumo Gerencial',
    notas: [
      { texto: 'BI Gerencial · Resumo gerencial', destaque: true },
      `Período: ${intervalo(f.de, f.ate)} · Dias: ${nomeDosDias(f.dias)}`,
      textoComparacao,
      `Cobertura: ${textoCobertura}`,
      textoFora || null,
      ...avisos.map((a) => `Aviso: ${a}`),
      soParcial ? 'Período sem dia completo: valores registrados até a última importação (parciais), fora das médias e das comparações.' : null,
      `Gerado em ${inst.geradoEm}`,
    ].filter(Boolean),
    colunas: [
      { titulo: 'Indicador', tipo: 'texto', largura: 30 },
      { titulo: 'Valor (A)', tipo: 'decimal', largura: 16 },
      { titulo: 'Unidade', tipo: 'texto', largura: 11 },
      { titulo: 'Referência (B)', tipo: 'decimal', largura: 16 },
      { titulo: 'Diferença (A − B)', tipo: 'decimal', largura: 17 },
      { titulo: 'Variação', tipo: 'percentual', largura: 11 },
      { titulo: 'Observação', tipo: 'texto', largura: 60 },
    ],
    linhas: [
      ...linhas.map((l) => [l.def.rotulo, tipado(l.a, TIPO_XLSX[l.def.tipo]), UNIDADE[l.def.tipo], tipado(l.b, TIPO_XLSX[l.def.tipo]), tipado(l.dif, TIPO_XLSX[l.def.tipo]), tipado(l.variacao, 'percentual'), l.obs]),
      ['Dias completos na base das médias', tipado(base.dias_validos ?? 0, 'numero'), 'dias', null, null, null, temBase ? '' : 'nenhum dia completo'],
      ['Faturamento bruto registrado (inclui dias parciais)', tipado(regBruto, 'decimal'), 'R$', null, null, null, 'só informativo: fora das médias e das comparações'],
    ],
  };

  const cartoes = linhas.slice(0, CARTOES.length).map((l) => {
    const fmt = FMT[l.def.tipo];
    const linhasCartao = [];
    if (l.variacao !== null) linhasCartao.push({ texto: `${variacaoPdf(l.variacao)} vs. ref.`, cor: l.def.bom === false ? [110, 110, 110] : l.variacao > 0 ? [26, 127, 55] : l.variacao < 0 ? [192, 57, 43] : [110, 110, 110] });
    // No cartão, só o motivo curto (o completo fica na tabela "Indicadores detalhados").
    else if (l.obs) linhasCartao.push(l.obs.startsWith('não comparável') ? 'não comparável' : l.obs.startsWith('variação indisponível') ? 'variação indisponível' : l.obs);
    if (l.def.campo === 'bruto' && temBase) linhasCartao.push(plural(base.dias_validos, 'dia completo', 'dias completos'));
    if (l.def.campo === 'vendas' && temBase) linhasCartao.push(`${numero(base.media_diaria_vendas, 1)} por dia`);
    if (l.def.campo === 'descontos' && temBase) linhasCartao.push(`${percentual(base.percentual_descontos, 2)} do bruto`);
    return { titulo: l.def.rotulo, valor: ouSemDados(l.a, fmt), linhas: linhasCartao, selo: soParcial && l.a !== null ? 'parcial' : null };
  });

  const secoes = [
    {
      titulo: 'Indicadores gerais',
      nota: descreverFiltros(f, { ref }),
      texto: [
        { texto: `Cobertura do período: ${textoCobertura}.`, tom: 'forte' },
        textoFora ? { texto: textoFora, tom: 'suave' } : null,
        { texto: textoComparacao, tom: comp && !comp.geral.comparavel ? 'aviso' : 'suave' },
        ...avisos.map((a) => ({ texto: `Aviso: ${a}`, tom: 'suave' })),
        soParcial ? { texto: 'Período sem dia completo: valores registrados até a última importação (parciais), fora das médias e das comparações.', tom: 'aviso' } : null,
      ].filter(Boolean),
      grafico: { altura: 27, desenhar: (doc, area) => desenharCartoes(doc, area, { cartoes }) },
    },
    {
      titulo: 'Indicadores detalhados',
      compacto: true,
      cabecalho: ['Indicador', 'Valor (A)', 'Referência (B)', 'Diferença', 'Variação', 'Observação'],
      larguras: { 0: 60, 5: 90 },
      colunasTexto: 1,
      centralizarColunas: [1, 2, 3, 4],
      numerosADireita: true,
      linhas: linhas.map((l) => {
        const fmt = FMT[l.def.tipo];
        return [
          l.def.rotulo,
          ouSemDados(l.a, fmt),
          l.b === null ? '—' : fmt(l.b),
          l.def.tipo === 'percentual' ? (l.dif === null ? '—' : pontosPercentuais(l.dif)) : difPdf(l.dif, fmt),
          variacaoPdf(l.variacao),
          { texto: l.obs, tom: 'vazio' },
        ];
      }),
    },
  ];

  const sitEstado = compErro ? situacao('resumo', 'parcial', `Comparação indisponível: ${compErro}`) : !temBase && !soParcial ? situacao('resumo', 'vazio', 'Sem dias completos no período e filtro escolhidos.') : situacao('resumo', 'ok');
  return { sit: sitEstado, planilhas: [planilha], secoes, calendario, cobertura: { texto: textoCobertura, fora: textoFora } };
}

function planilhaCalendario(inst, calendario, f) {
  if (!calendario) return null;
  const filtro = f && f.dias && f.dias.length < 7 ? new Set(f.dias) : null;
  const registrado = (d, v) => (CLASSES_SEM_REGISTRO.has(d.classe_vendas) ? null : num(v));
  return {
    nome: 'Calendário',
    notas: notasPlanilha(inst, 'Calendário de cobertura (base vendas e itens)', [
      `Período: ${intervalo(f.de, f.ate)} · Dias no filtro: ${nomeDosDias(f.dias)}`,
      'Dias parciais, sem importação, com pendências ou cobertura não confirmada ficam FORA das médias; "antes do início da operação" fica fora dos indicadores.',
    ]),
    colunas: [
      { titulo: 'Data', tipo: 'data', largura: 12 },
      { titulo: 'Dia da semana', tipo: 'texto', largura: 13 },
      { titulo: 'No filtro de dias', tipo: 'texto', largura: 10 },
      { titulo: 'Situação (vendas)', tipo: 'texto', largura: 26 },
      { titulo: 'Hora limite (vendas)', tipo: 'texto', largura: 12 },
      { titulo: 'Entra nas médias (vendas)', tipo: 'texto', largura: 13 },
      { titulo: 'Situação (itens)', tipo: 'texto', largura: 26 },
      { titulo: 'Entra nas médias (itens)', tipo: 'texto', largura: 13 },
      { titulo: 'Vendas registradas', tipo: 'numero', largura: 12 },
      { titulo: 'Bruto registrado (R$)', tipo: 'decimal', largura: 15 },
      { titulo: 'Vendas não conciliadas', tipo: 'numero', largura: 12 },
      { titulo: 'Aviso', tipo: 'texto', largura: 40 },
    ],
    linhas: calendario.map((d) => [
      d.dia,
      NOMES_DIA[diaDaSemana(d.dia)],
      !filtro || filtro.has(diaDaSemana(d.dia)) ? 'sim' : 'não',
      ROTULO_CLASSE[d.classe_vendas] || d.classe_vendas || '',
      d.hora_limite_vendas ? String(d.hora_limite_vendas).slice(0, 5) : '',
      d.entra_media_vendas ? 'sim' : 'não',
      ROTULO_CLASSE[d.classe_itens] || d.classe_itens || '',
      d.entra_media_itens ? 'sim' : 'não',
      registrado(d, d.vendas_registradas),
      registrado(d, d.bruto_registrado),
      registrado(d, d.vendas_nao_conciliadas),
      d.aviso || d.excecao_motivo || '',
    ]),
  };
}

// ---- Evolução do faturamento -------------------------------------------------
function blocoEvolucao(inst, dados) {
  const p = principal(inst, dados, 'evolucao', 'a');
  if (!p.ok) return { sit: p.sit, planilhas: [], secoes: [secaoIndisponivel('evolucao', p.sit, inst)] };
  const reg = p.r;
  const f = reg.filtros;
  const metrica = reg.parametros.metrica || 'bruto';
  const def = METRICAS_SERIE[metrica];
  const B = referencia(dados, 'evolucao', 'b');
  const linhasA = p.dados || [];
  const linhasB = B.dados || null;
  const pa = pontosSerie(linhasA, metrica, f.agrupamento);
  const pb = linhasB ? pontosSerie(linhasB, metrica, f.agrupamento) : null;
  const juntos = juntarSeries(pa, pb);
  const porDia = f.agrupamento === 'dia';
  const fmt = def.tipo === 'moeda' ? moeda : (v) => numero(v, porDia ? 0 : 1);
  const sitTexto = (l) => (porDia ? situacaoDoDia(l.classe, l.hora_limite).texto : situacaoDoGrupo(l.dias_validos, l.dias_calendario).texto);
  const linha = (serie, l, par) => [
    serie,
    l.inicio,
    l.fim,
    l.rotulo,
    sitTexto(l),
    num(l.dias_validos),
    num(l.dias_calendario),
    num(l.media_diaria_bruto),
    num(l.media_diaria_liquido),
    num(l.media_diaria_vendas),
    num(l.ticket_media),
    num(l.media_diaria_descontos),
    num(l.bruto),
    num(l.liquido),
    num(l.vendas),
    num(l.descontos),
    par ? num(par.b) : null,
    par ? num(par.diferenca) : null,
    par ? num(par.variacao) : null,
  ];
  const linhas = [
    ...linhasA.map((l, i) => {
      if (!pb) return linha('A', l, null);
      const j = juntos[i];
      const c = compararValores(j.a, j.b);
      return linha('A', l, { b: j.b, diferenca: c.diferenca, variacao: c.variacao });
    }),
    ...(linhasB || []).map((l) => linha('B', l, null)),
  ];
  const planilha = {
    nome: 'Evolução do Faturamento',
    notas: notasPlanilha(inst, 'Evolução do faturamento', [
      `Filtros: ${descreverFiltros(f, { ref: pb ? reg.ref : null, agrupamento: true })}`,
      `Métrica exibida no gráfico: ${def.rotulo} (colunas "B pareado", "Diferença" e "Variação" referem-se a ela; pareamento por posição, como no gráfico).`,
      'Médias diárias = só dias completos. Valores "registrados" incluem dias parciais (informativos, fora das médias). Célula vazia = sem dados (não é zero).',
      ...(reg.avisos || []),
      B.erro ? `Referência (B) indisponível: ${B.erro}` : null,
    ]),
    colunas: [
      { titulo: 'Série', tipo: 'texto', largura: 7 },
      { titulo: 'Início', tipo: 'data', largura: 12 },
      { titulo: 'Fim', tipo: 'data', largura: 12 },
      { titulo: 'Rótulo', tipo: 'texto', largura: 22 },
      { titulo: 'Situação', tipo: 'texto', largura: 36 },
      { titulo: 'Dias completos', tipo: 'numero', largura: 10 },
      { titulo: 'Dias no filtro', tipo: 'numero', largura: 10 },
      { titulo: 'Média diária bruto (R$)', tipo: 'decimal', largura: 15 },
      { titulo: 'Média diária líquido (R$)', tipo: 'decimal', largura: 15 },
      { titulo: 'Média diária vendas', tipo: 'decimal', largura: 12 },
      { titulo: 'Ticket médio (R$)', tipo: 'decimal', largura: 12 },
      { titulo: 'Média diária descontos (R$)', tipo: 'decimal', largura: 15 },
      { titulo: 'Bruto registrado (R$)', tipo: 'decimal', largura: 15 },
      { titulo: 'Líquido registrado (R$)', tipo: 'decimal', largura: 15 },
      { titulo: 'Vendas registradas', tipo: 'numero', largura: 12 },
      { titulo: 'Descontos registrados (R$)', tipo: 'decimal', largura: 15 },
      { titulo: `B pareado (${def.rotulo})`, tipo: 'decimal', largura: 15 },
      { titulo: 'Diferença (A − B)', tipo: 'decimal', largura: 15 },
      { titulo: 'Variação', tipo: 'percentual', largura: 10 },
    ],
    linhas,
  };
  const marcas = [...new Set(juntos.map((d) => d.marca).filter(Boolean))];
  const semValor = !pa.some((x) => x.valor !== null);
  const secao = {
    titulo: 'Evolução do faturamento',
    nota: `${descreverFiltros(f, { ref: pb ? reg.ref : null, agrupamento: true })} · Métrica: ${def.rotulo}${porDia ? '' : ' (média por dia completo do agrupamento)'}${B.erro ? ` · Referência indisponível: ${B.erro}` : ''}`,
    texto: semValor ? [{ texto: 'Sem dias completos no período: nada a exibir (sem dados não é zero).', tom: 'suave' }] : undefined,
    grafico: semValor
      ? undefined
      : {
          altura: 64,
          desenhar: (doc, area) =>
            desenharGraficoLinhas(doc, area, {
              rotulos: juntos.map((d) => d.rotulo),
              series: [
                { nome: textoPdf(`A · ${intervalo(f.de, f.ate)}`), cor: COR_SERIE_A, valores: juntos.map((d) => d.a) },
                ...(pb ? [{ nome: textoPdf(`B · ${intervalo(reg.ref.de, reg.ref.ate)}`), cor: COR_SERIE_B, tracejado: true, valores: juntos.map((d) => d.b) }] : []),
              ],
              faixas: juntos.filter((d) => d.marca && CORES_MARCA[d.marca]).map((d) => ({ indice: d.indice, cor: CORES_MARCA[d.marca] })),
              legenda: marcas.map((m) => ({ nome: textoPdf(ROTULO_MARCA[m]), cor: CORES_MARCA[m], tipo: 'faixa' })),
              formatoEixo: def.tipo === 'moeda' ? moedaEixo : numeroEixo,
            }),
        },
  };
  const sit = B.erro ? situacao('evolucao', 'parcial', `Referência (B) indisponível: ${B.erro}`) : semValor ? situacao('evolucao', 'vazio', 'Sem dias completos no período.') : situacao('evolucao', 'ok');
  return { sit, planilhas: [planilha], secoes: [secao], fmt };
}

// ---- Média por dia da semana -------------------------------------------------
function blocoSemana(inst, dados) {
  const p = principal(inst, dados, 'semana', 'a');
  if (!p.ok) return { sit: p.sit, planilhas: [], secoes: [secaoIndisponivel('semana', p.sit, inst)] };
  const reg = p.r;
  const f = reg.filtros;
  const B = referencia(dados, 'semana', 'b');
  const ha = analisarHorarios(p.dados);
  const hb = B.dados ? analisarHorarios(B.dados) : null;
  const foraFiltro = (dow) => f.dias.length < 7 && !f.dias.includes(dow);
  const linhas = ha.diaSemana.map((d, i) => {
    const b = hb ? hb.diaSemana[i] : null;
    const c = hb && !foraFiltro(d.dow) ? compararValores(d.media, b.media) : { diferenca: null, variacao: null };
    return [NOMES_DIA[d.dow], num(d.media), num(d.dias), b ? num(b.media) : null, b ? num(b.dias) : null, num(c.diferenca), num(c.variacao), foraFiltro(d.dow) ? 'fora do filtro de dias' : d.dias ? '' : 'nenhum dia completo: sem dados'];
  });
  const planilha = {
    nome: 'Média por Dia da Semana',
    notas: notasPlanilha(inst, 'Média diária por dia da semana (faturamento bruto médio por dia completo)', [
      `Filtros: ${descreverFiltros(f, { ref: hb ? reg.ref : null })}`,
      B.erro ? `Referência (B) indisponível: ${B.erro}` : null,
    ]),
    colunas: [
      { titulo: 'Dia da semana', tipo: 'texto', largura: 14 },
      { titulo: 'A · média/dia (R$)', tipo: 'decimal', largura: 16 },
      { titulo: 'A · dias completos', tipo: 'numero', largura: 12 },
      { titulo: 'B · média/dia (R$)', tipo: 'decimal', largura: 16 },
      { titulo: 'B · dias completos', tipo: 'numero', largura: 12 },
      { titulo: 'Diferença (A − B)', tipo: 'decimal', largura: 15 },
      { titulo: 'Variação', tipo: 'percentual', largura: 10 },
      { titulo: 'Situação', tipo: 'texto', largura: 32 },
    ],
    linhas,
  };
  const semValor = !ha.diaSemana.some((d) => d.media !== null);
  const secao = {
    titulo: 'Média diária por dia da semana',
    nota: `${descreverFiltros(f, { ref: hb ? reg.ref : null })} · Faturamento bruto médio por dia completo`,
    texto: semValor ? [{ texto: 'Sem dias completos no período.', tom: 'suave' }] : undefined,
    grafico: semValor
      ? undefined
      : {
          altura: 54,
          desenhar: (doc, area) =>
            desenharGraficoColunas(doc, area, {
              rotulos: ha.diaSemana.map((d) => d.rotulo),
              series: [
                { nome: textoPdf(`A · ${intervalo(f.de, f.ate)}`), cor: COR_SERIE_A, valores: ha.diaSemana.map((d) => d.media) },
                ...(hb ? [{ nome: textoPdf(`B · ${intervalo(reg.ref.de, reg.ref.ate)}`), cor: COR_SERIE_B, valores: hb.diaSemana.map((d) => d.media) }] : []),
              ],
              formatoEixo: moedaEixo,
            }),
        },
  };
  const sit = B.erro ? situacao('semana', 'parcial', `Referência (B) indisponível: ${B.erro}`) : semValor ? situacao('semana', 'vazio', 'Sem dias completos no período.') : situacao('semana', 'ok');
  return { sit, planilhas: [planilha], secoes: [secao] };
}

// ---- Ranking -----------------------------------------------------------------
function blocoRanking(inst, dados) {
  const p = principal(inst, dados, 'ranking', 'produtos');
  if (!p.ok) return { sit: p.sit, planilhas: [], secoes: [secaoIndisponivel('ranking', p.sit, inst)] };
  const reg = p.r;
  const f = reg.filtros;
  const resp = p.dados || {};
  const ordem = ORDENS_RANKING[reg.parametros.ordem] || ORDENS_RANKING.bruto;
  const lista = resp.produtos || [];
  const sel = new Set(inst.selecionados);
  const notaTexto = `${descreverFiltros(f)} · Top ${reg.parametros.rankingTop} por ${ordem.rotulo.toLowerCase()} (ordenado sobre todos os produtos elegíveis)`;
  if (resp.motivo || !lista.length) {
    const msg = resp.motivo ? MOTIVO_PERIODO[resp.motivo] || 'Período sem dados.' : 'Nenhum produto vendido (vendas conciliadas) no período.';
    return { sit: situacao('ranking', 'vazio', msg), planilhas: [], secoes: [{ titulo: 'Ranking de produtos', nota: notaTexto, texto: [{ texto: msg, tom: 'suave' }] }] };
  }
  const planilha = {
    nome: 'Ranking de Produtos',
    notas: notasPlanilha(inst, 'Ranking de produtos', [
      `Filtros: ${descreverFiltros(f)}`,
      `Top ${reg.parametros.rankingTop} por ${ordem.rotulo.toLowerCase()}; códigos G3 separados (descrições iguais não são somadas). Vendas = vendas que contêm o código (não somar entre produtos).`,
    ]),
    colunas: [
      { titulo: 'Posição', tipo: 'numero', largura: 9 },
      { titulo: 'Código G3', tipo: 'texto', largura: 11 },
      { titulo: 'Descrição', tipo: 'texto', largura: 38 },
      { titulo: 'Faturamento (R$)', tipo: 'decimal', largura: 15 },
      { titulo: 'Quantidade', tipo: 'decimal3', largura: 12 },
      { titulo: 'Vendas', tipo: 'numero', largura: 10 },
      { titulo: 'Participação', tipo: 'percentual', largura: 12 },
      { titulo: 'Selecionado', tipo: 'texto', largura: 11 },
    ],
    linhas: lista.map((x, i) => [i + 1, x.codigo, x.descricao, num(x.bruto), num(x.quantidade), num(x.vendas), num(x.participacao), sel.has(x.codigo) ? 'sim' : '']),
  };
  const secao = {
    titulo: 'Ranking de produtos',
    nota: notaTexto,
    cabecalho: ['#', 'Código', 'Descrição', 'Faturamento', 'Quantidade', 'Vendas', 'Part.', 'Selecionado'],
    larguras: { 0: 10, 1: 18, 2: 90 },
    colunasTexto: 3,
    centralizarColunas: [3, 4, 5, 6],
    numerosADireita: true,
    compacto: true,
    linhas: lista.map((x, i) => [String(i + 1), x.codigo, x.descricao, moeda(x.bruto), quantidade(x.quantidade), numero(x.vendas), percentual(x.participacao), sel.has(x.codigo) ? 'sim' : '']),
  };
  return { sit: situacao('ranking', 'ok'), planilhas: [planilha], secoes: [secao] };
}

// ---- Participação ------------------------------------------------------------
function blocoParticipacao(inst, dados) {
  const p = principal(inst, dados, 'participacao', 'produtos');
  if (!p.ok) return { sit: p.sit, planilhas: [], secoes: [secaoIndisponivel('participacao', p.sit, inst)] };
  const f = p.r.filtros;
  const seg = segmentosParticipacao(p.dados, 5);
  if (!seg || !seg.top.length || seg.bruto === null) {
    return { sit: situacao('participacao', 'vazio', 'Sem produtos (itens conciliados) no período.'), planilhas: [], secoes: [{ titulo: 'Participação no faturamento', nota: descreverFiltros(f), texto: [{ texto: 'Sem produtos (itens conciliados) no período: sem dados, não é zero.', tom: 'suave' }] }] };
  }
  const corDe = coresParticipacao(seg.top.map((x) => x.codigo), inst.cores);
  const sel = new Set(inst.selecionados);
  const itens = [
    ...seg.top.map((x) => ({ codigo: x.codigo, descricao: x.descricao, valor: num(x.bruto), proporcao: num(x.participacao), cor: corDe[x.codigo], selecionado: sel.has(x.codigo) })),
    ...(seg.demais ? [{ codigo: '', descricao: `Demais ${plural(seg.demais.quantidade, 'código')}`, valor: num(seg.demais.bruto), proporcao: num(seg.demais.participacao), cor: COR_DEMAIS, selecionado: false }] : []),
  ];
  const planilha = {
    nome: 'Participação',
    notas: notasPlanilha(inst, 'Participação no faturamento (5 maiores + demais)', [
      `Filtros: ${descreverFiltros(f)}`,
      'Denominador: faturamento bruto de todos os itens conciliados do período (não muda com a seleção). Proporções calculadas pelos valores em R$ originais.',
    ]),
    colunas: [
      { titulo: 'Código G3', tipo: 'texto', largura: 11 },
      { titulo: 'Descrição', tipo: 'texto', largura: 38 },
      { titulo: 'Faturamento (R$)', tipo: 'decimal', largura: 16 },
      { titulo: 'Participação', tipo: 'percentual', largura: 12 },
      { titulo: 'Selecionado', tipo: 'texto', largura: 11 },
    ],
    linhas: [
      ...itens.map((i) => [i.codigo, i.descricao, num(i.valor), num(i.proporcao), i.selecionado ? 'sim' : '']),
      ['', 'Total do período (denominador)', num(seg.bruto), 1, ''],
    ],
  };
  const secao = {
    titulo: 'Participação no faturamento',
    nota: `${descreverFiltros(f)} · Denominador: faturamento bruto de todos os itens conciliados do período`,
    grafico: {
      altura: 62,
      largura: 66,
      desenhar: (doc, area) =>
        desenharRosca(doc, area, {
          itens: itens.map((i) => ({ valor: i.valor, cor: i.cor })),
          centro: [{ texto: 'Total do período' }, { texto: textoPdf(moeda(seg.bruto)), negrito: true, tamanho: 8 }, { texto: 'itens conciliados' }],
        }),
    },
    cabecalho: ['Produto', 'Faturamento', 'Part.'],
    larguras: { 0: 120 },
    colunasTexto: 1,
    numerosADireita: true,
    compacto: true,
    linhas: itens.map((i) => [i.codigo ? `${i.descricao} (cód. ${i.codigo})${i.selecionado ? ' · selecionado' : ''}` : i.descricao, moeda(i.valor), percentual(i.proporcao)]),
  };
  return { sit: situacao('participacao', 'ok'), planilhas: [planilha], secoes: [secao] };
}

// ---- Evolução de produtos ------------------------------------------------------
const METRICAS_PRODUTO = {
  bruto: { rotulo: 'Faturamento', campo: 'bruto_media_dia', eixo: moedaEixo },
  quantidade: { rotulo: 'Quantidade', campo: 'quantidade_media_dia', eixo: numeroEixo },
  vendas: { rotulo: 'Vendas', campo: 'vendas_media_dia', eixo: numeroEixo },
};

function blocoEvoprod(inst, dados) {
  const p = principal(inst, dados, 'evoprod', 'serie');
  if (!p.ok) return { sit: p.sit, planilhas: [], secoes: [secaoIndisponivel('evoprod', p.sit, inst)] };
  const reg = p.r;
  const f = reg.filtros;
  const def = METRICAS_PRODUTO[reg.parametros.metrica] || METRICAS_PRODUTO.bruto;
  const linhas = p.dados || [];
  const selecionados = reg.parametros.selecionados || [];
  const porCodigo = new Map();
  for (const l of linhas) {
    if (!porCodigo.has(l.codigo)) porCodigo.set(l.codigo, []);
    porCodigo.get(l.codigo).push(l);
  }
  const base = porCodigo.get(selecionados.find((x) => porCodigo.has(x))) || [];
  const nomes = Object.fromEntries(linhas.map((l) => [l.codigo, l.descricao]));
  const planilha = {
    nome: 'Evolução dos Produtos',
    notas: notasPlanilha(inst, 'Evolução de produtos selecionados', [
      `Filtros: ${descreverFiltros(f, { agrupamento: true })}`,
      `Produtos: ${selecionados.map((c) => `${nomes[c] || inst.descricoes[c] || 'código'} (${c})`).join('; ')} · Métrica do gráfico: ${def.rotulo}`,
      'Médias por dia completo; quantidades como registradas no G3 (sem unidade). Célula vazia = sem dados (não é zero).',
    ]),
    colunas: [
      { titulo: 'Código G3', tipo: 'texto', largura: 11 },
      { titulo: 'Descrição', tipo: 'texto', largura: 34 },
      { titulo: 'Início', tipo: 'data', largura: 12 },
      { titulo: 'Fim', tipo: 'data', largura: 12 },
      { titulo: 'Situação', tipo: 'texto', largura: 34 },
      { titulo: 'Dias completos', tipo: 'numero', largura: 10 },
      { titulo: 'Dias no filtro', tipo: 'numero', largura: 10 },
      { titulo: 'Dias com registro', tipo: 'numero', largura: 10 },
      { titulo: 'Quantidade média/dia', tipo: 'decimal3', largura: 13 },
      { titulo: 'Vendas médias/dia', tipo: 'decimal', largura: 12 },
      { titulo: 'Faturamento médio/dia (R$)', tipo: 'decimal', largura: 15 },
      { titulo: 'Quantidade (total)', tipo: 'decimal3', largura: 13 },
      { titulo: 'Vendas (total)', tipo: 'numero', largura: 11 },
      { titulo: 'Faturamento (total, R$)', tipo: 'decimal', largura: 15 },
    ],
    linhas: linhas.map((l) => [
      l.codigo,
      l.descricao,
      l.inicio,
      l.fim,
      situacaoDoGrupo(l.dias_validos, l.dias_calendario).texto,
      num(l.dias_validos),
      num(l.dias_calendario),
      num(l.dias_registrados),
      num(l.quantidade_media_dia),
      num(l.vendas_media_dia),
      num(l.bruto_media_dia),
      num(l.quantidade),
      num(l.vendas),
      num(l.bruto),
    ]),
  };
  const rotulos = base.map((l) => rotuloGrupo(l, f.agrupamento));
  const series = selecionados
    .filter((c) => porCodigo.has(c))
    .map((codigo) => ({
      nome: textoPdf(`${nomes[codigo] || 'código'} (${codigo})`),
      cor: inst.cores[codigo] || COR_SERIE_A,
      valores: porCodigo.get(codigo).map((l) => num(l[def.campo])),
    }));
  const secao = {
    titulo: 'Evolução de produtos selecionados',
    nota: `${descreverFiltros(f, { agrupamento: true })} · ${def.rotulo}: média por dia completo · quantidades sem unidade`,
    grafico: series.length ? { altura: 66, desenhar: (doc, area) => desenharGraficoLinhas(doc, area, { rotulos, series, formatoEixo: def.eixo }) } : undefined,
    texto: series.length ? undefined : [{ texto: 'Sem dados para os produtos selecionados no período.', tom: 'suave' }],
  };
  return { sit: series.length ? situacao('evoprod', 'ok') : situacao('evoprod', 'vazio', 'Sem dados para os produtos selecionados.'), planilhas: [planilha], secoes: [secao] };
}

// ---- Tabela de produtos (todas as linhas; anexo no PDF) ----------------------
function blocoTabela(inst, dados) {
  const p = principal(inst, dados, 'tabela', 'todos');
  if (!p.ok) return { sit: p.sit, planilhas: [], secoes: [secaoIndisponivel('tabela', p.sit, inst)] };
  const reg = p.r;
  const resp = p.dados || {};
  const produtos = resp.produtos || [];
  // MESMO modelo da exportação individual da tabela (mesmas colunas e regras).
  const modelo = montarExportacaoProdutos({
    produtos,
    cobertura: resp.cobertura,
    filtros: reg.filtros,
    busca: reg.parametros.busca,
    ordemRotulo: reg.parametros.ordemRotulo,
    geradoEm: inst.geradoEm,
  });
  const planilha = {
    ...modelo.planilhas[0],
    nome: 'Produtos',
    notas: notasPlanilha(inst, `Tabela de produtos (${plural(produtos.length, 'código')}, todas as páginas)`, [
      `Filtros: ${descreverFiltros(reg.filtros)}${reg.parametros.busca ? ` · Busca: "${reg.parametros.busca}"` : ''} · Ordenação: ${reg.parametros.ordemRotulo}`,
      resp.cobertura ? `Cobertura (base itens): ${plural(resp.cobertura.dias_validos, 'dia completo', 'dias completos')} · ${plural(resp.cobertura.dias_com_dados, 'dia com dados', 'dias com dados')}` : null,
      modelo.pdf.legenda,
    ]),
  };
  const secao = {
    ...modelo.pdf.secoes[0],
    titulo: `Anexo — Detalhamento dos produtos (${plural(produtos.length, 'código')})`,
    nota: `${descreverFiltros(reg.filtros)}${reg.parametros.busca ? ` · Busca: "${reg.parametros.busca}"` : ''} · Ordenação: ${reg.parametros.ordemRotulo} · todas as páginas da tabela`,
    novaPagina: true,
    numerosADireita: true,
    anexo: true,
  };
  const msg = resp.motivo ? MOTIVO_PERIODO[resp.motivo] || 'Período sem dados.' : !produtos.length ? 'Nenhum produto para os filtros da tabela.' : '';
  return { sit: msg ? situacao('tabela', 'vazio', msg) : situacao('tabela', 'ok'), planilhas: [planilha], secoes: [secao], legenda: modelo.pdf.legenda };
}

// ---- Vendas por horário ------------------------------------------------------
const METRICAS_CURVA = {
  bruto: { rotulo: 'Faturamento médio/dia', fmt: moeda, eixo: moedaEixo },
  vendas: { rotulo: 'Vendas médias/dia', fmt: (v) => numero(v, 1), eixo: numeroEixo },
  ticket: { rotulo: 'Ticket médio', fmt: moeda, eixo: moedaEixo },
};

function blocoCurva(inst, dados) {
  const p = principal(inst, dados, 'curva', 'a');
  if (!p.ok) return { sit: p.sit, planilhas: [], secoes: [secaoIndisponivel('curva', p.sit, inst)] };
  const reg = p.r;
  const f = reg.filtros;
  const metrica = reg.parametros.metrica || 'bruto';
  const def = METRICAS_CURVA[metrica];
  const B = referencia(dados, 'curva', 'b');
  const ha = analisarHorarios(p.dados);
  const hb = B.dados ? analisarHorarios(B.dados) : null;
  const faixa = faixaDeHoras(ha.curva, hb ? hb.curva : []);
  const horas = [];
  for (let h = faixa.inicio; h <= faixa.fim; h += 1) horas.push(h);
  const ponto = (hx, h) => (hx ? hx.curva.find((x) => x.hora === h) : null) || null;
  const linhas = horas.map((h) => {
    const a = ponto(ha, h);
    const b = ponto(hb, h);
    const c = hb ? compararValores(a ? a[metrica] : null, b ? b[metrica] : null) : { diferenca: null, variacao: null };
    return [
      `${h}h`,
      a ? num(a.bruto) : null,
      a ? num(a.vendas) : null,
      a ? num(a.ticket) : null,
      a ? num(a.dias) : null,
      a ? num(a.totalVendas) : null,
      b ? num(b.bruto) : null,
      b ? num(b.vendas) : null,
      b ? num(b.ticket) : null,
      b ? num(b.dias) : null,
      num(c.diferenca),
      num(c.variacao),
    ];
  });
  const planilha = {
    nome: 'Vendas por Horário',
    notas: notasPlanilha(inst, 'Distribuição das vendas por horário (média por dia completo, hora de Brasília)', [
      `Filtros: ${descreverFiltros(f, { ref: hb ? reg.ref : null })}`,
      `Métrica exibida: ${def.rotulo} (Diferença e Variação referem-se a ela). Ticket = líquido ÷ vendas da hora; hora sem vendas: ticket vazio (não se aplica).`,
      B.erro ? `Referência (B) indisponível: ${B.erro}` : null,
    ]),
    colunas: [
      { titulo: 'Hora', tipo: 'texto', largura: 7 },
      { titulo: 'A · faturamento médio/dia (R$)', tipo: 'decimal', largura: 16 },
      { titulo: 'A · vendas médias/dia', tipo: 'decimal', largura: 12 },
      { titulo: 'A · ticket médio (R$)', tipo: 'decimal', largura: 12 },
      { titulo: 'A · dias completos', tipo: 'numero', largura: 10 },
      { titulo: 'A · vendas (total)', tipo: 'numero', largura: 10 },
      { titulo: 'B · faturamento médio/dia (R$)', tipo: 'decimal', largura: 16 },
      { titulo: 'B · vendas médias/dia', tipo: 'decimal', largura: 12 },
      { titulo: 'B · ticket médio (R$)', tipo: 'decimal', largura: 12 },
      { titulo: 'B · dias completos', tipo: 'numero', largura: 10 },
      { titulo: `Diferença (${def.rotulo})`, tipo: 'decimal', largura: 15 },
      { titulo: 'Variação', tipo: 'percentual', largura: 10 },
    ],
    linhas,
  };
  const semDias = !ha.diasConsiderados;
  const secao = {
    titulo: 'Distribuição das vendas por horário',
    nota: `${descreverFiltros(f, { ref: hb ? reg.ref : null })} · ${def.rotulo} · média por dia completo, hora de emissão (Brasília)`,
    texto: semDias ? [{ texto: 'Sem dias completos no período.', tom: 'suave' }] : undefined,
    grafico: semDias
      ? undefined
      : {
          altura: 62,
          desenhar: (doc, area) =>
            desenharGraficoColunas(doc, area, {
              rotulos: horas.map((h) => `${h}h`),
              series: [
                { nome: textoPdf(`A · ${intervalo(f.de, f.ate)}`), cor: COR_SERIE_A, valores: horas.map((h) => (ponto(ha, h) ? ponto(ha, h)[metrica] : null)) },
                ...(hb ? [{ nome: textoPdf(`B · ${intervalo(reg.ref.de, reg.ref.ate)}`), cor: COR_SERIE_B, valores: horas.map((h) => (ponto(hb, h) ? ponto(hb, h)[metrica] : null)) }] : []),
              ],
              formatoEixo: def.eixo,
            }),
        },
  };
  const sit = B.erro ? situacao('curva', 'parcial', `Referência (B) indisponível: ${B.erro}`) : semDias ? situacao('curva', 'vazio', 'Sem dias completos no período.') : situacao('curva', 'ok');
  return { sit, planilhas: [planilha], secoes: [secao] };
}

// ---- Mapa de calor -----------------------------------------------------------
const INDICADORES_CALOR = {
  bruto: { rotulo: 'Faturamento médio/dia', legenda: 'faturamento médio/dia', fmt: moeda },
  vendas: { rotulo: 'Vendas médias/dia', legenda: 'vendas médias/dia', fmt: (v) => numero(v, 1) },
  ticket: { rotulo: 'Ticket médio', legenda: 'ticket médio', fmt: moeda },
};

function blocoCalor(inst, dados) {
  const p = principal(inst, dados, 'calor', 'horarios');
  if (!p.ok) return { sit: p.sit, planilhas: [], secoes: [secaoIndisponivel('calor', p.sit, inst)] };
  const reg = p.r;
  const f = reg.filtros;
  const indicador = reg.parametros.indicador || 'bruto';
  const def = INDICADORES_CALOR[indicador];
  const h = analisarHorarios(p.dados);
  const faixa = faixaDeHoras(h.curva);
  const horas = [];
  for (let x = faixa.inicio; x <= faixa.fim; x += 1) horas.push(x);
  const foraFiltro = (dow) => f.dias.length < 7 && !f.dias.includes(dow);
  const situacaoCelula = (linha, hh) => {
    if (!linha.dias) return foraFiltro(linha.dow) ? 'sem dados: dia da semana fora do filtro' : 'sem dados: nenhum dia completo deste dia da semana';
    if (linha.vendas[hh] === 0) return 'sem vendas na hora (zero real; ticket não se aplica)';
    return '';
  };
  const linhas = [];
  for (const linha of h.calor) {
    for (const hh of horas) {
      linhas.push([NOMES_DIA[linha.dow], `${hh}h`, num(linha.dias), linha.dias ? num(linha.bruto[hh]) : null, linha.dias ? num(linha.vendas[hh]) : null, num(linha.ticket[hh]), situacaoCelula(linha, hh)]);
    }
  }
  const planilha = {
    nome: 'Mapa de Calor',
    notas: notasPlanilha(inst, 'Mapa de calor · dia da semana × hora (dias completos)', [
      `Filtros: ${descreverFiltros(f)} · Indicador exibido: ${def.rotulo}`,
      'Faturamento e vendas = total da hora ÷ dias completos daquele dia da semana; ticket = líquido ÷ vendas da hora (razão dos totais). Célula vazia = sem dados ou não se aplica (ver Situação).',
    ]),
    colunas: [
      { titulo: 'Dia da semana', tipo: 'texto', largura: 13 },
      { titulo: 'Hora', tipo: 'texto', largura: 7 },
      { titulo: 'Dias completos', tipo: 'numero', largura: 10 },
      { titulo: 'Faturamento médio/dia (R$)', tipo: 'decimal', largura: 16 },
      { titulo: 'Vendas médias/dia', tipo: 'decimal', largura: 12 },
      { titulo: 'Ticket médio (R$)', tipo: 'decimal', largura: 12 },
      { titulo: 'Situação', tipo: 'texto', largura: 46 },
    ],
    linhas,
  };
  const escala = escalaCalor(h.calor, indicador, horas);
  const semDias = !h.diasConsiderados;
  const secao = {
    titulo: 'Mapa de calor · dia da semana × hora',
    nota: `${descreverFiltros(f)} · Indicador: ${def.rotulo}`,
    texto: semDias ? [{ texto: 'Sem dias completos no período: sem dados (não é zero).', tom: 'suave' }] : undefined,
    grafico: semDias
      ? undefined
      : {
          altura: 66,
          desenhar: (doc, area) =>
            desenharMapaCalor(doc, area, {
              colunas: horas.map((x) => `${x}h`),
              linhas: h.calor.map((linha) => ({
                rotulo: NOMES_DIA_CURTO[linha.dow],
                celulas: horas.map((hh) => {
                  if (!linha.dias) return { tipo: 'sem_dados' };
                  const v = linha[indicador][hh];
                  if (v === null || v === undefined) return { tipo: 'nao_se_aplica' };
                  return { tipo: 'valor', cor: corCalor(v, escala.maximo, escala.minimo) };
                }),
              })),
              rampa: escala.vazio
                ? null
                : {
                    cores: [0, 1, 2, 3, 4, 5].map((k) => corCalor(escala.minimo + ((escala.maximo - escala.minimo) * k) / 5, escala.maximo, escala.minimo)),
                    minimo: textoPdf(def.fmt(escala.minimo)),
                    maximo: textoPdf(def.fmt(escala.maximo)),
                    rotulo: def.legenda,
                  },
              notas: [
                { tipo: 'sem_dados', texto: 'sem dados (dia da semana sem dia completo ou fora do filtro)' },
                ...(indicador === 'ticket' ? [{ tipo: 'nao_se_aplica', texto: 'sem vendas na hora (ticket não se aplica)' }] : []),
              ],
            }),
        },
  };
  return { sit: semDias ? situacao('calor', 'vazio', 'Sem dias completos no período.') : situacao('calor', 'ok'), planilhas: [planilha], secoes: [secao] };
}

// ---- Produtos por horário ----------------------------------------------------
function blocoProdhora(inst, dados) {
  const reg = inst.registro.prodhora;
  const modo = reg && reg.parametros ? reg.parametros.modo : 'escolhidos';
  const p = principal(inst, dados, 'prodhora', modo === 'top' ? 'top' : 'escolhidos');
  if (!p.ok) return { sit: p.sit, planilhas: [], secoes: [secaoIndisponivel('prodhora', p.sit, inst)] };
  const f = reg.filtros;
  if (modo === 'top') {
    const linhasTop = topPorHora(p.dados);
    const planilha = {
      nome: 'Produtos por Horário',
      notas: notasPlanilha(inst, 'Produtos por horário · mais vendidos por hora (top 3)', [
        `Filtros: ${descreverFiltros(f)} · Modo: mais vendidos por hora`,
        'Faturamento do ITEM (nunca o total da venda), média por dia completo.',
      ]),
      colunas: [
        { titulo: 'Hora', tipo: 'texto', largura: 7 },
        { titulo: 'Posição', tipo: 'numero', largura: 8 },
        { titulo: 'Código G3', tipo: 'texto', largura: 11 },
        { titulo: 'Descrição', tipo: 'texto', largura: 36 },
        { titulo: 'Faturamento médio/dia (R$)', tipo: 'decimal', largura: 16 },
        { titulo: 'Quantidade média/dia', tipo: 'decimal3', largura: 13 },
        { titulo: 'Vendas médias/dia', tipo: 'decimal', largura: 12 },
      ],
      linhas: linhasTop.flatMap((l) => l.itens.map((it) => [`${l.hora}h`, it.posicao, it.codigo, it.descricao, num(it.mediaBruto), num(it.mediaQuantidade), num(it.mediaVendas)])),
    };
    const secao = {
      titulo: 'Produtos por horário · mais vendidos por hora',
      nota: `${descreverFiltros(f)} · Top 3 por hora (faturamento do item, média por dia completo)`,
      cabecalho: ['Hora', '1º', 'Fat. médio/dia', '2º', 'Fat. médio/dia', '3º', 'Fat. médio/dia'],
      larguras: { 0: 14, 1: 62, 3: 62, 5: 62 },
      colunasTexto: 1,
      compacto: true,
      linhas: linhasTop.map((l) => [`${l.hora}h`, ...[0, 1, 2].flatMap((i) => (l.itens[i] ? [`${l.itens[i].descricao} (${l.itens[i].codigo})`, moeda(l.itens[i].mediaBruto)] : ['—', '—']))]),
      vazio: 'Sem dias completos com vendas conciliadas no período.',
    };
    return { sit: linhasTop.length ? situacao('prodhora', 'ok') : situacao('prodhora', 'vazio', 'Sem dias completos com vendas conciliadas.'), planilhas: [planilha], secoes: [secao] };
  }
  const B = referencia(dados, 'prodhora', 'referencia');
  const curvas = curvasProdutoHorario(p.dados);
  const curvasB = B.dados ? curvasProdutoHorario(B.dados) : null;
  const selecionados = reg.parametros.selecionados || [];
  const unico = reg.parametros.unico;
  // Mesma faixa de horas do gráfico da tela (da 1ª à última hora com vendas).
  const horasComVenda = [];
  for (const c of [...curvas.values(), ...(curvasB ? curvasB.values() : [])]) for (const [hh, v] of c.horas) if ((v.vendas || 0) > 0) horasComVenda.push(hh);
  const ini = horasComVenda.length ? Math.min(...horasComVenda) : 6;
  const fim = horasComVenda.length ? Math.max(...horasComVenda) : 22;
  const linhas = [];
  const empilhar = (serie, mapa) => {
    for (const codigo of selecionados) {
      const c = mapa.get(codigo);
      if (!c) continue;
      for (const [hora, x] of [...c.horas.entries()].sort((a, b) => a[0] - b[0])) {
        if (hora < ini || hora > fim) continue;
        linhas.push([serie, codigo, c.descricao, `${hora}h`, num(x.participacao), num(x.mediaBruto), num(x.vendas), num(x.participacaoHorario), num(c.dias)]);
      }
    }
  };
  empilhar('A', curvas);
  if (curvasB) empilhar('B', curvasB);
  const planilha = {
    nome: 'Produtos por Horário',
    notas: notasPlanilha(inst, 'Produtos por horário · produtos escolhidos', [
      `Filtros: ${descreverFiltros(f, { ref: curvasB ? reg.ref : null })} · Modo: produtos escolhidos${curvasB ? ` · B = ${unico} na referência` : ''}`,
      '% do produto = faturamento do produto na hora ÷ total do próprio produto no recorte. % no horário = faturamento do produto ÷ faturamento de todos os itens na hora.',
      B.erro ? `Referência (B) indisponível: ${B.erro}` : null,
    ]),
    colunas: [
      { titulo: 'Série', tipo: 'texto', largura: 7 },
      { titulo: 'Código G3', tipo: 'texto', largura: 11 },
      { titulo: 'Descrição', tipo: 'texto', largura: 34 },
      { titulo: 'Hora', tipo: 'texto', largura: 7 },
      { titulo: '% do produto', tipo: 'percentual', largura: 12 },
      { titulo: 'Faturamento médio/dia na hora (R$)', tipo: 'decimal', largura: 18 },
      { titulo: 'Vendas na hora', tipo: 'numero', largura: 11 },
      { titulo: '% no horário', tipo: 'percentual', largura: 12 },
      { titulo: 'Dias completos', tipo: 'numero', largura: 10 },
    ],
    linhas,
  };
  const horas = [];
  for (let hh = ini; hh <= fim; hh += 1) horas.push(hh);
  const series = selecionados
    .filter((c) => curvas.has(c))
    .map((codigo) => ({ nome: textoPdf(`${curvas.get(codigo).descricao} (${codigo})`), cor: inst.cores[codigo] || COR_SERIE_A, valores: horas.map((hh) => (curvas.get(codigo).horas.get(hh) ? curvas.get(codigo).horas.get(hh).participacao : null)) }));
  if (curvasB && unico && curvasB.has(unico)) {
    series.push({ nome: textoPdf(`${curvasB.get(unico).descricao} (${unico}) · B ${intervalo(reg.ref.de, reg.ref.ate)}`), cor: inst.cores[unico] || COR_SERIE_B, tracejado: true, valores: horas.map((hh) => (curvasB.get(unico).horas.get(hh) ? curvasB.get(unico).horas.get(hh).participacao : null)) });
  }
  const semDias = [...curvas.values()].every((c) => !c.dias);
  const secao = {
    titulo: 'Produtos por horário · produtos escolhidos',
    nota: `${descreverFiltros(f, { ref: curvasB ? reg.ref : null })} · % do produto = faturamento na hora ÷ total do próprio produto no recorte${B.erro ? ` · Referência indisponível: ${B.erro}` : ''}`,
    texto: semDias ? [{ texto: 'Sem dias completos com vendas conciliadas no período.', tom: 'suave' }] : undefined,
    grafico: semDias ? undefined : { altura: 62, desenhar: (doc, area) => desenharGraficoLinhas(doc, area, { rotulos: horas.map((hh) => `${hh}h`), series, formatoEixo: percentualEixo }) },
  };
  const sit = B.erro ? situacao('prodhora', 'parcial', `Referência (B) indisponível: ${B.erro}`) : semDias ? situacao('prodhora', 'vazio', 'Sem dias completos com vendas conciliadas.') : situacao('prodhora', 'ok');
  return { sit, planilhas: [planilha], secoes: [secao] };
}

// ---- Comparativo -------------------------------------------------------------
function blocoComparativo(inst, dados) {
  const p = principal(inst, dados, 'comparativo', 'comparar');
  if (!p.ok) return { sit: p.sit, planilhas: [], secoes: [secaoIndisponivel('comparativo', p.sit, inst)] };
  const reg = p.r;
  const d = p.dados;
  const modo = reg.parametros.rotuloModo || reg.parametros.modo;
  const dias = reg.parametros.periodos ? reg.parametros.periodos.dias : null;
  const cabecalho = [
    `Modo: ${modo} · A: ${intervalo(d.periodos.a.de, d.periodos.a.ate)} (${numero(d.periodos.a.dias_filtrados)} dias no filtro) · B: ${intervalo(d.periodos.b.de, d.periodos.b.ate)} (${numero(d.periodos.b.dias_filtrados)} dias no filtro) · Dias: ${nomeDosDias(dias)}`,
    `Critério: ${d.criterio === 'pareado' ? `pareado · ${numero(d.pareamento ? d.pareamento.pares_validos_vendas : 0)} de ${numero(d.pareamento ? d.pareamento.pares : 0)} pares válidos${d.pareamento && d.pareamento.mesmo_dia_semana ? ' · mesmos dias da semana' : ''}` : 'média por dia válido'} · Cobertura A ${percentual(d.geral.a.cobertura, 0)} · B ${percentual(d.geral.b.cobertura, 0)} (mínimo ${percentual(d.cobertura_minima, 0)})`,
    d.geral.comparavel ? null : `NÃO COMPARÁVEL: ${MOTIVO_COMPARACAO[d.geral.motivo] || d.geral.motivo} As variações não são exibidas.`,
    ...(d.avisos || []).map((a) => `Aviso: ${AVISO_COMPARACAO[a] || a}`),
    'Variação = (A − B) ÷ B. Totais só no critério pareado; durações diferentes comparam médias por dia válido.',
  ].filter(Boolean);
  const linhasGerais = INDICADORES_COMPARATIVO.map((def) => ({ def, l: linhaComparativoGeral(d, def) }));
  const planilhaGeral = {
    nome: 'Comparativos Gerais',
    notas: notasPlanilha(inst, 'Comparativo entre períodos · geral (base vendas)', cabecalho),
    colunas: [
      { titulo: 'Indicador', tipo: 'texto', largura: 30 },
      { titulo: 'A', tipo: 'decimal', largura: 15 },
      { titulo: 'B', tipo: 'decimal', largura: 15 },
      { titulo: 'Diferença (A − B)', tipo: 'decimal', largura: 16 },
      { titulo: 'Variação', tipo: 'percentual', largura: 10 },
      { titulo: 'Observação', tipo: 'texto', largura: 44 },
    ],
    linhas: linhasGerais.map(({ def, l }) => [def.rotulo, tipado(l.a, TIPO_XLSX[def.tipo]), tipado(l.b, TIPO_XLSX[def.tipo]), tipado(l.diferenca, TIPO_XLSX[def.tipo]), tipado(l.variacao, 'percentual'), l.observacao]),
  };
  const produtos = d.produtos || [];
  const planilhaProdutos = {
    nome: 'Comparativos por Produto',
    notas: notasPlanilha(inst, 'Comparativo entre períodos · produtos selecionados (base itens, média por dia válido)', [
      cabecalho[0],
      'Descontos existem só por venda no G3: não são atribuídos a produtos. Quantidades como registradas (sem unidade).',
    ]),
    colunas: [
      { titulo: 'Código G3', tipo: 'texto', largura: 11 },
      { titulo: 'Descrição', tipo: 'texto', largura: 34 },
      { titulo: 'A · faturamento/dia (R$)', tipo: 'decimal', largura: 15 },
      { titulo: 'B · faturamento/dia (R$)', tipo: 'decimal', largura: 15 },
      { titulo: 'Diferença (R$/dia)', tipo: 'decimal', largura: 15 },
      { titulo: 'Variação fat./dia', tipo: 'percentual', largura: 12 },
      { titulo: 'Preço médio A (R$)', tipo: 'decimal', largura: 13 },
      { titulo: 'Preço médio B (R$)', tipo: 'decimal', largura: 13 },
      { titulo: 'Participação A', tipo: 'percentual', largura: 12 },
      { titulo: 'Participação B', tipo: 'percentual', largura: 12 },
      { titulo: 'Comparável', tipo: 'texto', largura: 11 },
      { titulo: 'Motivo', tipo: 'texto', largura: 40 },
    ],
    linhas: produtos.map((x) => [
      x.codigo,
      x.descricao,
      num(x.a && x.a.media_diaria_bruto),
      num(x.b && x.b.media_diaria_bruto),
      x.comparavel && x.diferencas ? num(x.diferencas.media_diaria_bruto) : null,
      x.comparavel && x.variacoes ? num(x.variacoes.media_diaria_bruto) : null,
      num(x.a && x.a.preco_medio),
      num(x.b && x.b.preco_medio),
      num(x.a && x.a.participacao),
      num(x.b && x.b.participacao),
      x.comparavel ? 'sim' : 'não',
      x.comparavel ? '' : MOTIVO_COMPARACAO[x.motivo] || x.motivo || '',
    ]),
  };
  const fmtTipo = (def) => FMT[def.tipo];
  const secoes = [
    {
      titulo: 'Comparativo entre períodos · geral (base vendas)',
      nota: cabecalho[0],
      texto: cabecalho.slice(1, -1).map((t) => ({ texto: t, tom: t.startsWith('NÃO COMPARÁVEL') ? 'aviso' : 'suave' })),
      cabecalho: ['Indicador', 'A', 'B', 'Diferença', 'Variação', 'Observação'],
      larguras: { 0: 60, 5: 80 },
      colunasTexto: 1,
      centralizarColunas: [1, 2, 3, 4],
      numerosADireita: true,
      compacto: true,
      linhas: linhasGerais.map(({ def, l }) => [
        def.rotulo,
        ouSemDados(l.a, fmtTipo(def)),
        ouSemDados(l.b, fmtTipo(def)),
        def.tipo === 'percentual' ? (l.diferenca === null ? '—' : pontosPercentuais(l.diferenca)) : difPdf(l.diferenca, fmtTipo(def)),
        variacaoPdf(l.variacao),
        { texto: l.observacao, tom: 'vazio' },
      ]),
    },
    {
      titulo: 'Comparativo entre períodos · produtos selecionados',
      nota: 'Base itens · média por dia válido · descontos não são atribuídos a produtos',
      cabecalho: ['Produto', 'A /dia', 'B /dia', 'Var. fat.', 'Preço médio A', 'Part. A', 'Part. B'],
      larguras: { 0: 95 },
      colunasTexto: 1,
      numerosADireita: true,
      compacto: true,
      linhas: produtos.map((x) => [
        `${x.descricao} (cód. ${x.codigo})${x.comparavel ? '' : ` — ${MOTIVO_COMPARACAO[x.motivo] || x.motivo || 'não comparável'}`}`,
        ouSemDados(x.a && x.a.media_diaria_bruto, moeda),
        ouSemDados(x.b && x.b.media_diaria_bruto, moeda),
        x.comparavel && x.variacoes ? variacaoPdf(x.variacoes.media_diaria_bruto) : '—',
        x.a && x.a.preco_medio !== null && x.a.preco_medio !== undefined ? moeda(x.a.preco_medio) : '—',
        percentual(x.a && x.a.participacao, 2),
        percentual(x.b && x.b.participacao, 2),
      ]),
      vazio: 'Nenhum produto selecionado para comparar.',
    },
  ];
  return { sit: situacao('comparativo', d.geral.comparavel ? 'ok' : 'vazio', d.geral.comparavel ? '' : `Não comparável: ${MOTIVO_COMPARACAO[d.geral.motivo] || d.geral.motivo}`), planilhas: [planilhaGeral, planilhaProdutos], secoes };
}

function secaoIndisponivel(bloco, sit) {
  return { titulo: TITULO[bloco], texto: [{ texto: `${sit.estado === 'erro' ? 'ERRO ao carregar' : 'Indisponível'}: ${sit.mensagem}`, tom: sit.estado === 'erro' ? 'aviso' : 'suave' }] };
}

// ---------------------------------------------------------------------------
// Montagem final
// ---------------------------------------------------------------------------
const ROTULO_ESTADO = { ok: 'completo', parcial: 'parcial', vazio: 'sem dados', indisponivel: 'indisponível', erro: 'ERRO' };

function parametrosTexto(bloco, r) {
  if (!r || !r.parametros) return '';
  const p = r.parametros;
  switch (bloco) {
    case 'evolucao':
      return `métrica: ${(METRICAS_SERIE[p.metrica] || {}).rotulo || p.metrica}`;
    case 'curva':
      return `métrica: ${(METRICAS_CURVA[p.metrica] || {}).rotulo || p.metrica}`;
    case 'ranking':
      return `Top ${p.rankingTop} por ${(ORDENS_RANKING[p.ordem] || {}).rotulo || p.ordem}`;
    case 'evoprod':
      return `métrica: ${(METRICAS_PRODUTO[p.metrica] || {}).rotulo || p.metrica} · produtos: ${(p.selecionados || []).join(', ') || 'nenhum'}`;
    case 'tabela':
      return `ordenação: ${p.ordemRotulo}${p.busca ? ` · busca: "${p.busca}"` : ''} · todas as páginas (tela: ${p.porPagina} por página)`;
    case 'calor':
      return `indicador: ${(INDICADORES_CALOR[p.indicador] || {}).rotulo || p.indicador}`;
    case 'prodhora':
      return p.modo === 'top' ? 'modo: mais vendidos por hora' : `modo: produtos escolhidos${p.compararB && p.unico ? ` · comparação de ${p.unico} com a referência` : ''}`;
    case 'comparativo':
      return `modo: ${p.rotuloModo || p.modo}`;
    case 'resumo':
      return `variação: ${ROTULO_REFERENCIA[p.referencia] || p.referencia}`;
    default:
      return '';
  }
}

export function montarExportacaoGeral(inst, dados) {
  const st = inst.status || {};
  const g = inst.geral || {};
  const resultados = {
    resumo: blocoResumo(inst, dados),
    evolucao: blocoEvolucao(inst, dados),
    semana: blocoSemana(inst, dados),
    ranking: blocoRanking(inst, dados),
    participacao: blocoParticipacao(inst, dados),
    evoprod: blocoEvoprod(inst, dados),
    tabela: blocoTabela(inst, dados),
    curva: blocoCurva(inst, dados),
    calor: blocoCalor(inst, dados),
    prodhora: blocoProdhora(inst, dados),
    comparativo: blocoComparativo(inst, dados),
  };
  const situacoes = BLOCOS_EXPORTACAO.map(([b]) => resultados[b].sit);
  // Aba de bloco sem dados / indisponível / com erro diz isso no próprio topo.
  for (const [b] of BLOCOS_EXPORTACAO) {
    const sit = resultados[b].sit;
    if (sit.estado === 'ok') continue;
    const linha = { texto: `SITUAÇÃO: ${ROTULO_ESTADO[sit.estado].toUpperCase()}${sit.mensagem ? ` — ${sit.mensagem}` : ''}`, destaque: sit.estado === 'erro' || sit.estado === 'parcial' };
    for (const pl of resultados[b].planilhas) pl.notas = pl.notas && pl.notas.length ? [pl.notas[0], linha, ...pl.notas.slice(1)] : [linha];
  }
  const comErro = situacoes.filter((s) => s.estado === 'erro' || s.estado === 'parcial');
  const completo = comErro.length === 0;
  const avisoIncompleto = completo
    ? null
    : `ATENÇÃO: exportação INCOMPLETA — ${comErro.map((s) => `${s.titulo} (${ROTULO_ESTADO[s.estado]}: ${s.mensagem})`).join('; ')}.`;

  const parcial = (() => {
    const rel = (st.relatorios || []).find((r) => r.layout === 'faturamento_geral');
    if (!rel || !rel.dia_parcial || (st.padrao_ate && rel.dia_parcial <= st.padrao_ate)) return null;
    return { dia: rel.dia_parcial, hora: rel.hora_limite };
  })();
  const ultimaImportacao = st.ultima_importacao_em ? dataHora(st.ultima_importacao_em) : 'nenhuma importação confirmada';
  const linhaDados = `Última importação do G3: ${ultimaImportacao} · Dados completos até ${st.padrao_ate ? data(st.padrao_ate) : '—'}${parcial ? ` · Parcial de ${data(parcial.dia)}${parcial.hora ? ` até ${parcial.hora}` : ''}` : ''}`;
  const periodoRotulo = intervalo(g.de, g.ate);

  // Filtros e Cobertura (todas as abas e o PDF apontam para cá).
  const linhasFiltros = BLOCOS_EXPORTACAO.map(([b, titulo]) => {
    const r = inst.registro[b];
    const f = r && r.filtros;
    const sit = resultados[b].sit;
    return [
      titulo,
      f ? intervalo(f.de, f.ate) : b === 'comparativo' && r && r.parametros.periodos ? `A ${intervalo(r.parametros.periodos.a.de, r.parametros.periodos.a.ate)} × B ${intervalo(r.parametros.periodos.b.de, r.parametros.periodos.b.ate)}` : '—',
      f ? nomeDosDias(f.dias) : r && r.parametros.periodos ? nomeDosDias(r.parametros.periodos.dias) : '—',
      f && ['evolucao', 'evoprod'].includes(b) ? ROTULO_AGRUPAMENTO[f.agrupamento] : '',
      r && r.ref ? intervalo(r.ref.de, r.ref.ate) : '',
      f ? (f.proprios && f.proprios.length ? `próprio (${f.proprios.map((c) => ROTULO_CAMPO[c] || c).join(', ')})` : 'gerais') : b === 'comparativo' ? 'próprio do bloco' : '—',
      parametrosTexto(b, r),
      ROTULO_ESTADO[sit.estado],
      sit.mensagem || '',
    ];
  });
  const planilhaFiltros = {
    nome: 'Filtros e Cobertura',
    notas: [
      { texto: 'BI Gerencial · Filtros, parâmetros e situação de cada bloco', destaque: true },
      `Filtros gerais: período ${periodoRotulo} · dias: ${nomeDosDias(g.dias)} · agrupamento: ${ROTULO_AGRUPAMENTO[g.agrupamento] || '—'} · variação nos cartões: ${ROTULO_REFERENCIA[g.referencia] || g.referencia}`,
      linhaDados,
      resultados.resumo.cobertura ? `Cobertura do período geral: ${resultados.resumo.cobertura.texto}` : null,
      resultados.resumo.cobertura && resultados.resumo.cobertura.fora ? resultados.resumo.cobertura.fora : null,
      `Produtos selecionados: ${inst.selecionados.length ? inst.selecionados.map((c) => `${inst.descricoes[c] || 'código'} (${c})`).join('; ') : 'nenhum'}`,
      completo ? 'Situação da exportação: COMPLETA (todos os blocos carregados; blocos "sem dados"/"indisponível" refletem o próprio painel).' : avisoIncompleto,
      `Gerado em ${inst.geradoEm}`,
    ].filter(Boolean),
    colunas: [
      { titulo: 'Bloco', tipo: 'texto', largura: 32 },
      { titulo: 'Período', tipo: 'texto', largura: 34 },
      { titulo: 'Dias da semana', tipo: 'texto', largura: 22 },
      { titulo: 'Agrupamento', tipo: 'texto', largura: 12 },
      { titulo: 'Referência (B)', tipo: 'texto', largura: 24 },
      { titulo: 'Origem dos filtros', tipo: 'texto', largura: 24 },
      { titulo: 'Parâmetros do bloco', tipo: 'texto', largura: 50 },
      { titulo: 'Situação', tipo: 'texto', largura: 13 },
      { titulo: 'Detalhe', tipo: 'texto', largura: 50 },
    ],
    linhas: linhasFiltros,
  };

  const resumo = resultados.resumo;
  const planilhas = [
    ...resumo.planilhas,
    ...resultados.evolucao.planilhas,
    ...resultados.semana.planilhas,
    ...resultados.ranking.planilhas,
    ...resultados.participacao.planilhas,
    ...resultados.tabela.planilhas,
    ...resultados.evoprod.planilhas,
    ...resultados.curva.planilhas,
    ...resultados.calor.planilhas,
    ...resultados.prodhora.planilhas,
    ...resultados.comparativo.planilhas,
    planilhaFiltros,
    ...(resumo.calendario && inst.registro.resumo ? [planilhaCalendario(inst, resumo.calendario, inst.registro.resumo.filtros)] : []),
  ];
  if (!resumo.planilhas.length) {
    planilhas.unshift({
      nome: 'Resumo Gerencial',
      notas: [{ texto: 'BI Gerencial · Resumo gerencial', destaque: true }, `Período: ${periodoRotulo}`, `Gerado em ${inst.geradoEm}`],
      colunas: [
        { titulo: 'Situação', tipo: 'texto', largura: 20 },
        { titulo: 'Detalhe', tipo: 'texto', largura: 80 },
      ],
      linhas: [[ROTULO_ESTADO[resumo.sit.estado], resumo.sit.mensagem]],
    });
  }

  const secaoSituacao = {
    titulo: 'Situação dos blocos nesta exportação',
    compacto: true,
    cabecalho: ['Bloco', 'Situação', 'Detalhe'],
    larguras: { 0: 70, 1: 28 },
    colunasTexto: 3,
    linhas: situacoes.map((s) => [s.titulo, { texto: ROTULO_ESTADO[s.estado], tom: s.estado === 'erro' || s.estado === 'parcial' ? 'falta' : s.estado === 'ok' ? null : 'vazio' }, s.mensagem || '']),
  };
  const capa = {
    titulo: `Período analisado: ${periodoRotulo}`,
    texto: [
      { texto: linhaDados, tom: 'forte' },
      { texto: `Filtros gerais: dias ${nomeDosDias(g.dias)} · agrupamento por ${ROTULO_AGRUPAMENTO[g.agrupamento] || '—'} · variação nos cartões ${ROTULO_REFERENCIA[g.referencia] || g.referencia}`, tom: 'suave' },
      { texto: `Produtos selecionados: ${inst.selecionados.length ? inst.selecionados.map((c) => `${inst.descricoes[c] || 'código'} (${c})`).join('; ') : 'nenhum'}`, tom: 'suave' },
      avisoIncompleto
        ? { texto: avisoIncompleto, tom: 'aviso' }
        : { texto: `Exportação completa: os ${situacoes.length} blocos do painel foram carregados (blocos "sem dados" ou "indisponível" refletem o próprio painel; ver a página de filtros).`, tom: 'suave' },
    ].filter(Boolean),
  };
  const r = resultados;
  const secoesPdf = [
    capa,
    ...r.resumo.secoes,
    // Quadro de situação logo no início só quando há bloco com erro.
    ...(completo ? [] : [secaoSituacao]),
    ...r.evolucao.secoes.map((x) => ({ ...x, novaPagina: true })),
    ...r.semana.secoes,
    ...r.ranking.secoes.map((x) => ({ ...x, novaPagina: true })),
    ...r.participacao.secoes,
    ...r.evoprod.secoes.map((x) => ({ ...x, novaPagina: true })),
    ...r.curva.secoes,
    ...r.calor.secoes.map((x) => ({ ...x, novaPagina: true })),
    ...r.prodhora.secoes,
    ...r.comparativo.secoes.map((x, i) => (i === 0 ? { ...x, novaPagina: true } : x)),
    {
      titulo: 'Filtros e parâmetros de cada bloco',
      novaPagina: true,
      compacto: true,
      cabecalho: ['Bloco', 'Período', 'Dias', 'Referência (B)', 'Filtros', 'Parâmetros', 'Situação'],
      larguras: { 0: 42, 1: 46, 2: 34, 3: 34, 4: 30, 5: 60 },
      colunasTexto: 7,
      linhas: linhasFiltros.map((l) => [l[0], l[1], l[2], l[4] || '—', l[5], l[6], l[7]]),
    },
    ...r.tabela.secoes,
  ];

  const pdf = {
    secoes: secoesPdf.map(sanitizarSecao),
    legenda: textoPdf(
      'Sem dados nunca é zero: dias parciais, sem importação, com pendências ou cobertura não confirmada ficam fora das médias e são sinalizados; variações só aparecem quando a comparação é válida. Faturamento de produtos = valor bruto do item (vendas conciliadas); descontos existem só por venda e não são atribuídos a produtos; quantidades como registradas no G3 (sem unidade). Sem custo, lucro ou margem.'
    ),
  };

  return {
    titulo: 'BI Gerencial',
    periodoRotulo,
    nomeArquivo: `bi-gerencial_${g.de}_a_${g.ate}`,
    geradoEm: inst.geradoEm,
    linhaCabecalho: textoPdf(`Período: ${periodoRotulo}   ·   ${linhaDados}`),
    filtros: {},
    planilhas,
    pdf,
    situacoes,
    completo,
  };
}

function sanitizarSecao(s) {
  const celula = (c) => (c && typeof c === 'object' ? { ...c, texto: textoPdf(c.texto) } : textoPdf(c));
  return {
    ...s,
    titulo: s.titulo ? textoPdf(s.titulo) : s.titulo,
    nota: s.nota ? textoPdf(s.nota) : s.nota,
    texto: s.texto ? s.texto.map((t) => (t && typeof t === 'object' ? { ...t, texto: textoPdf(t.texto) } : textoPdf(t))) : s.texto,
    cabecalho: s.cabecalho ? s.cabecalho.map(textoPdf) : s.cabecalho,
    linhas: s.linhas ? s.linhas.map((l) => l.map(celula)) : s.linhas,
    vazio: s.vazio ? textoPdf(s.vazio) : s.vazio,
  };
}

// Utilitário para o nome do arquivo/feedback: há bloco com erro?
export function resumoSituacao(situacoes) {
  const erros = situacoes.filter((s) => s.estado === 'erro' || s.estado === 'parcial');
  return { completo: erros.length === 0, erros };
}

