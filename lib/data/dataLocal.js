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

// Nome do dia da semana para uma data arbitrária já em YYYY-MM-DD (ex.:
// vinda de producao_registros.data). Usa meio-dia local em vez de
// timeZone: FUSO_PADOCA porque a data já é um valor de calendário puro
// (sem componente de hora) — construir com T12:00:00 evita que a
// conversão de fuso empurre para o dia anterior/seguinte.
export function diaDaSemanaExibicao(dataYYYYMMDD) {
  const data = new Date(`${dataYYYYMMDD}T12:00:00`);
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(data);
}

// Soma (ou subtrai, com dias negativo) dias de calendário a uma data pura
// YYYY-MM-DD, devolvendo outra data pura YYYY-MM-DD.
//
// CORRIGIDO: a versão anterior usava `new Date(\`${d}T12:00:00\`)` +
// getFullYear/getMonth/getDate -- isso parseia e lê no fuso LOCAL DO
// DISPOSITIVO/NAVEGADOR, não em America/Sao_Paulo. Na prática o "meio-dia"
// só protege contra virar o dia em dispositivos com offset de até ~12h;
// não é uma garantia determinística de fuso, e a regra da funcionalidade
// (Controle de Expositores) exige independência total do relógio/fuso do
// aparelho.
//
// Implementação atual: aritmética de calendário pura, via Date.UTC como
// MECANISMO INTERNO apenas -- nunca como fuso horário. Parseia ano/mês/dia
// numericamente, monta com Date.UTC(...), soma dias com setUTCDate(...) e
// lê de volta exclusivamente com getUTCFullYear/getUTCMonth/getUTCDate.
// Como a entrada e a leitura são SEMPRE UTC (nunca local), o resultado é
// 100% determinístico e não depende do timezone do dispositivo -- o "UTC"
// aqui não representa hora real nenhuma, é só onde o JS guarda os
// componentes ano/mês/dia enquanto a conta é feita. dataLocalHoje() (essa
// sim calculada em America/Sao_Paulo, via Intl.DateTimeFormat) continua a
// ÚNICA fonte do "hoje" real da Padoca -- somarDias() só faz a aritmética
// de calendário a partir do que ela devolver.
export function somarDias(dataYYYYMMDD, dias) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() + dias);

  const anoResultado = data.getUTCFullYear();
  const mesResultado = String(data.getUTCMonth() + 1).padStart(2, '0');
  const diaResultado = String(data.getUTCDate()).padStart(2, '0');
  return `${anoResultado}-${mesResultado}-${diaResultado}`;
}
