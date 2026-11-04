// Casos do Cartão-Ponto compartilhados: apuracao.test.mjs confere o JS
// contra os valores esperados; paridadeSql.test.mjs confere o SQL
// (folha_ponto_apurar) contra o JS, caso a caso.

export const FUNCIONARIA = { id: 'f-1', nome: 'Sabrina', cargo: 'Atendente', data_admissao: '2025-01-10', data_demissao: null };
export const HOJE = '2026-11-20';

export function trabalho(...periodos) {
  return { tipo: 'trabalho', observacao: null, periodos: periodos.map(([inicio, fim]) => ({ inicio, fim })), ocorrencia: null };
}
export const FOLGA = { tipo: 'folga', observacao: null, periodos: [], ocorrencia: null };
export function comOcorrencia(escala, tipo) {
  return { ...escala, ocorrencia: { tipo, observacao: null } };
}
export function lancamento({ situacao = null, motivo = null, periodos = [], observacao = null } = {}) {
  return { situacao, motivo, origem: null, observacao, periodos: periodos.map(([entrada, saida]) => ({ entrada, saida })) };
}
let seqAtestado = 0;
export function atestado(dataInicio, dataFim = dataInicio, { horas = null, tipo = 'atestado_medico', descricao = 'Atestado entregue' } = {}) {
  seqAtestado += 1;
  return {
    id: `a-${seqAtestado}`,
    tipo,
    abrangencia: horas ? 'parcial' : 'integral',
    data_inicio: dataInicio,
    data_fim: dataFim,
    hora_inicio: horas ? horas[0] : null,
    hora_fim: horas ? horas[1] : null,
    descricao,
  };
}
export function dia(data, { escala = null, lanc = null, feriado = null, vinculo = 'funcionario' } = {}) {
  return { data, vinculo, feriado, escala, lancamento: lanc };
}
export function base(dias, { hoje = HOJE, funcionario = FUNCIONARIA, competencia = '2026-10-01', atestados = [] } = {}) {
  return { versao_base: 1, hoje, competencia, funcionario, atestados, dias };
}

const SEIS = trabalho(['06:00', '12:00']);
const comPeriodos = (...p) => lancamento({ periodos: p });

// { nome, base, dia: campos esperados do 1º dia (ou `dias`: {data: campos}),
//   totais: campos esperados }
export const CASOS = [
  {
    nome: '01 jornada exatamente igual ao previsto',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:00', '12:00']) })]),
    dia: {
      situacao: 'trabalho', previsto_min: 360, trabalhado_min: 360, trabalhado_no_previsto_min: 360, trabalhado_fora_previsto_min: 0,
      intervalo_min: 0, atestado_min: 0, previsto_nao_coberto_min: 0, extra_min: 0, faltante_min: 0, pendencias: [],
    },
  },
  {
    nome: '02 trabalhou menos',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:00', '11:00']) })]),
    dia: { trabalhado_min: 300, previsto_nao_coberto_min: 60, extra_min: 0, faltante_min: 60 },
  },
  {
    nome: '03 trabalhou mais (ficou depois)',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:00', '12:30']) })]),
    dia: { trabalhado_min: 390, trabalhado_fora_previsto_min: 30, extra_min: 30, faltante_min: 0 },
  },
  {
    nome: '04 dois períodos (06:00–09:00 e 09:15–12:00)',
    base: base([dia('2026-10-05', { escala: trabalho(['06:00', '09:00'], ['09:15', '12:00']), lanc: comPeriodos(['06:00', '09:00'], ['09:15', '12:00']) })]),
    dia: { previsto_min: 345, trabalhado_min: 345, intervalo_min: 15, extra_min: 0, faltante_min: 0 },
  },
  {
    nome: '05 mais de dois períodos',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:00', '08:00'], ['08:10', '10:00'], ['10:20', '12:00']) })]),
    dia: { trabalhado_min: 330, intervalo_min: 30, previsto_nao_coberto_min: 30, extra_min: 0, faltante_min: 30 },
  },
  {
    nome: '06 intervalo maior compensado no MESMO dia (sem penalidade)',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:00', '09:00'], ['09:30', '12:30']) })]),
    dia: { trabalhado_min: 360, trabalhado_no_previsto_min: 330, trabalhado_fora_previsto_min: 30, previsto_nao_coberto_min: 30, intervalo_min: 30, extra_min: 0, faltante_min: 0 },
  },
  {
    nome: '06b [obrig. 1/2] entrou 06:30 e saiu 12:30: saldo do dia zero, desvios de 30 min preservados',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:30', '12:30']) })]),
    dia: {
      previsto_min: 360, trabalhado_min: 360, trabalhado_no_previsto_min: 330, trabalhado_fora_previsto_min: 30,
      atestado_min: 0, previsto_nao_coberto_min: 30, extra_min: 0, faltante_min: 0,
    },
    totais: { trabalhado_fora_previsto_min: 30, previsto_nao_coberto_min: 30, extra_min: 0, faltante_min: 0 },
  },
  {
    nome: '07 falta integral da Escala',
    base: base([dia('2026-10-05', { escala: comOcorrencia(SEIS, 'falta') })]),
    dia: { situacao_escala: 'falta', situacao: 'falta', previsto_min: 360, trabalhado_min: 0, previsto_nao_coberto_min: 360, faltante_min: 360, atestado_min: 0, pendencias: [] },
    totais: { faltas_qtd: 1, faltante_min: 360 },
  },
  {
    nome: '08 folga',
    base: base([dia('2026-10-05', { escala: FOLGA })]),
    dia: { situacao: 'folga', previsto_min: 0, trabalhado_min: 0, extra_min: 0, faltante_min: 0, pendencias: [] },
  },
  {
    nome: '09 trabalho em folga após ajuste (tudo fora do previsto = extra)',
    base: base([dia('2026-10-05', { escala: FOLGA, lanc: lancamento({ situacao: 'trabalho', motivo: 'Cobriu colega', periodos: [['08:00', '12:00']] }) })]),
    dia: { situacao_escala: 'folga', situacao: 'trabalho', ajustado: true, previsto_min: 0, trabalhado_min: 240, trabalhado_fora_previsto_min: 240, extra_min: 240, faltante_min: 0, pendencias: [] },
  },
  {
    nome: '10a atestado integral da Escala = horas previstas',
    base: base([dia('2026-10-05', { escala: comOcorrencia(SEIS, 'atestado') })]),
    dia: { situacao: 'atestado', previsto_min: 360, atestado_min: 360, faltante_min: 0, trabalhado_min: 0 },
    totais: { atestado_min: 360, atestados_integrais_qtd: 1, faltas_qtd: 0 },
  },
  {
    nome: '10b [obrig. 12] Falta da Escala justificada por atestado registrado depois (Escala preservada)',
    base: base([dia('2026-10-05', { escala: comOcorrencia(SEIS, 'falta') })], { atestados: [atestado('2026-10-05')] }),
    dia: { situacao_escala: 'falta', situacao: 'atestado', atestado_cobertura: 'integral', atestado_min: 360, faltante_min: 0 },
    totais: { faltas_qtd: 0, atestados_integrais_qtd: 1 },
  },
  {
    nome: '10c falta AJUSTADA no cartão e depois justificada por atestado',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: lancamento({ situacao: 'falta', motivo: 'Não veio' }) })], { atestados: [atestado('2026-10-05')] }),
    dia: { situacao: 'atestado', ajustado: true, atestado_min: 360, faltante_min: 0 },
  },
  {
    nome: '11 atestado parcial sem trabalho',
    base: base([dia('2026-10-05', { escala: SEIS })], { atestados: [atestado('2026-10-05', '2026-10-05', { horas: ['08:00', '10:00'], tipo: 'comparecimento' })] }),
    dia: { situacao: 'trabalho', atestado_cobertura: 'parcial', trabalhado_min: 0, atestado_min: 120, faltante_min: 240, pendencias: [] },
  },
  {
    nome: '12 [obrig. 5] atestado parcial + jornada trabalhada',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:00', '08:00'], ['10:00', '12:00']) })],
      { atestados: [atestado('2026-10-05', '2026-10-05', { horas: ['08:00', '10:00'] })] }),
    dia: { trabalhado_min: 240, trabalhado_no_previsto_min: 240, intervalo_min: 120, atestado_min: 120, previsto_nao_coberto_min: 0, faltante_min: 0, extra_min: 0 },
  },
  {
    nome: '13 [obrig. 6] atestado parcial + trabalho fora da jornada prevista',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['10:00', '14:00']) })],
      { atestados: [atestado('2026-10-05', '2026-10-05', { horas: ['06:00', '10:00'] })] }),
    // 06–10 atestado (240), 10–12 trabalho no previsto (120), 12–14 fora (120)
    dia: { trabalhado_min: 240, trabalhado_no_previsto_min: 120, trabalhado_fora_previsto_min: 120, atestado_min: 240, previsto_nao_coberto_min: 0, extra_min: 120, faltante_min: 0 },
  },
  {
    nome: '14 [obrig. 1/2] trabalho antes do previsto, saída antes (saldo zero, desvios de 60 min)',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['05:00', '11:00']) })]),
    dia: { trabalhado_no_previsto_min: 300, trabalhado_fora_previsto_min: 60, previsto_nao_coberto_min: 60, extra_min: 0, faltante_min: 0 },
  },
  {
    nome: '15 [obrig. 3] extra líquida no dia: entrou tarde, saiu mais tarde ainda',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['07:00', '13:30']) })]),
    dia: { trabalhado_no_previsto_min: 300, trabalhado_fora_previsto_min: 90, previsto_nao_coberto_min: 60, extra_min: 30, faltante_min: 0 },
  },
  {
    nome: '16 [obrig. 4] faltante líquida no dia: chegou antes mas saiu bem antes',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['05:00', '10:00']) })]),
    dia: { trabalhado_no_previsto_min: 240, trabalhado_fora_previsto_min: 60, previsto_nao_coberto_min: 120, extra_min: 0, faltante_min: 60 },
  },
  {
    nome: '17 [obrig. 5] atestado sobreposto a horário trabalhado (sem dupla contagem)',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:00', '10:00']) })],
      { atestados: [atestado('2026-10-05', '2026-10-05', { horas: ['09:00', '11:00'] })] }),
    dia: { trabalhado_min: 240, atestado_min: 60, previsto_nao_coberto_min: 60, faltante_min: 60 },
  },
  {
    nome: '18 atestado parcialmente fora da jornada prevista',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:00', '11:00']) })],
      { atestados: [atestado('2026-10-05', '2026-10-05', { horas: ['11:00', '13:00'] })] }),
    dia: { trabalhado_min: 300, atestado_min: 60, faltante_min: 0, extra_min: 0 },
  },
  {
    nome: '19 um atestado cobrindo três dias (10, 11 e 12)',
    base: base([
      dia('2026-10-09', { escala: SEIS, lanc: comPeriodos(['06:00', '12:00']) }),
      dia('2026-10-10', { escala: SEIS }),
      dia('2026-10-11', { escala: comOcorrencia(SEIS, 'falta') }),
      dia('2026-10-12', { escala: trabalho(['06:00', '09:00'], ['09:15', '12:00']) }),
    ], { atestados: [atestado('2026-10-10', '2026-10-12')] }),
    dias: {
      '2026-10-09': { situacao: 'trabalho', atestado_cobertura: null, atestado_min: 0 },
      '2026-10-10': { situacao: 'atestado', atestado_min: 360, pendencias: [] },
      '2026-10-11': { situacao_escala: 'falta', situacao: 'atestado', atestado_min: 360 },
      '2026-10-12': { situacao: 'atestado', atestado_min: 345 },
    },
    totais: { atestado_min: 1065, atestados_integrais_qtd: 3, faltas_qtd: 0, faltante_min: 0, dias_pendentes: 0 },
  },
  {
    nome: '20 [obrig. 11] atestado cobrindo dias atuais e futuros (sem marcação futura)',
    base: base([
      dia('2026-11-19', { escala: SEIS }),
      dia('2026-11-20', { escala: SEIS }),
      dia('2026-11-21', { escala: SEIS }),
      dia('2026-11-22', { escala: FOLGA }),
    ], { competencia: '2026-11-01', atestados: [atestado('2026-11-19', '2026-11-22')] }),
    dias: {
      '2026-11-19': { situacao: 'atestado', futuro: false, atestado_min: 360 },
      '2026-11-20': { situacao: 'atestado', futuro: false, atestado_min: 360 },
      '2026-11-21': { situacao: 'atestado', futuro: true, atestado_cobertura: 'integral', atestado_min: null, pendencias: [] },
      '2026-11-22': { situacao: 'folga', futuro: true, atestado_cobertura: 'integral', atestado_min: null },
    },
    totais: { atestado_min: 720, atestados_integrais_qtd: 2 },
    encerrada: false,
  },
  {
    nome: '21 atestado cobrindo dias de trabalho e folga',
    base: base([
      dia('2026-10-10', { escala: SEIS }),
      dia('2026-10-11', { escala: FOLGA }),
      dia('2026-10-12', { escala: SEIS }),
    ], { atestados: [atestado('2026-10-10', '2026-10-12')] }),
    dias: {
      '2026-10-10': { situacao: 'atestado', atestado_min: 360 },
      '2026-10-11': { situacao: 'folga', atestado_cobertura: 'integral', previsto_min: 0, atestado_min: 0, pendencias: [] },
      '2026-10-12': { situacao: 'atestado', atestado_min: 360 },
    },
    totais: { atestado_min: 720, atestados_integrais_qtd: 2 },
  },
  {
    nome: '22a feriado com folga',
    base: base([dia('2026-11-02', { escala: FOLGA, feriado: 'Finados' })]),
    dia: { feriado: 'Finados', situacao: 'folga', previsto_min: 0, pendencias: [] },
  },
  {
    nome: '22b feriado com trabalho segue a Escala (sem regra especial)',
    base: base([dia('2026-11-02', { escala: SEIS, feriado: 'Finados', lanc: comPeriodos(['06:00', '12:00']) })]),
    dia: { feriado: 'Finados', previsto_min: 360, trabalhado_min: 360, extra_min: 0 },
  },
  {
    nome: '23a [obrig. 13] dia sem Escala = pendência (nunca folga, nunca zero previsto)',
    base: base([dia('2026-10-05')]),
    dia: { situacao: 'nao_definido', previsto_min: null, faltante_min: null, pendencias: ['sem_escala'] },
    totais: { dias_pendentes: 1 },
  },
  {
    nome: '23b dia sem Escala com trabalho ajustado: previsto desconhecido',
    base: base([dia('2026-10-05', { lanc: lancamento({ situacao: 'trabalho', motivo: 'Veio cobrir', periodos: [['06:00', '10:00']] }) })]),
    dia: { situacao: 'trabalho', trabalhado_min: 240, previsto_min: null, extra_min: null, faltante_min: null, pendencias: ['sem_previsto'] },
  },
  {
    nome: '23c atestado sobre dia sem Escala continua pendente',
    base: base([dia('2026-10-05')], { atestados: [atestado('2026-10-05')] }),
    dia: { situacao: 'nao_definido', atestado_cobertura: 'integral', atestado_min: null, pendencias: ['sem_escala'] },
  },
  {
    nome: '23d dia sem Escala regularizado explicitamente como folga (com motivo)',
    base: base([dia('2026-10-05', { lanc: lancamento({ situacao: 'folga', motivo: 'Folga combinada, Escala não lançada' }) })]),
    dia: { situacao_escala: 'nao_definido', situacao: 'folga', ajustado: true, previsto_min: 0, pendencias: [] },
  },
  {
    nome: '24 antes da admissão',
    base: base([dia('2026-10-10', { escala: SEIS })], { funcionario: { ...FUNCIONARIA, data_admissao: '2026-10-15' } }),
    dia: { fora_vinculo: 'antes_admissao', situacao: 'fora_vinculo', previsto_min: null, pendencias: [] },
  },
  {
    nome: '25 depois do desligamento',
    base: base([dia('2026-10-21', { escala: SEIS })], { funcionario: { ...FUNCIONARIA, data_demissao: '2026-10-20' } }),
    dia: { fora_vinculo: 'apos_desligamento', situacao: 'fora_vinculo', pendencias: [] },
  },
  {
    nome: '25b afastamento que ultrapassa o desligamento: só os dias do vínculo contam',
    base: base([dia('2026-10-19', { escala: SEIS }), dia('2026-10-20', { escala: SEIS }), dia('2026-10-21', { escala: SEIS }), dia('2026-10-22', { escala: SEIS })],
      { funcionario: { ...FUNCIONARIA, data_demissao: '2026-10-20' }, atestados: [atestado('2026-10-15', '2026-12-31')] }),
    dias: {
      '2026-10-20': { situacao: 'atestado', atestado_cobertura: 'integral', previsto_min: 360, atestado_min: 360, faltante_min: 0 },
      '2026-10-21': { fora_vinculo: 'apos_desligamento', situacao: 'fora_vinculo', atestado_cobertura: null, previsto_min: null, atestado_min: null, faltante_min: null, pendencias: [] },
      '2026-10-22': { situacao: 'fora_vinculo', atestado_cobertura: null, atestado_min: null },
    },
    totais: { previsto_min: 720, atestado_min: 720, faltante_min: 0, atestados_integrais_qtd: 2, dias_pendentes: 0 },
  },
  {
    nome: '26 dia com vínculo freelancer fica fora do cartão',
    base: base([dia('2026-10-05', { escala: SEIS, vinculo: 'freelancer' })]),
    dia: { fora_vinculo: 'outro_vinculo', pendencias: [] },
  },
  {
    nome: '27 competência passada antiga apura normalmente',
    base: base([dia('2025-03-03', { escala: SEIS, lanc: comPeriodos(['06:00', '12:00']) })], { competencia: '2025-03-01' }),
    dia: { futuro: false, trabalhado_min: 360, pendencias: [] },
  },
  {
    nome: '28 data futura não é apurada nem pendente',
    base: base([dia('2026-11-21', { escala: SEIS })], { competencia: '2026-11-01' }),
    dia: { futuro: true, previsto_escala_min: 360, previsto_min: null, trabalhado_min: null, pendencias: [] },
    encerrada: false,
  },
  {
    nome: '29 trabalho previsto sem lançamento = pendente',
    base: base([dia('2026-10-05', { escala: SEIS })]),
    dia: { trabalhado_min: 0, faltante_min: 360, pendencias: ['sem_lancamento'] },
  },
  {
    nome: '30 Escala virou Falta depois do lançamento = incoerente',
    base: base([dia('2026-10-05', { escala: comOcorrencia(SEIS, 'falta'), lanc: comPeriodos(['06:00', '12:00']) })]),
    dia: { situacao: 'falta', pendencias: ['escala_incoerente'] },
  },
  {
    nome: '31 ajuste Falta e a Escala virou folga = incoerente',
    base: base([dia('2026-10-05', { escala: FOLGA, lanc: lancamento({ situacao: 'falta', motivo: 'x' }) })]),
    dia: { situacao: 'falta', faltante_min: null, pendencias: ['escala_incoerente'] },
  },
  {
    nome: '32 Escala removida depois do lançamento = sem_escala + incoerente',
    base: base([dia('2026-10-05', { lanc: comPeriodos(['06:00', '12:00']) })]),
    dia: { situacao: 'nao_definido', pendencias: ['sem_escala', 'escala_incoerente'] },
  },
  {
    nome: '33 lançamento num dia fora do vínculo',
    base: base([dia('2026-10-05', { escala: SEIS, vinculo: 'pj', lanc: comPeriodos(['06:00', '12:00']) })]),
    dia: { fora_vinculo: 'outro_vinculo', pendencias: ['lancamento_fora_vinculo'] },
  },
  {
    nome: '34 dois atestados parciais + previsto em dois períodos',
    base: base([dia('2026-10-05', { escala: trabalho(['06:00', '10:00'], ['14:00', '18:00']), lanc: comPeriodos(['06:00', '09:00'], ['15:00', '18:00']) })], {
      atestados: [atestado('2026-10-05', '2026-10-05', { horas: ['09:00', '10:30'] }), atestado('2026-10-05', '2026-10-05', { horas: ['13:00', '15:00'], tipo: 'outro', descricao: 'Exame' })],
    }),
    // atestado dentro do previsto e não trabalhado: 09:00–10:00 (60) + 14:00–15:00 (60)
    dia: { previsto_min: 480, trabalhado_min: 360, atestado_min: 120, previsto_nao_coberto_min: 0, faltante_min: 0, intervalo_min: 360 },
  },
  {
    nome: '35 falta com comparecimento parcial: parte justificada, resto faltante',
    base: base([dia('2026-10-05', { escala: comOcorrencia(SEIS, 'falta') })], { atestados: [atestado('2026-10-05', '2026-10-05', { horas: ['06:00', '08:00'], tipo: 'comparecimento' })] }),
    dia: { situacao: 'falta', atestado_min: 120, faltante_min: 240 },
    totais: { faltas_qtd: 1 },
  },
  {
    nome: '36 dispensa (trabalho na Escala ajustado para folga, com motivo)',
    base: base([dia('2026-10-05', { escala: SEIS, lanc: lancamento({ situacao: 'folga', motivo: 'Dispensada' }) })]),
    dia: { situacao: 'folga', previsto_escala_min: 360, previsto_min: 0, faltante_min: 0, pendencias: [] },
  },
  {
    nome: '37 [obrig. 3/4] totais do mês sem compensação entre dias',
    base: base([
      dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:00', '12:30']) }), // +30
      dia('2026-10-06', { escala: SEIS, lanc: comPeriodos(['06:00', '11:30']) }), // -30
      dia('2026-10-07', { escala: comOcorrencia(SEIS, 'falta') }),
      dia('2026-10-08', { escala: comOcorrencia(SEIS, 'atestado') }),
      dia('2026-10-09', { escala: FOLGA }),
      dia('2026-10-10', { escala: trabalho(['06:00', '09:00'], ['09:15', '12:00']), lanc: comPeriodos(['06:00', '09:00'], ['09:20', '12:00']) }),
    ]),
    totais: {
      previsto_min: 360 * 4 + 345,
      trabalhado_min: 390 + 330 + 340,
      trabalhado_no_previsto_min: 360 + 330 + 340,
      trabalhado_fora_previsto_min: 30,
      intervalo_min: 20,
      atestado_min: 360,
      previsto_nao_coberto_min: 30 + 360 + 5,
      extra_min: 30,
      faltante_min: 30 + 360 + 5,
      faltas_qtd: 1,
      atestados_integrais_qtd: 1,
      dias_trabalhados: 3,
      dias_pendentes: 0,
    },
    encerrada: true,
  },
];

// Validação do lançamento: lancamento.test.mjs confere validarItemDia;
// paridadeSql.test.mjs confere que a RPC devolve o MESMO código.
export const CASOS_VALIDACAO = [
  { nome: 'data futura', d: dia('2026-11-21', { escala: SEIS }), item: { data: '2026-11-21', periodos: [{ entrada: '06:00', saida: '12:00' }] }, codigo: 'data_futura' },
  { nome: 'antes da admissão', d: dia('2025-01-05', { escala: SEIS }), item: { data: '2025-01-05' }, codigo: 'fora_vinculo' },
  { nome: 'situação inválida', d: dia('2026-10-05', { escala: SEIS }), item: { data: '2026-10-05', situacao: 'ferias' }, codigo: 'situacao_invalida' },
  { nome: 'atestado não é ajuste', d: dia('2026-10-05', { escala: comOcorrencia(SEIS, 'falta') }), item: { data: '2026-10-05', situacao: 'atestado', motivo: 'x' }, codigo: 'situacao_invalida' },
  { nome: 'ajuste sem motivo', d: dia('2026-10-05', { escala: comOcorrencia(SEIS, 'falta') }), item: { data: '2026-10-05', situacao: 'trabalho', motivo: '  ' }, codigo: 'motivo_obrigatorio' },
  { nome: 'falta em folga', d: dia('2026-10-05', { escala: FOLGA }), item: { data: '2026-10-05', situacao: 'falta', motivo: 'x' }, codigo: 'ajuste_invalido' },
  { nome: 'horário em dia de falta', d: dia('2026-10-05', { escala: comOcorrencia(SEIS, 'falta') }), item: { data: '2026-10-05', periodos: [{ entrada: '06:00', saida: '12:00' }] }, codigo: 'lancamento_exige_trabalho' },
  { nome: 'horário em folga sem ajuste', d: dia('2026-10-05', { escala: FOLGA }), item: { data: '2026-10-05', periodos: [{ entrada: '06:00', saida: '12:00' }] }, codigo: 'lancamento_exige_trabalho' },
  { nome: 'horário em dia sem Escala sem ajuste', d: dia('2026-10-05'), item: { data: '2026-10-05', periodos: [{ entrada: '06:00', saida: '12:00' }] }, codigo: 'lancamento_exige_trabalho' },
  { nome: '[obrig. 8] horário em dia com atestado integral', d: dia('2026-10-05', { escala: SEIS }), atestados: [{ abrangencia: 'integral', data_inicio: '2026-10-04', data_fim: '2026-10-06' }], item: { data: '2026-10-05', periodos: [{ entrada: '06:00', saida: '12:00' }] }, codigo: 'dia_com_atestado_integral' },
  { nome: 'hora inválida', d: dia('2026-10-05', { escala: SEIS }), item: { data: '2026-10-05', periodos: [{ entrada: '6:00', saida: '12:00' }] }, codigo: 'hora_invalida' },
  { nome: 'saída antes da entrada', d: dia('2026-10-05', { escala: SEIS }), item: { data: '2026-10-05', periodos: [{ entrada: '12:00', saida: '06:00' }] }, codigo: 'periodo_invalido' },
  { nome: 'períodos sobrepostos', d: dia('2026-10-05', { escala: SEIS }), item: { data: '2026-10-05', periodos: [{ entrada: '06:00', saida: '09:00' }, { entrada: '08:59', saida: '12:00' }] }, codigo: 'periodos_sobrepostos' },
  { nome: 'períodos demais', d: dia('2026-10-05', { escala: SEIS }), item: { data: '2026-10-05', periodos: ['01', '03', '05', '07', '09', '11', '13'].map((h) => ({ entrada: `${h}:00`, saida: `${h}:30` })) }, codigo: 'periodos_demais' },
  { nome: 'observação longa', d: dia('2026-10-05', { escala: SEIS }), item: { data: '2026-10-05', observacao: 'x'.repeat(501) }, codigo: 'observacao_longa' },
];

// Validação do atestado (campos): validarAtestado x folha_ponto_atestado_salvar.
// `outros` = atestados já registrados antes (sobreposição).
const ATESTADO_OK = { tipo: 'atestado_medico', abrangencia: 'integral', data_inicio: '2026-10-10', data_fim: '2026-10-12', hora_inicio: null, hora_fim: null, descricao: 'Dr. Fulano, entregue 13/10' };
export const CASOS_ATESTADO = [
  { nome: 'tipo inválido', atestado: { ...ATESTADO_OK, tipo: 'ferias' }, codigo: 'atestado_tipo_invalido' },
  { nome: '[obrig. 7] sem descrição (só espaços): aceito', atestado: { ...ATESTADO_OK, descricao: '   ' }, codigo: null },
  { nome: '[obrig. 7] descrição nula: aceito', atestado: { ...ATESTADO_OK, descricao: null }, codigo: null },
  { nome: 'descrição longa', atestado: { ...ATESTADO_OK, descricao: 'x'.repeat(501) }, codigo: 'observacao_longa' },
  { nome: 'abrangência inválida', atestado: { ...ATESTADO_OK, abrangencia: 'meio' }, codigo: 'atestado_abrangencia_invalida' },
  { nome: 'fim antes do início', atestado: { ...ATESTADO_OK, data_fim: '2026-10-09' }, codigo: 'atestado_periodo_invalido' },
  { nome: '[obrig. 9] 180 dias (mais de 90): aceito', atestado: { ...ATESTADO_OK, data_inicio: '2026-06-01', data_fim: '2026-11-27' }, codigo: null },
  { nome: 'parcial em 2 dias', atestado: { ...ATESTADO_OK, abrangencia: 'parcial', hora_inicio: '08:00', hora_fim: '10:00' }, codigo: 'atestado_parcial_um_dia' },
  { nome: 'parcial com hora inválida', atestado: { ...ATESTADO_OK, abrangencia: 'parcial', data_fim: '2026-10-10', hora_inicio: '8:00', hora_fim: '10:00' }, codigo: 'hora_invalida' },
  { nome: 'parcial fim antes do início', atestado: { ...ATESTADO_OK, abrangencia: 'parcial', data_fim: '2026-10-10', hora_inicio: '10:00', hora_fim: '08:00' }, codigo: 'atestado_horario_invalido' },
  { nome: 'integral sobre outro integral', outros: [{ ...ATESTADO_OK, data_inicio: '2026-10-12', data_fim: '2026-10-14' }], atestado: ATESTADO_OK, codigo: 'atestado_sobreposto' },
  { nome: 'parcial sobre integral', outros: [ATESTADO_OK], atestado: { ...ATESTADO_OK, abrangencia: 'parcial', data_inicio: '2026-10-11', data_fim: '2026-10-11', hora_inicio: '08:00', hora_fim: '10:00' }, codigo: 'atestado_sobreposto' },
  { nome: 'parciais com horário sobreposto', outros: [{ ...ATESTADO_OK, abrangencia: 'parcial', data_fim: '2026-10-10', hora_inicio: '08:00', hora_fim: '10:00' }], atestado: { ...ATESTADO_OK, abrangencia: 'parcial', data_fim: '2026-10-10', hora_inicio: '09:30', hora_fim: '11:00' }, codigo: 'atestado_sobreposto' },
  { nome: 'parciais no mesmo dia sem sobreposição: aceito', outros: [{ ...ATESTADO_OK, abrangencia: 'parcial', data_fim: '2026-10-10', hora_inicio: '08:00', hora_fim: '10:00' }], atestado: { ...ATESTADO_OK, abrangencia: 'parcial', data_fim: '2026-10-10', hora_inicio: '10:00', hora_fim: '11:00' }, codigo: null },
  { nome: 'integral com datas futuras: aceito', atestado: { ...ATESTADO_OK, data_inicio: '2026-11-19', data_fim: '2026-11-25' }, codigo: null },
];
