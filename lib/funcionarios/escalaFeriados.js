import { createClient } from '../supabase/client';
import { formatarDataCurta } from './escala';

// Feriados na Escala -- SOMENTE informação visual (nunca regra de escala:
// não cria folga, não altera horário, não bloqueia edição, não entra no
// cálculo de cobertura). Fonte: public.feriados_nacionais (migration 0010),
// a mesma tabela única de feriados do sistema, mantida em Folha >
// Pagamentos > Configurações > Feriados (dias úteis) -- nenhuma lista fixa
// no frontend, nenhuma API externa.
//
// Diferença proposital para buscarFeriados (lib/funcionarios/pagamentos.js):
// aqui um erro de leitura NUNCA vira "não há feriados" em silêncio -- volta
// { error } para a tela avisar, sem bloquear nada da escala.

export const MARCA_FERIADO = 'F*';

// Map<'YYYY-MM-DD', nome> a partir das linhas { data, nome }.
export function montarMapaFeriados(linhas) {
  const mapa = new Map();
  for (const linha of linhas || []) {
    if (!linha?.data) continue;
    mapa.set(String(linha.data).slice(0, 10), (linha.nome || '').trim() || 'Feriado');
  }
  return mapa;
}

export function nomeFeriado(feriados, data) {
  return feriados?.get(data) || null;
}

export function rotuloFeriado(nome) {
  return `Feriado: ${nome}`;
}

// Feriados de uma lista de datas, na ordem das datas: [{ data, nome }].
export function feriadosDoPeriodo(feriados, dias) {
  return (dias || []).filter((d) => feriados?.has(d)).map((d) => ({ data: d, nome: feriados.get(d) }));
}

// "F* = feriado: 12/10 Nossa Senhora Aparecida; 02/11 Finados" -- legenda
// da tela e dos arquivos exportados. null quando o período não tem feriado.
export function legendaFeriados(feriados, dias) {
  const lista = feriadosDoPeriodo(feriados, dias);
  if (lista.length === 0) return null;
  return `${MARCA_FERIADO} = feriado: ${lista.map((f) => `${formatarDataCurta(f.data)} ${f.nome}`).join('; ')}`;
}

// Leitura do período (uma consulta só -- feriados de uma janela de no
// máximo um mês). `supabase` injetado para os testes rodarem sem banco.
export async function lerFeriadosPeriodo(supabase, dataInicio, dataFim) {
  const { data, error } = await supabase
    .from('feriados_nacionais')
    .select('data, nome')
    .gte('data', dataInicio)
    .lte('data', dataFim)
    .order('data', { ascending: true });
  if (error) return { feriados: null, error };
  return { feriados: montarMapaFeriados(data), error: null };
}

export async function buscarFeriadosPeriodo(dataInicio, dataFim) {
  const resultado = await lerFeriadosPeriodo(createClient(), dataInicio, dataFim);
  if (resultado.error) console.error('Erro ao carregar feriados da escala:', resultado.error);
  return resultado;
}
