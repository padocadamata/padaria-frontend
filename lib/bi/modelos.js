// BI Gerencial -- transformação das respostas das RPCs em dados de tela
// (funções PURAS, testáveis sem React/Recharts).
//
// Nenhuma função aqui cria valor: ausência continua null (lacuna no
// gráfico, "sem dados" no texto) e zero só aparece quando a RPC devolveu
// zero de verdade (dia completo sem vendas).

import { ORDEM_SEMANA, NOMES_DIA_CURTO, diaDaSemana } from './datas.js';
import { dataCurta } from './formatos.js';

const num = (v) => (v === null || v === undefined ? null : Number(v));

// Classes de dia que ficam FORA das médias e são marcadas nos gráficos.
// Cada situação tem marca própria (faixa de cor e legenda distintas):
//  parcial -> dia parcial / com pendências / sem conciliação
//  nc      -> cobertura não confirmada
//  lacuna  -> sem importação (lacuna, nunca zero)
//  semop   -> sem operação
const MARCAS = {
  parcial: 'parcial',
  com_pendencias: 'parcial',
  sem_conciliacao: 'parcial',
  cobertura_nao_confirmada: 'nc',
  sem_importacao: 'lacuna',
  sem_operacao: 'semop',
};

export function marcaDoDia(classe) {
  return MARCAS[classe] || null;
}

// Situação de um dia em texto (tooltips): distingue dia completo com
// vendas, completo SEM vendas (zero real), parcial, sem importação,
// cobertura não confirmada, pendências, sem conciliação e sem operação.
export function situacaoDoDia(classe, horaLimite = null) {
  const hora = horaLimite ? String(horaLimite).slice(0, 5) : null;
  switch (classe) {
    case 'completo':
      return { texto: 'dia completo', valido: true };
    case 'completo_sem_vendas':
      return { texto: 'dia completo sem vendas (zero real)', valido: true };
    case 'parcial':
      return { texto: `dia parcial${hora ? ` (dados até ${hora})` : ''}: fora das médias`, valido: false };
    case 'com_pendencias':
      return { texto: 'dia com pendências de importação: fora das médias', valido: false };
    case 'sem_conciliacao':
      return { texto: 'dia sem conciliação dos itens: fora das médias', valido: false };
    case 'cobertura_nao_confirmada':
      return { texto: 'cobertura não confirmada: fora das médias', valido: false };
    case 'sem_importacao':
      return { texto: 'sem importação: lacuna, não é zero', valido: false };
    case 'sem_operacao':
      return { texto: 'sem operação', valido: false };
    case 'pre_operacao':
      return { texto: 'antes do início da operação', valido: false };
    case 'futuro':
      return { texto: 'data futura', valido: false };
    default:
      return { texto: classe ? String(classe) : 'sem dados', valido: false };
  }
}

// Situação de um GRUPO (semana/mês) ou de um ponto de produto: quantos dias
// completos entraram na média.
export function situacaoDoGrupo(diasValidos, diasCalendario) {
  const v = Number(diasValidos || 0);
  const c = Number(diasCalendario || 0);
  if (!v) return { texto: 'sem dia completo: sem dados (não é zero)', valido: false };
  if (c && v < c) return { texto: `média de ${v} de ${c} dias (demais fora das médias)`, valido: true };
  return { texto: `média de ${v} ${v === 1 ? 'dia completo' : 'dias completos'}`, valido: true };
}

// Comparação de UM ponto (tooltip): diferença e variação só quando os dois
// lados têm valor válido. Variação = (A − B) ÷ B; B = 0 -> sem variação
// percentual (divisão por zero), mas a diferença absoluta é real.
export function compararValores(a, b) {
  const va = num(a);
  const vb = num(b);
  if (va === null || vb === null || !Number.isFinite(va) || !Number.isFinite(vb)) {
    return { diferenca: null, variacao: null, motivo: va === null && vb === null ? 'sem_dados' : va === null ? 'sem_a' : 'sem_b' };
  }
  const diferenca = va - vb;
  if (vb === 0) return { diferenca, variacao: null, motivo: 'base_zero' };
  return { diferenca, variacao: diferenca / Math.abs(vb), motivo: null };
}

export const MOTIVO_PONTO = {
  sem_dados: 'sem dados válidos nos dois períodos',
  sem_a: 'sem dado válido no período A',
  sem_b: 'sem dado válido no período B',
  base_zero: 'referência zero: variação percentual não se aplica',
};

// ---------------------------------------------------------------------------
// Série de faturamento (bi_serie_v2). Os pontos usam SEMPRE a base de dias
// completos (médias diárias): no agrupamento por dia, o dia completo vale o
// próprio valor e o dia parcial/sem importação vira lacuna (null).
// ---------------------------------------------------------------------------
export const METRICAS_SERIE = {
  bruto: { rotulo: 'Bruto', campo: 'media_diaria_bruto', tipo: 'moeda' },
  liquido: { rotulo: 'Líquido', campo: 'media_diaria_liquido', tipo: 'moeda' },
  vendas: { rotulo: 'Vendas', campo: 'media_diaria_vendas', tipo: 'numero' },
  ticket: { rotulo: 'Ticket médio', campo: 'ticket_media', tipo: 'moeda' },
  descontos: { rotulo: 'Descontos', campo: 'media_diaria_descontos', tipo: 'moeda' },
};

export function rotuloGrupo(linha, agrupamento) {
  if (agrupamento === 'mes') {
    const [a, m] = String(linha.inicio).split('-');
    return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${a.slice(2)}`;
  }
  if (agrupamento === 'semana') return `sem ${dataCurta(linha.inicio)}`;
  return dataCurta(linha.inicio);
}

// Valor REGISTRADO (inclui dia parcial) de cada métrica -- só para o
// tooltip ("registrado até 12:44"), nunca para o traço do gráfico.
const CAMPO_REGISTRADO = { bruto: 'bruto', liquido: 'liquido', vendas: 'vendas', ticket: 'ticket', descontos: 'descontos' };

export function pontosSerie(linhas, metrica, agrupamento) {
  const def = METRICAS_SERIE[metrica] || METRICAS_SERIE.bruto;
  return (linhas || []).map((l) => ({
    chave: l.inicio,
    inicio: l.inicio,
    rotulo: rotuloGrupo(l, agrupamento),
    rotuloLongo: l.rotulo,
    valor: num(l[def.campo]),
    registrado: num(l[CAMPO_REGISTRADO[metrica] || 'bruto']),
    marca: agrupamento === 'dia' ? marcaDoDia(l.classe) : null,
    classe: l.classe || null,
    horaLimite: l.hora_limite || null,
    diasValidos: num(l.dias_validos),
    diasCalendario: num(l.dias_calendario),
    cobertura: l.cobertura,
  }));
}

// Junta A e B por POSIÇÃO (1º grupo de A com o 1º de B...), como o
// critério pareado. Grupos a mais de um dos lados ficam sem par (null).
export function juntarSeries(pontosA, pontosB) {
  const n = Math.max(pontosA.length, pontosB ? pontosB.length : 0);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = pontosA[i];
    const b = pontosB ? pontosB[i] : undefined;
    out.push({
      indice: i,
      rotulo: a ? a.rotulo : b ? b.rotulo : '',
      rotuloA: a ? a.rotuloLongo || a.rotulo : null,
      rotuloB: b ? b.rotuloLongo || b.rotulo : null,
      inicioA: a ? a.inicio || null : null,
      inicioB: b ? b.inicio || null : null,
      a: a ? a.valor : null,
      b: b ? b.valor : null,
      registradoA: a && a.registrado !== undefined ? a.registrado : null,
      registradoB: b && b.registrado !== undefined ? b.registrado : null,
      marca: a ? a.marca : null,
      classe: a ? a.classe : null,
      classeB: b ? b.classe || null : null,
      horaA: a ? a.horaLimite || null : null,
      horaB: b ? b.horaLimite || null : null,
      diasValidosA: a && a.diasValidos !== undefined ? a.diasValidos : null,
      diasValidosB: b && b.diasValidos !== undefined ? b.diasValidos : null,
      diasCalendarioA: a && a.diasCalendario !== undefined ? a.diasCalendario : null,
      diasCalendarioB: b && b.diasCalendario !== undefined ? b.diasCalendario : null,
    });
  }
  return out;
}

// Contagem das classes de dia para a faixa de cobertura (bi_resumo_v2.dias).
export function contagemCobertura(dias) {
  if (!dias) return null;
  const g = (k) => Number(dias[k] || 0);
  return {
    completos: g('completo') + g('completo_sem_vendas'),
    semVendas: g('completo_sem_vendas'),
    parciais: g('parcial'),
    pendencias: g('com_pendencias'),
    semImportacao: g('sem_importacao'),
    naoConfirmados: g('cobertura_nao_confirmada'),
    semOperacao: g('sem_operacao'),
  };
}

// Dias fora das médias, para a frase "Fora das médias: 19/11 sem importação…".
export function diasForaDasMedias(calendario, dias) {
  const filtro = dias && dias.length && dias.length < 7 ? new Set(dias) : null;
  return (calendario || [])
    .filter((d) => (!filtro || filtro.has(diaDaSemana(d.dia))) && !d.entra_media_vendas && d.classe_vendas !== 'futuro' && d.classe_vendas !== 'pre_operacao')
    .map((d) => ({ dia: d.dia, classe: d.classe_vendas, horaLimite: d.hora_limite_vendas ? String(d.hora_limite_vendas).slice(0, 5) : null }));
}

// ---------------------------------------------------------------------------
// Horários (bi_horarios): curva do dia, média por dia da semana e mapa de
// calor. Só dias completos da base vendas. Médias = soma ÷ dias considerados.
// ---------------------------------------------------------------------------
//
// Mapa de calor por indicador (célula = dia da semana × hora):
//  bruto  -> faturamento bruto da hora ÷ dias completos daquele dia da semana
//  vendas -> vendas da hora ÷ dias completos daquele dia da semana
//  ticket -> líquido da hora ÷ vendas da hora (razão dos totais, nunca média
//            de tickets); hora sem vendas -> null ("não se aplica")
// Dia da semana sem dia completo no recorte (ou fora do filtro) -> null em
// todas as horas ("sem dados", fora da escala de cores).
export const INDICADORES_CALOR = ['bruto', 'vendas', 'ticket'];

export function analisarHorarios(linhas) {
  const rows = linhas || [];
  const curva = rows
    .filter((r) => r.dia_semana === null || r.dia_semana === undefined)
    .map((r) => {
      const dias = num(r.dias_considerados);
      const vendas = num(r.vendas);
      return {
        hora: Number(r.hora),
        bruto: dias ? num(r.bruto) / dias : null,
        vendas: dias ? vendas / dias : null,
        ticket: vendas ? num(r.liquido) / vendas : null,
        totalVendas: vendas,
        dias,
      };
    });
  const porDow = new Map();
  for (const r of rows) {
    if (r.dia_semana === null || r.dia_semana === undefined) continue;
    const d = Number(r.dia_semana);
    const e = porDow.get(d) || { dias: num(r.dias_considerados), bruto: 0, vendas: 0, horas: new Map() };
    e.bruto += num(r.bruto) || 0;
    e.vendas += num(r.vendas) || 0;
    e.horas.set(Number(r.hora), { bruto: num(r.bruto) || 0, vendas: num(r.vendas) || 0, liquido: num(r.liquido) || 0 });
    porDow.set(d, e);
  }
  const diaSemana = ORDEM_SEMANA.map((d) => {
    const e = porDow.get(d);
    return { dow: d, rotulo: NOMES_DIA_CURTO[d], media: e && e.dias ? e.bruto / e.dias : null, dias: e ? e.dias : 0 };
  });
  const VAZIA = { bruto: 0, vendas: 0, liquido: 0 };
  const calor = ORDEM_SEMANA.map((d) => {
    const e = porDow.get(d);
    const temDias = !!(e && e.dias);
    const celula = (h) => e.horas.get(h) || VAZIA;
    const bruto = Array.from({ length: 24 }, (_, h) => (temDias ? celula(h).bruto / e.dias : null));
    const vendas = Array.from({ length: 24 }, (_, h) => (temDias ? celula(h).vendas / e.dias : null));
    const ticket = Array.from({ length: 24 }, (_, h) => (temDias && celula(h).vendas > 0 ? celula(h).liquido / celula(h).vendas : null));
    return { dow: d, rotulo: NOMES_DIA_CURTO[d], dias: temDias ? e.dias : 0, valores: bruto, bruto, vendas, ticket };
  });
  const diasConsiderados = rows.length ? Math.max(0, ...rows.filter((r) => r.dia_semana == null).map((r) => num(r.dias_considerados) || 0)) : 0;
  return { curva, diaSemana, calor, diasConsiderados };
}

// Escala do mapa de calor de um indicador sobre as horas exibidas: só
// valores válidos entram (null fica fora). Ticket parte do menor valor (não
// de zero) para não achatar as diferenças.
export function escalaCalor(calor, indicador, horas) {
  const vals = [];
  for (const linha of calor || []) {
    for (const h of horas) {
      const v = linha[indicador] ? linha[indicador][h] : null;
      if (v !== null && v !== undefined && Number.isFinite(v)) vals.push(v);
    }
  }
  if (!vals.length) return { minimo: 0, maximo: 0, vazio: true };
  return { minimo: indicador === 'ticket' ? Math.min(...vals) : 0, maximo: Math.max(...vals), vazio: false };
}

// Faixa de horas exibida: da primeira à última hora com vendas (em A ou B),
// sem cortar horas com movimento. Sem vendas: 6h–22h.
export function faixaDeHoras(...curvas) {
  const horas = curvas.flat().filter((p) => p && p.totalVendas > 0).map((p) => p.hora);
  if (!horas.length) return { inicio: 6, fim: 22 };
  return { inicio: Math.min(...horas), fim: Math.max(...horas) };
}

// ---------------------------------------------------------------------------
// Produtos por horário escolhidos (bi_produto_horarios): curva por hora de
// cada código (linhas com dia_semana nulo e hora preenchida).
// ---------------------------------------------------------------------------
export function curvasProdutoHorario(linhas) {
  const por = new Map();
  for (const r of linhas || []) {
    if (r.dia_semana !== null && r.dia_semana !== undefined) continue;
    if (r.hora === null || r.hora === undefined) {
      const e = por.get(r.codigo) || { codigo: r.codigo, descricao: r.descricao, horas: new Map(), total: null, dias: 0 };
      e.total = num(r.bruto);
      e.dias = num(r.dias_considerados);
      e.descricao = r.descricao;
      por.set(r.codigo, e);
      continue;
    }
    const e = por.get(r.codigo) || { codigo: r.codigo, descricao: r.descricao, horas: new Map(), total: null, dias: 0 };
    e.horas.set(Number(r.hora), {
      participacao: num(r.participacao_no_produto),
      mediaBruto: num(r.media_bruto_dia),
      participacaoHorario: num(r.participacao_no_horario),
      vendas: num(r.vendas),
    });
    e.dias = num(r.dias_considerados);
    por.set(r.codigo, e);
  }
  return por;
}

// Top N por hora (bi_produtos_horario_v2) -> [{ hora, itens: [...] }].
export function topPorHora(linhas) {
  const por = new Map();
  for (const r of linhas || []) {
    const h = Number(r.hora);
    if (!por.has(h)) por.set(h, []);
    por.get(h).push({ posicao: Number(r.posicao), codigo: r.codigo, descricao: r.descricao, mediaBruto: num(r.media_bruto_dia), mediaQuantidade: num(r.media_quantidade_dia), mediaVendas: num(r.media_vendas_dia) });
  }
  return [...por.entries()].sort((a, b) => a[0] - b[0]).map(([hora, itens]) => ({ hora, itens: itens.sort((a, b) => a.posicao - b.posicao) }));
}

// ---------------------------------------------------------------------------
// Comparação (bi_comparar_periodos): decisão de exibir variação.
// Variação só aparece quando a RPC disse comparavel = true e devolveu o
// valor (totais só no critério pareado; base zero -> null).
// ---------------------------------------------------------------------------
export function variacaoValida(comparacao, campo, bloco = 'geral') {
  const g = comparacao && comparacao[bloco];
  if (!g || !g.comparavel || !g.variacoes) return null;
  const v = g.variacoes[campo];
  return v === null || v === undefined ? null : Number(v);
}

export function situacaoComparacao(comparacao) {
  if (!comparacao) return { estado: 'sem' };
  const g = comparacao.geral;
  if (!g) return { estado: 'sem' };
  if (!g.comparavel) return { estado: 'nao_comparavel', motivo: g.motivo };
  return { estado: 'ok', criterio: comparacao.criterio, pareado: comparacao.criterio === 'pareado' };
}

// Valor de produto do ranking/tabela conforme a ordem escolhida.
export const ORDENS_RANKING = {
  bruto: { rotulo: 'Faturamento', campo: 'bruto', tipo: 'moeda' },
  quantidade: { rotulo: 'Quantidade', campo: 'quantidade', tipo: 'quantidade' },
  vendas: { rotulo: 'Vendas', campo: 'vendas', tipo: 'numero' },
};

// Participação: 5 maiores + "demais". O denominador é sempre o total de
// todos os itens elegíveis do período devolvido pela RPC (nunca muda com a
// seleção de produtos). As proporções saem dos VALORES MONETÁRIOS originais
// (bruto ÷ total), não das participações já arredondadas.
export function segmentosParticipacao(resposta, quantos = 5) {
  if (!resposta || !resposta.produtos || !resposta.totais) return null;
  const total = num(resposta.totais.bruto_total_periodo);
  const proporcao = (bruto, participacao) => (total && bruto !== null ? bruto / total : participacao);
  const top = resposta.produtos.slice(0, quantos).map((p) => {
    const bruto = num(p.bruto);
    return { codigo: p.codigo, descricao: p.descricao, bruto, participacao: proporcao(bruto, num(p.participacao)) };
  });
  const somaBruto = top.reduce((a, p) => a + (p.bruto || 0), 0);
  const soma = top.reduce((a, p) => a + (p.participacao || 0), 0);
  const distintos = Number(resposta.totais.produtos_distintos || 0);
  let demais = null;
  if (distintos > top.length) {
    const temBrutos = total !== null && top.every((p) => p.bruto !== null);
    const brutoDemais = temBrutos ? Math.max(0, total - somaBruto) : null;
    demais = { quantidade: distintos - top.length, bruto: brutoDemais, participacao: temBrutos && total ? brutoDemais / total : Math.max(0, 1 - soma) };
  }
  return { top, demais, bruto: total };
}
