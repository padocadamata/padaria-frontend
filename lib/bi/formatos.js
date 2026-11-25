// BI Gerencial -- formatação e textos (funções PURAS).
//
// Regras de exibição homologadas:
//  - valor ausente (null/undefined) = "sem dados", NUNCA R$ 0,00;
//  - valores monetários de cartões e tabelas SEMPRE com centavos; só os
//    eixos dos gráficos usam a forma abreviada;
//  - quantidades como registradas no G3, SEM unidade ("un"/"kg" não são
//    inferidos: decimal não prova peso).

export const SEM_DADOS = 'sem dados';

const ausente = (v) => v === null || v === undefined || v === '' || Number.isNaN(Number(v));

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function moeda(v) {
  return ausente(v) ? SEM_DADOS : fmtMoeda.format(Number(v));
}

export function numero(v, casas = 0) {
  if (ausente(v)) return SEM_DADOS;
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Quantidade registrada: até 3 casas, sem zeros à direita e sem unidade.
export function quantidade(v) {
  if (ausente(v)) return SEM_DADOS;
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

// Fração (0,1234) -> "12,3%".
export function percentual(v, casas = 1) {
  if (ausente(v)) return '—';
  return `${(Number(v) * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

// Diferença entre frações em pontos percentuais.
export function pontosPercentuais(v, casas = 2) {
  if (ausente(v)) return '—';
  const n = Number(v) * 100;
  return `${n > 0 ? '+' : ''}${n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })} p.p.`;
}

// Eixo de gráfico: R$ abreviado ("R$ 4 mil", "R$ 1,2 mi", "R$ 850").
export function moedaEixo(v) {
  if (ausente(v)) return '';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e6) return `R$ ${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1e3) return `R$ ${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: abs < 10 ? 2 : 0 })}`;
}

export function numeroEixo(v) {
  if (ausente(v)) return '';
  const n = Number(v);
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(n) < 10 ? 1 : 0 });
}

export function percentualEixo(v) {
  if (ausente(v)) return '';
  const n = Number(v) * 100;
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: n < 10 ? 1 : 0 })}%`;
}

// Variação (A − B) ÷ B já calculada pela RPC: "▲ +12,3%".
export function variacao(v) {
  if (ausente(v)) return null;
  const n = Number(v);
  const seta = n > 0.0005 ? '▲' : n < -0.0005 ? '▼' : '■';
  const sinal = n > 0 ? '+' : '';
  return { texto: `${seta} ${sinal}${percentual(n)}`, sentido: n > 0.0005 ? 'sobe' : n < -0.0005 ? 'desce' : 'estavel' };
}

export function data(s) {
  if (!s) return '—';
  const [a, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function dataCurta(s) {
  if (!s) return '—';
  const [, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}`;
}

// "ter, 18/11/2026" (dia da semana do próprio texto da data, sem fuso).
const DIAS_ABREV = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export function dataComDia(s) {
  if (!s) return '—';
  const iso = String(s).slice(0, 10);
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return data(iso);
  return `${DIAS_ABREV[new Date(t).getUTCDay()]}, ${data(iso)}`;
}

// Diferença com sinal explícito ("+R$ 12,30", "−3,5").
export function comSinal(v, formato) {
  if (ausente(v)) return SEM_DADOS;
  const n = Number(v);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formato(Math.abs(n))}`;
}

export function intervalo(de, ate) {
  if (!de || !ate) return '—';
  return de === ate ? data(de) : `${data(de)} a ${data(ate)}`;
}

export function intervaloCurto(de, ate) {
  if (!de || !ate) return '—';
  return de === ate ? dataCurta(de) : `${dataCurta(de)}–${dataCurta(ate)}`;
}

export function dataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function plural(n, singular, pluralTexto = `${singular}s`) {
  return `${numero(n)} ${Number(n) === 1 ? singular : pluralTexto}`;
}

// ---------------------------------------------------------------------------
// Textos dos códigos devolvidos pelas RPCs (nunca mostrar o código cru).
// ---------------------------------------------------------------------------
export const ROTULO_CLASSE = {
  completo: 'completo',
  completo_sem_vendas: 'completo sem vendas',
  parcial: 'parcial',
  com_pendencias: 'com pendências',
  sem_importacao: 'sem importação',
  cobertura_nao_confirmada: 'cobertura não confirmada',
  sem_operacao: 'sem operação',
  sem_conciliacao: 'sem conciliação',
  pre_operacao: 'antes do início da operação',
  futuro: 'futuro',
};

export const MOTIVO_COMPARACAO = {
  periodo_a_futuro: 'O período analisado está no futuro.',
  periodo_b_futuro: 'O período de referência está no futuro.',
  nenhum_dia_no_filtro: 'Nenhum dia do período cai nos dias da semana escolhidos.',
  quantidade_de_dias_diferente: 'Os períodos têm quantidades de dias diferentes para o critério pareado.',
  periodo_a_pre_operacao: 'O período analisado é anterior ao início oficial da operação.',
  periodo_b_pre_operacao: 'O período de referência é anterior ao início oficial da operação.',
  contem_pre_operacao: 'Um dos períodos inclui dias anteriores ao início oficial da operação.',
  sem_dados: 'Não há dias completos em um dos períodos.',
  cobertura_insuficiente: 'A cobertura de dias completos ficou abaixo do mínimo em um dos períodos.',
};

export const AVISO_COMPARACAO = {
  fim_a_ajustado_hoje: 'O fim do período analisado foi ajustado para hoje.',
  fim_b_ajustado_hoje: 'O fim do período de referência foi ajustado para hoje.',
  periodos_sobrepostos: 'Os períodos se sobrepõem.',
  pares_com_dias_da_semana_diferentes: 'Alguns pares juntam dias da semana diferentes (pareamento por posição).',
  quantidades_de_dias_diferentes: 'Durações diferentes: só médias por dia válido, ticket e percentuais são comparados.',
};

export const MOTIVO_PERIODO = {
  periodo_pre_operacao: 'O período escolhido é anterior ao início oficial da operação.',
  periodo_futuro: 'O período escolhido está no futuro.',
  nenhum_dia_no_filtro: 'Nenhum dia do período cai nos dias da semana escolhidos.',
};

export const AVISO_PERIODO = {
  inicio_ajustado_operacao: 'O início foi ajustado para o início oficial da operação.',
  fim_ajustado_hoje: 'O fim foi ajustado para hoje.',
  sem_dados: 'Não há dias importados no período.',
  contem_dia_parcial: 'O período contém dia parcial (fora das médias).',
  contem_dia_com_pendencias: 'O período contém dia com pendências de importação (fora das médias).',
  contem_dia_sem_conciliacao: 'O período contém dia sem vendas conciliadas: produtos sem dado nesse dia.',
  vendas_nao_conciliadas_excluidas: 'Vendas não conciliadas ficam fora da análise de produtos.',
  excecao_com_vendas: 'Há dia marcado como exceção que tem vendas registradas.',
};

export function nomeDosDias(dias, nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']) {
  const d = [...new Set(dias || [])].sort((a, b) => a - b);
  if (d.length === 0 || d.length === 7) return 'todos os dias';
  if (d.length === 5 && !d.includes(0) && !d.includes(6)) return 'dias úteis';
  if (d.length === 2 && d.includes(0) && d.includes(6)) return 'fins de semana';
  const ordem = [1, 2, 3, 4, 5, 6, 0].filter((x) => d.includes(x));
  return ordem.map((x) => nomes[x]).join(', ');
}

export const ROTULO_AGRUPAMENTO = { dia: 'dia', semana: 'semana', mes: 'mês' };
