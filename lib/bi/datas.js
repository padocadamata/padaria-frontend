// BI Gerencial -- datas do painel (funções PURAS, sem fuso do navegador).
//
// Todas as datas circulam como 'YYYY-MM-DD' (dia civil de America/Sao_Paulo,
// o mesmo das RPCs). As contas são feitas em UTC sobre esse texto, então o
// fuso/horário de verão do navegador nunca desloca um dia.
//
// "Hoje" e "último dia completo" NUNCA vêm do relógio do navegador: vêm de
// bi_status() (hoje = data do servidor em America/Sao_Paulo; padrao_ate =
// último dia com faturamento completo).

const DIA_MS = 86400000;

export const NOMES_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const NOMES_DIA_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const LETRA_DIA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
// Ordem de exibição (semana de segunda a domingo).
export const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0];
export const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6];

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export function dataValida(s) {
  if (typeof s !== 'string' || !RE_DATA.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

const paraMs = (s) => Date.parse(`${s}T00:00:00Z`);
const deMs = (t) => new Date(t).toISOString().slice(0, 10);

export function somarDias(s, n) {
  return deMs(paraMs(s) + n * DIA_MS);
}

export function diferencaDias(de, ate) {
  return Math.round((paraMs(ate) - paraMs(de)) / DIA_MS);
}

// Quantidade de dias do intervalo fechado [de, ate].
export function diasNoIntervalo(de, ate) {
  return diferencaDias(de, ate) + 1;
}

export function diaDaSemana(s) {
  return new Date(paraMs(s)).getUTCDay();
}

// Segunda-feira da semana (semana de segunda a domingo).
export function inicioDaSemana(s) {
  return somarDias(s, -((diaDaSemana(s) + 6) % 7));
}

export function inicioDoMes(s) {
  return `${s.slice(0, 7)}-01`;
}

export function fimDoMes(s) {
  const [a, m] = s.split('-').map(Number);
  return deMs(Date.UTC(a, m, 0));
}

// Mesmo dia do mês anterior, limitado ao último dia daquele mês
// (31/03 -> 28/02 ou 29/02).
export function mesmoDiaMesAnterior(s) {
  const [a, m, d] = s.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m - 1, 0)).getUTCDate();
  return deMs(Date.UTC(a, m - 2, Math.min(d, ultimo)));
}

export function listarDias(de, ate) {
  const out = [];
  for (let t = paraMs(de), fim = paraMs(ate); t <= fim; t += DIA_MS) out.push(deMs(t));
  return out;
}

// Dias do intervalo que caem no filtro de dias da semana.
export function diasNoFiltro(de, ate, dias) {
  const filtro = new Set(dias && dias.length ? dias : TODOS_OS_DIAS);
  return listarDias(de, ate).filter((s) => filtro.has(diaDaSemana(s)));
}

// ---------------------------------------------------------------------------
// Atalhos de período (aprovados em 2026-11-25; rótulos revistos na
// homologação visual). Semana = segunda a domingo. "Últimos 7/30 dias"
// TERMINAM no último dia com importação completa (padrao_ate) e contam 7/30
// dias de calendário: lacunas (ex.: dia sem importação) continuam dentro do
// período e aparecem como lacuna -- o intervalo nunca é ampliado para
// compensá-las.
// ---------------------------------------------------------------------------
export const ATALHOS = [
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: 'ontem', rotulo: 'Ontem' },
  { valor: '7', rotulo: 'Últimos 7 dias' },
  { valor: '30', rotulo: 'Últimos 30 dias' },
  { valor: 'semana', rotulo: 'Semana atual' },
  { valor: 'semana_anterior', rotulo: 'Semana anterior' },
  { valor: 'mes', rotulo: 'Mês atual' },
  { valor: 'mes_anterior', rotulo: 'Mês anterior' },
  { valor: 'personalizado', rotulo: 'Personalizado' },
];
export const ATALHO_PADRAO = '7';
const VALORES_ATALHO = new Set(ATALHOS.map((a) => a.valor));
export const atalhoValido = (v) => VALORES_ATALHO.has(v);

// Atalhos que terminam no último dia com importação completa.
export const ATALHOS_ATE_ULTIMO_COMPLETO = new Set(['7', '30']);

// referencia: { hoje, ultimoCompleto } (de bi_status). Sem dia completo
// importado ainda, "últimos N dias" terminam ontem.
export function periodoDoAtalho(atalho, { hoje, ultimoCompleto }) {
  if (!dataValida(hoje)) return null;
  const ultimo = dataValida(ultimoCompleto) ? ultimoCompleto : somarDias(hoje, -1);
  const segunda = inicioDaSemana(hoje);
  switch (atalho) {
    case 'hoje':
      return { de: hoje, ate: hoje };
    case 'ontem': {
      const d = somarDias(hoje, -1);
      return { de: d, ate: d };
    }
    case '7':
      return { de: somarDias(ultimo, -6), ate: ultimo };
    case '30':
      return { de: somarDias(ultimo, -29), ate: ultimo };
    case 'semana':
      return { de: segunda, ate: hoje };
    case 'semana_anterior':
      return { de: somarDias(segunda, -7), ate: somarDias(segunda, -1) };
    case 'mes':
      return { de: inicioDoMes(hoje), ate: hoje };
    case 'mes_anterior': {
      const fim = somarDias(inicioDoMes(hoje), -1);
      return { de: inicioDoMes(fim), ate: fim };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Referência (B) de uma comparação.
//  - 'anterior' (padrão dos cartões): período anterior EQUIVALENTE --
//    atalhos de semana comparam com a mesma faixa da semana anterior; de
//    mês, com os mesmos dias do mês anterior; os demais, com os N dias
//    imediatamente anteriores.
//  - 'mes_anterior': mesmos dias do mês anterior.
//  - 'semana_anterior': 7 dias antes.
//  - 'livre': o período informado pelo usuário.
//  - 'nenhuma': sem comparação.
// ---------------------------------------------------------------------------
export const REFERENCIAS = [
  { valor: 'anterior', rotulo: 'vs. período anterior equivalente' },
  { valor: 'mes_anterior', rotulo: 'vs. mesmo período do mês anterior' },
  { valor: 'semana_anterior', rotulo: 'vs. semana anterior' },
  { valor: 'livre', rotulo: 'vs. período livre…' },
  { valor: 'nenhuma', rotulo: 'Desativada' },
];
const VALORES_REFERENCIA = new Set(REFERENCIAS.map((r) => r.valor));
export const referenciaValida = (v) => VALORES_REFERENCIA.has(v);

export function periodoReferencia({ de, ate }, referencia, { atalho = null, livre = null } = {}) {
  if (!dataValida(de) || !dataValida(ate) || de > ate) return null;
  const n = diasNoIntervalo(de, ate);
  switch (referencia) {
    case 'nenhuma':
      return null;
    case 'livre':
      return livre && dataValida(livre.de) && dataValida(livre.ate) && livre.de <= livre.ate ? { de: livre.de, ate: livre.ate } : null;
    case 'semana_anterior':
      return { de: somarDias(de, -7), ate: somarDias(ate, -7) };
    case 'mes_anterior':
      return { de: mesmoDiaMesAnterior(de), ate: mesmoDiaMesAnterior(ate) };
    case 'anterior':
    default:
      if (atalho === 'semana' || atalho === 'semana_anterior') return { de: somarDias(de, -7), ate: somarDias(ate, -7) };
      if (atalho === 'mes' || atalho === 'mes_anterior') return { de: mesmoDiaMesAnterior(de), ate: mesmoDiaMesAnterior(ate) };
      return { de: somarDias(de, -n), ate: somarDias(de, -1) };
  }
}

// Limites das RPCs (nunca truncar: o bloco explica e pede outro filtro).
export const LIMITES = {
  geral: 1830, // resumo, produtos, horários
  serieDia: 400, // série/evolução diária e calendário
  comparacao: 366, // bi_comparar_periodos
};
