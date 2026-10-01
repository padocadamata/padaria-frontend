// Folha de Pagamento > Pagamentos (migration 0066) -- funções PURAS (sem
// Supabase) usadas pelas telas para pré-visualizar valores e montar
// payloads. O valor que vale é sempre o calculado pelo banco nas RPCs
// (folha_criar_pagamento_*); aqui é só espelho para a pessoa conferir
// antes de confirmar.

export const TIPOS_LANCAMENTO_MENSAL = [
  { valor: 'integral', rotulo: 'Integral' },
  { valor: 'adiantamento', rotulo: 'Adiantamento' },
  { valor: 'parcial', rotulo: 'Parcial' },
  { valor: 'complemento', rotulo: 'Complemento' },
];

export function rotuloTipoLancamento(valor) {
  return TIPOS_LANCAMENTO_MENSAL.find((t) => t.valor === valor)?.rotulo || '—';
}

export function rotuloFormaRemuneracao(forma) {
  if (forma === 'mensal') return 'Mensal';
  if (forma === 'por_hora') return 'Por hora';
  return 'Não configurado';
}

// Identidade lógica de uma jornada (nunca o id físico do período da Escala).
export function chaveJornada(j) {
  return `${j.data}|${j.hora_inicio}|${j.hora_fim}`;
}

// Arredondamento monetário em centavos (evita 0.1 + 0.2).
export function centavos(valor) {
  return Math.round(Number(valor || 0) * 100);
}

// duracao_minutos / 60 × valor/hora, arredondado a centavos -- mesma
// fórmula de folha_calcular_pendencias_por_hora (0066).
export function valorJornada(duracaoMinutos, valorHora) {
  if (valorHora === null || valorHora === undefined) return null;
  return Math.round((Number(duracaoMinutos) / 60) * Number(valorHora) * 100) / 100;
}

export function duracaoMinutos(horaInicio, horaFim) {
  const [hi, mi] = String(horaInicio).split(':').map(Number);
  const [hf, mf] = String(horaFim).split(':').map(Number);
  return hf * 60 + mf - (hi * 60 + mi);
}

// Descontos digitados na tela -> payload da RPC. Linha totalmente vazia é
// ignorada; linha parcialmente preenchida vira erro (nunca some em
// silêncio).
export function normalizarDescontos(descontos) {
  const payload = [];
  const erros = [];
  (descontos || []).forEach((d, i) => {
    const tipo = String(d.tipo || '').trim();
    const valorTexto = String(d.valor ?? '').trim().replace(',', '.');
    if (!tipo && !valorTexto) return;
    const valor = Number(valorTexto);
    if (!tipo) erros.push(`Desconto ${i + 1}: informe o tipo/descrição.`);
    else if (!valorTexto || !Number.isFinite(valor) || valor <= 0) erros.push(`Desconto ${i + 1}: informe um valor maior que zero.`);
    else payload.push({ tipo, valor: Math.round(valor * 100) / 100, observacao: String(d.observacao || '').trim() || null });
  });
  return { payload, erros };
}

// Bruto/descontos/líquido em centavos -> reais.
export function resumirValores(bruto, descontosPayload) {
  const brutoC = centavos(bruto);
  const descontosC = (descontosPayload || []).reduce((s, d) => s + centavos(d.valor), 0);
  return { bruto: brutoC / 100, descontos: descontosC / 100, liquido: (brutoC - descontosC) / 100 };
}

export function somarValores(itens) {
  return (itens || []).reduce((s, i) => s + centavos(i.valor), 0) / 100;
}

// Sugestão de desconto por falta (pessoa mensal): base / 30 por falta.
// Só sugestão -- a tela oferece um botão, nunca aplica sozinha.
export function sugestaoDescontoFalta(valorBase, faltas) {
  if (!valorBase || !faltas) return null;
  return Math.round((Number(valorBase) / 30) * Number(faltas) * 100) / 100;
}

// Quanto da base mensal ainda pode ser quitado na competência.
export function saldoBaseMensal(valorBase, jaPago) {
  if (valorBase === null || valorBase === undefined) return null;
  return Math.max(centavos(valorBase) - centavos(jaPago), 0) / 100;
}

// Agrupa funcionários para a visão A Pagar: `formaAtual` (Map id -> forma
// vigente hoje) e `comPorHora` (Set de ids com alguma vigência por_hora até
// hoje -- quem virou mensal ainda pode ter jornadas por hora antigas a
// pagar). Ausência em formaAtual = "Não configurado".
export function agruparPorForma(funcionarios, formaAtual, comPorHora) {
  const porHora = [];
  const mensal = [];
  const naoConfigurado = [];
  for (const f of funcionarios || []) {
    const forma = formaAtual.get(f.id);
    if (forma === 'por_hora' || comPorHora.has(f.id)) porHora.push(f);
    if (forma === 'mensal') mensal.push(f);
    if (!forma) naoConfigurado.push(f);
  }
  return { porHora, mensal, naoConfigurado };
}

// ------------------------------------------------------------
// Preferência de pagamento (operacional, nunca restringe pagamento).
// O banco (0065/0066) aceita SOMENTE periodicidade diario|semanal|mensal;
// semanal guarda dia_semana_habitual 0..6 (Domingo=0); mensal guarda um
// código abstrato em dia_mes_habitual, nos formatos documentados na
// coluna: "dia_util:N", "dia_fixo:N", "mensal:ultimo_dia". A tela nunca
// mostra o código -- traduz nos dois sentidos aqui.
// ------------------------------------------------------------

export const PERIODICIDADES_PREFERENCIA = [
  { valor: 'diario', rotulo: 'Diário' },
  { valor: 'semanal', rotulo: 'Semanal' },
  { valor: 'mensal', rotulo: 'Mensal' },
];

export const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

export const TIPOS_REGRA_MENSAL = [
  { valor: 'dia_util', rotulo: 'Dia útil do mês', min: 1, max: 23 },
  { valor: 'dia_fixo', rotulo: 'Dia fixo do mês', min: 1, max: 31 },
  { valor: 'ultimo_dia', rotulo: 'Último dia do mês' },
];

// Escolha amigável -> código gravado. null = "sem dia definido".
export function codificarRegraMensal({ tipo, dia } = {}) {
  if (tipo === 'ultimo_dia') return 'mensal:ultimo_dia';
  const def = TIPOS_REGRA_MENSAL.find((t) => t.valor === tipo && t.min);
  if (!def) return null;
  const n = Number(dia);
  if (!Number.isInteger(n) || n < def.min || n > def.max) return null;
  return `${tipo}:${n}`;
}

// Código gravado -> escolha amigável. Código fora dos formatos conhecidos
// volta como { tipo: 'desconhecido', codigo } (nunca é descartado em
// silêncio; a tela avisa).
export function lerRegraMensal(codigo) {
  if (!codigo) return { tipo: '', dia: '' };
  const texto = String(codigo).trim();
  if (texto === 'mensal:ultimo_dia') return { tipo: 'ultimo_dia', dia: '' };
  const m = /^(dia_util|dia_fixo):(\d{1,2})$/.exec(texto);
  if (m) {
    const def = TIPOS_REGRA_MENSAL.find((t) => t.valor === m[1]);
    const n = Number(m[2]);
    if (n >= def.min && n <= def.max) return { tipo: m[1], dia: String(n) };
  }
  return { tipo: 'desconhecido', dia: '', codigo: texto };
}

export function descreverRegraMensal(codigo) {
  const r = lerRegraMensal(codigo);
  if (r.tipo === 'ultimo_dia') return 'último dia do mês';
  if (r.tipo === 'dia_util') return `${r.dia}º dia útil`;
  if (r.tipo === 'dia_fixo') return `todo dia ${r.dia}`;
  if (r.tipo === 'desconhecido') return 'regra não reconhecida';
  return 'sem dia definido';
}

export function descreverPreferencia(pref) {
  if (!pref) return 'Não configurado';
  if (pref.periodicidade === 'diario') return 'Diário';
  if (pref.periodicidade === 'semanal') {
    const d = pref.dia_semana_habitual;
    return d === null || d === undefined ? 'Semanal — sem dia definido' : `Semanal — ${DIAS_SEMANA[d]}`;
  }
  if (pref.periodicidade === 'mensal') return `Mensal — ${descreverRegraMensal(pref.dia_mes_habitual)}`;
  return 'Não configurado';
}

// Pagamento mensal: valor da base efetivamente enviado conforme o tipo.
// Integral = SEMPRE o saldo atual (campo travado; regra também garantida
// no banco pela migration 0067). Demais tipos = valor digitado.
export function valorBaseDoLancamento({ tipo, digitado, saldo }) {
  if (tipo === 'integral') return Math.max(centavos(saldo), 0) / 100;
  const n = Number(String(digitado ?? '').trim().replace(',', '.'));
  return String(digitado ?? '').trim() !== '' && Number.isFinite(n) ? n : null;
}

// Integral só faz sentido com saldo > 0 (base ainda não quitada).
export function integralPermitido(saldo) {
  return centavos(saldo) > 0;
}
