// Formatação de datas do Financeiro. As colunas date chegam do Supabase
// como texto YYYY-MM-DD -- nunca passam por new Date() (evita o fuso do
// navegador deslocar o dia).
export function formatarData(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  const [ano, mes, dia] = String(dataYYYYMMDD).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

export function formatarDataHora(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function formatarCompetencia(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '—';
  const [ano, mes] = String(dataYYYYMMDD).split('-');
  return `${MESES[Number(mes) - 1]}/${ano}`;
}

// "Compra · Retirada 12/10/2026" | "Despesa · ALUGUEL (out/2026)"
export function descreverOrigem(linha) {
  if (linha.origem === 'compra') {
    const modalidade = linha.modalidade_compra === 'compra_presencial' ? 'Retirada' : 'Entrega';
    return `Compra · ${modalidade} ${formatarData(linha.data_compra)}`;
  }
  return `Despesa · ${linha.categoria_nome || '—'}${linha.competencia ? ` (${formatarCompetencia(linha.competencia)})` : ''}`;
}
