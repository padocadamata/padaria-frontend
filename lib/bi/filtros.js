// BI Gerencial -- estado dos filtros (gerais + individuais por bloco +
// produtos selecionados). Persistido por sessão de login com a MESMA
// infraestrutura das demais telas (lib/filtros/useFiltrosPersistidos).
//
// Filtros individuais: cada bloco HERDA os gerais; quando o usuário define
// um filtro próprio (período, dias da semana, agrupamento ou referência),
// só aquele campo é substituído e o bloco mostra "Filtro próprio" com o
// botão de restaurar. Nada aqui altera os filtros gerais por limitação de
// um gráfico.

import { dataIso, umDe } from '../filtros/persistenciaFiltros.js';
import { ATALHO_PADRAO, TODOS_OS_DIAS, atalhoValido, referenciaValida } from './datas.js';

export const AGRUPAMENTOS = ['dia', 'semana', 'mes'];
export const MAX_SELECIONADOS = 5;
// Ranking: quantos produtos exibir (o ranking é calculado sobre TODO o
// conjunto elegível; o limite só corta a exibição). Padrão: Top 10.
export const RANKING_TOPS = [5, 10, 20];
export const RANKING_TOP_PADRAO = 10;
// Tabela de produtos: registros por página. Padrão: 20.
export const TAMANHOS_PAGINA = [10, 20, 50, 100];
export const TAMANHO_PAGINA_PADRAO = 20;
// Seleção automática inicial: os 3 produtos de maior faturamento do período
// geral, só no 1º acesso (sem seleção registrada).
export const QTD_SELECAO_INICIAL = 3;

export const BLOCOS = [
  'evolucao', 'semana', 'ranking', 'participacao', 'evoprod', 'tabela', 'curva', 'calor', 'prodhora',
];

// Campos de filtro que cada bloco usa (o painel do bloco só mostra estes).
export const CAMPOS_DO_BLOCO = {
  evolucao: ['periodo', 'dias', 'agrupamento', 'referencia'],
  semana: ['periodo', 'dias', 'referencia'],
  ranking: ['periodo', 'dias'],
  participacao: ['periodo', 'dias'],
  evoprod: ['periodo', 'dias', 'agrupamento'],
  tabela: ['periodo', 'dias'],
  curva: ['periodo', 'dias', 'referencia'],
  calor: ['periodo', 'dias'],
  prodhora: ['periodo', 'dias', 'referencia'],
};

export const diasValidos = (v) =>
  Array.isArray(v) && v.length >= 1 && v.length <= 7 && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) && new Set(v).size === v.length;

const periodoValido = (p) => !!p && typeof p === 'object' && dataIso(p.de) && dataIso(p.ate) && p.de <= p.ate;

export function blocoValido(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  for (const [k, v] of Object.entries(o)) {
    if (k === 'periodo' && !periodoValido(v)) return false;
    if (k === 'dias' && !diasValidos(v)) return false;
    if (k === 'agrupamento' && !AGRUPAMENTOS.includes(v)) return false;
    if (k === 'referencia' && !referenciaValida(v)) return false;
    if (k === 'referenciaLivre' && !periodoValido(v)) return false;
    if (!['periodo', 'dias', 'agrupamento', 'referencia', 'referenciaLivre'].includes(k)) return false;
  }
  return true;
}

export const blocosValidos = (v) =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([k, o]) => BLOCOS.includes(k) && blocoValido(o));

export const selecionadosValidos = (v) =>
  Array.isArray(v) && v.length <= MAX_SELECIONADOS && v.every((c) => typeof c === 'string' && c.trim() === c && c.length >= 1 && c.length <= 30) && new Set(v).size === v.length;

// de/ate vazios = "ainda não calculado" (atalho é recalculado a partir de
// bi_status a cada abertura; só o personalizado guarda as datas).
export const FILTROS_BI = {
  versao: 1,
  padrao: {
    atalho: ATALHO_PADRAO,
    de: '',
    ate: '',
    dias: TODOS_OS_DIAS,
    agrupamento: 'dia',
    referencia: 'anterior',
    refDe: '',
    refAte: '',
    blocos: {},
    selecionados: [],
    // true depois da seleção automática inicial ou de qualquer escolha
    // manual (inclusive remover todos): a partir daí a seleção nunca é
    // substituída automaticamente.
    selecaoIniciada: false,
    rankingTop: RANKING_TOP_PADRAO,
    porPagina: TAMANHO_PAGINA_PADRAO,
  },
  validadores: {
    atalho: atalhoValido,
    de: (v) => v === '' || dataIso(v),
    ate: (v) => v === '' || dataIso(v),
    dias: diasValidos,
    agrupamento: umDe(AGRUPAMENTOS),
    referencia: referenciaValida,
    refDe: (v) => v === '' || dataIso(v),
    refAte: (v) => v === '' || dataIso(v),
    blocos: blocosValidos,
    selecionados: selecionadosValidos,
    selecaoIniciada: (v) => typeof v === 'boolean',
    rankingTop: umDe(RANKING_TOPS),
    porPagina: umDe(TAMANHOS_PAGINA),
  },
};

// Filtros efetivos de um bloco: gerais + substituições próprias.
export function filtrosEfetivos(geral, blocos, nome) {
  const o = (blocos && blocos[nome]) || {};
  const campos = CAMPOS_DO_BLOCO[nome] || [];
  const usa = (c) => campos.includes(c) && o[c] !== undefined;
  const referencia = usa('referencia') ? o.referencia : geral.referencia;
  const livre = usa('referencia') && o.referenciaLivre ? o.referenciaLivre : { de: geral.refDe, ate: geral.refAte };
  return {
    de: usa('periodo') ? o.periodo.de : geral.de,
    ate: usa('periodo') ? o.periodo.ate : geral.ate,
    dias: usa('dias') ? o.dias : geral.dias,
    agrupamento: usa('agrupamento') ? o.agrupamento : geral.agrupamento,
    referencia,
    referenciaLivre: livre,
    // Atalho só vale para a referência "equivalente" quando o período é o geral.
    atalho: usa('periodo') ? 'personalizado' : geral.atalho,
    proprios: campos.filter((c) => o[c] !== undefined),
  };
}

export function alternarDia(dias, d) {
  const atual = new Set(dias);
  if (atual.has(d)) {
    if (atual.size === 1) return dias; // pelo menos um dia
    atual.delete(d);
  } else atual.add(d);
  return [...atual].sort((a, b) => a - b);
}

// A seleção automática inicial só roda quando não há seleção registrada:
// nem escolha manual anterior (selecaoIniciada) nem códigos salvos.
export function precisaSelecaoInicial(valores) {
  return !!valores && !valores.selecaoIniciada && (!Array.isArray(valores.selecionados) || valores.selecionados.length === 0);
}

// Códigos da seleção inicial: os N primeiros do ranking por faturamento
// (códigos G3 distintos, nunca consolidados por descrição).
export function codigosSelecaoInicial(produtos, quantos = QTD_SELECAO_INICIAL) {
  const out = [];
  for (const p of produtos || []) {
    if (!p || typeof p.codigo !== 'string' || out.includes(p.codigo)) continue;
    if (!(Number(p.bruto) > 0)) continue;
    out.push(p.codigo);
    if (out.length >= Math.min(quantos, MAX_SELECIONADOS)) break;
  }
  return out;
}

// Seleção de produtos: acrescenta/remove mantendo a ordem de escolha.
export function alternarSelecionado(lista, codigo) {
  if (lista.includes(codigo)) return lista.filter((c) => c !== codigo);
  if (lista.length >= MAX_SELECIONADOS) return lista;
  return [...lista, codigo];
}
