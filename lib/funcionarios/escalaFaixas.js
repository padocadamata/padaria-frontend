import { LIMITE_MANHA_TARDE } from './escalaConfig';

// Faixas M/T da visão MENSAL da Escala -- só apresentação, derivada dos
// horários REAIS programados no dia (nada é gravado). Um período marca a
// faixa quando OCUPA parte dela (interseção), não pela quantidade de
// períodos. Intervalos semiabertos [início, fim): a fronteira 12:00 não é
// contada duas vezes -- 07:00–12:00 é só M; 12:00–18:00 é só T; 06:00–15:00
// é M + T. Comparação por "HH:MM" (mesmo formato de formatarHora).
//
// Semanal e Cobertura NÃO usam isto (usam os horários reais / seus próprios
// cálculos em escalaCobertura.js).
export const FAIXA_MANHA = { inicio: '06:00', fim: LIMITE_MANHA_TARDE };
export const FAIXA_TARDE = { inicio: LIMITE_MANHA_TARDE, fim: '19:30' };

function hhmm(hora) {
  return hora ? hora.slice(0, 5) : '';
}

export function periodoOcupaFaixa(periodo, faixa) {
  const inicio = hhmm(periodo.hora_inicio);
  const fim = hhmm(periodo.hora_fim);
  if (!inicio || !fim) return false;
  return inicio < faixa.fim && fim > faixa.inicio;
}

// periodos: [{ hora_inicio, hora_fim }] do dia (EstadoDia.periodos).
// Devolve se há M/T e quais períodos ocupam cada faixa (para o tooltip).
export function faixasDoDia(periodos) {
  const lista = periodos || [];
  const periodosManha = lista.filter((p) => periodoOcupaFaixa(p, FAIXA_MANHA));
  const periodosTarde = lista.filter((p) => periodoOcupaFaixa(p, FAIXA_TARDE));
  return { manha: periodosManha.length > 0, tarde: periodosTarde.length > 0, periodosManha, periodosTarde };
}

// Classifica UMA célula funcionário×dia do Mensal (movida de
// EscalaMensal.js sem mudar os estados): "Não definido" (sem EstadoDia) e
// "Folga" (tipo_dia='folga' explícito) nunca se confundem; trabalho traz
// M/T pela regra acima + a ocorrência (Falta/Atestado) do dia.
export function classificarCelulaMensal(estado) {
  if (!estado) return { tipo: 'nao_definido' };
  if (estado.tipo === 'folga') return { tipo: 'folga' };
  const { manha, tarde } = faixasDoDia(estado.periodos);
  return { tipo: 'trabalho', manha, tarde, ocorrencia: estado.ocorrencia, periodos: estado.periodos || [] };
}
