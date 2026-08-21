// Data operacional da Padoca — sempre America/Sao_Paulo, calculada
// explicitamente por fuso horário, nunca por UTC nem pelo fuso do
// dispositivo. new Date().toISOString().slice(0, 10) usa UTC e à noite
// pode já mostrar o dia seguinte (Brasil está atrás de UTC) — por isso
// nunca usar isso aqui. getFullYear()/getMonth()/getDate() do dispositivo
// também não são usados: dependeriam do fuso configurado na máquina, que
// pode estar errado sem o operador perceber.

const FUSO_PADOCA = 'America/Sao_Paulo';

function partesData(data) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_PADOCA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(data);

  const valores = {};
  for (const parte of partes) {
    if (parte.type !== 'literal') {
      valores[parte.type] = parte.value;
    }
  }
  return valores;
}

// Data operacional de hoje, no formato YYYY-MM-DD, no fuso America/Sao_Paulo.
export function dataLocalHoje() {
  const { year, month, day } = partesData(new Date());
  return `${year}-${month}-${day}`;
}

// Versão por extenso para exibição (ex.: "quinta-feira, 21 de agosto de
// 2026"), no mesmo fuso — só para o cabeçalho da tela, não usada em
// nenhuma consulta.
export function dataLocalExibicao() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_PADOCA,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
}
