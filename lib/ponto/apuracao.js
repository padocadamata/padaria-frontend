import { cobertura, duracao, lacunas, MINUTOS_DIA } from './tempo.js';

// APURAÇÃO do Cartão-Ponto (migration 0078) -- núcleo ÚNICO de cálculo da
// tela, do PDF e do Excel. Só TEMPO (minutos) e controle: nenhum valor em
// R$, nenhuma ligação com Pagamentos. O SQL (folha_ponto_apurar) faz as
// MESMAS contas na conferência/fechamento -- paridade testada no PGlite
// (lib/ponto/__tests__/paridadeSql.test.mjs). Mudou uma regra aqui, muda
// lá e sobe CALCULO_VERSAO.
//
// Entrada = "base" do mês (RPC folha_ponto_base): funcionária, hoje
// (America/Sao_Paulo), competência, os atestados ativos que tocam o mês e
// um item por dia com o vínculo do dia, feriado, a Escala (planejado) e o
// lançamento do cartão (realizado).
//
// Regra, minuto a minuto (P = previsto na Escala, R = realizado, A =
// atestado; intervalos [início, fim)):
//   trabalhado no previsto     = R ∩ P
//   trabalhado fora do previsto = R − P
//   atestado (justificado)     = (A ∩ P) − R      -- nunca conta duas vezes
//   previsto não coberto       = P − R − A
// Então previsto = no previsto + atestado + não coberto, e o SALDO DO DIA
// (fora do previsto − não coberto) vira extra (se positivo) ou faltante (se
// negativo). Atestado não é hora trabalhada. Sem tolerância, sem
// arredondamento, sem compensação ENTRE dias (cada dia tem seu saldo; os
// totais só somam). Atestado integral = A cobre todo o previsto do dia.

export const CALCULO_VERSAO = 1;

// Ajustes manuais do dia (com motivo). Atestado NÃO é ajuste: é registrado
// como atestado (um ou vários dias) -- folha_ponto_atestados.
export const SITUACOES_AJUSTE = ['trabalho', 'folga', 'falta'];

export const ROTULO_SITUACAO = {
  trabalho: 'Trabalho',
  folga: 'Folga',
  falta: 'Falta',
  atestado: 'Atestado',
  nao_definido: 'Não definido',
  fora_vinculo: 'Fora do vínculo',
};

// Ordem fixa (a mesma do SQL) -- a lista de pendências do dia sai sempre
// nesta ordem.
export const PENDENCIAS = {
  sem_escala: 'Dia não definido na Escala.',
  sem_previsto: 'Sem jornada prevista na Escala para apurar este dia.',
  sem_lancamento: 'Horários ainda não lançados.',
  escala_incoerente: 'A Escala atual não combina com o que foi lançado neste dia.',
  lancamento_fora_vinculo: 'Há lançamento num dia fora do vínculo.',
};

export const TIPOS_ATESTADO = ['atestado_medico', 'comparecimento', 'outro'];

export const ROTULO_ATESTADO = {
  atestado_medico: 'Atestado médico',
  comparecimento: 'Comparecimento',
  outro: 'Outro',
};

export const FORA_VINCULO = {
  antes_admissao: 'Antes da admissão',
  apos_desligamento: 'Após o desligamento',
  outro_vinculo: 'Sem vínculo CLT nesta data',
};

const TOTAIS_MINUTOS = [
  'previsto_min', 'trabalhado_min', 'trabalhado_no_previsto_min', 'trabalhado_fora_previsto_min',
  'intervalo_min', 'atestado_min', 'previsto_nao_coberto_min', 'extra_min', 'faltante_min',
];

export function diaDaSemana(dataYYYYMMDD) {
  const [a, m, d] = dataYYYYMMDD.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

// Situação que a Escala, sozinha, dá ao dia.
export function situacaoDaEscala(escala) {
  if (!escala) return 'nao_definido';
  if (escala.tipo === 'folga') return 'folga';
  return escala.ocorrencia?.tipo || 'trabalho';
}

function previstoDaEscala(escala) {
  if (!escala) return null;
  if (escala.tipo !== 'trabalho') return 0;
  return duracao(escala.periodos);
}

export function motivoForaVinculo(funcionario, dia) {
  if (funcionario.data_admissao && dia.data < funcionario.data_admissao) return 'antes_admissao';
  if (funcionario.data_demissao && dia.data > funcionario.data_demissao) return 'apos_desligamento';
  if (dia.vinculo !== 'funcionario') return 'outro_vinculo';
  return null;
}

// Atestados ATIVOS que cobrem a data: { integral, parciais: [{inicio, fim}] }.
export function atestadosDoDia(atestados, data) {
  const doDia = (atestados || []).filter((a) => a.data_inicio <= data && a.data_fim >= data);
  return {
    integral: doDia.some((a) => a.abrangencia === 'integral'),
    parciais: doDia.filter((a) => a.abrangencia === 'parcial').map((a) => ({ inicio: a.hora_inicio, fim: a.hora_fim })),
  };
}

// As 4 categorias do dia, minuto a minuto.
export function categorias(previstos, realizados, atestados) {
  const p = cobertura(previstos);
  const r = cobertura(realizados, ['entrada', 'saida']);
  const a = cobertura(atestados);
  let noPrevisto = 0;
  let foraPrevisto = 0;
  let atestado = 0;
  let naoCoberto = 0;
  for (let m = 0; m < MINUTOS_DIA; m += 1) {
    if (p[m] && r[m]) noPrevisto += 1;
    if (r[m] && !p[m]) foraPrevisto += 1;
    if (a[m] && p[m] && !r[m]) atestado += 1;
    if (p[m] && !r[m] && !a[m]) naoCoberto += 1;
  }
  return { noPrevisto, foraPrevisto, atestado, naoCoberto };
}

function vazio() {
  return {
    previsto_min: null, trabalhado_min: null, trabalhado_no_previsto_min: null, trabalhado_fora_previsto_min: null,
    intervalo_min: null, atestado_min: null, previsto_nao_coberto_min: null, extra_min: null, faltante_min: null,
  };
}

export function apurarDia(dia, { funcionario, hoje, atestados }) {
  const escala = dia.escala || null;
  const lancamento = dia.lancamento || null;
  const situacaoEscala = situacaoDaEscala(escala);
  const fora = motivoForaVinculo(funcionario, dia);
  const futuro = dia.data > hoje;
  const cobertos = atestadosDoDia(atestados, dia.data);
  const periodos = lancamento?.periodos || [];
  const pendencias = [];

  const base = fora ? 'fora_vinculo' : lancamento?.situacao || situacaoEscala;
  // Atestado integral torna o dia "Atestado" quando havia jornada (trabalho
  // ou falta); folga coberta continua folga; dia não definido continua
  // pendente.
  const situacao = cobertos.integral && ['trabalho', 'falta', 'atestado'].includes(base) ? 'atestado' : base;

  const resultado = {
    data: dia.data,
    dia_semana: diaDaSemana(dia.data),
    feriado: dia.feriado || null,
    fora_vinculo: fora,
    futuro,
    situacao_escala: situacaoEscala,
    situacao,
    ajustado: !fora && Boolean(lancamento?.situacao),
    // Fora do vínculo (ex.: depois do desligamento) o atestado não conta.
    atestado_cobertura: fora ? null : cobertos.integral ? 'integral' : cobertos.parciais.length > 0 ? 'parcial' : null,
    previsto_escala_min: previstoDaEscala(escala),
    ...vazio(),
    pendencias,
  };

  if (fora) {
    if (lancamento) pendencias.push('lancamento_fora_vinculo');
    return resultado;
  }
  if (futuro) return resultado;

  if (situacao === 'nao_definido') {
    pendencias.push('sem_escala');
    if (periodos.length > 0) pendencias.push('escala_incoerente');
    return resultado;
  }

  const comJornada = situacao === 'trabalho' || situacao === 'falta' || situacao === 'atestado';
  if (comJornada && !escala) {
    // Ajuste sem Escala do dia: nada de previsto inventado.
    pendencias.push('sem_previsto');
    if (situacao === 'trabalho') {
      resultado.trabalhado_min = duracao(periodos, ['entrada', 'saida']);
      resultado.intervalo_min = lacunas(periodos, ['entrada', 'saida']);
      if (periodos.length === 0 && cobertos.parciais.length === 0) pendencias.push('sem_lancamento');
    } else if (periodos.length > 0) {
      pendencias.push('escala_incoerente');
    }
    return resultado;
  }
  if ((situacao === 'falta' || situacao === 'atestado') && escala.tipo !== 'trabalho') {
    pendencias.push('escala_incoerente');
    return resultado;
  }

  // Previsto: só a Escala de trabalho, e só se o dia não foi considerado folga.
  const previstos = situacao !== 'folga' && escala.tipo === 'trabalho' ? escala.periodos : [];
  const realizados = situacao === 'trabalho' ? periodos : [];
  const justificados = situacao === 'atestado' ? previstos : cobertos.parciais;
  const c = categorias(previstos, realizados, justificados);
  const saldo = c.foraPrevisto - c.naoCoberto;

  Object.assign(resultado, {
    previsto_min: duracao(previstos),
    trabalhado_min: duracao(realizados, ['entrada', 'saida']),
    trabalhado_no_previsto_min: c.noPrevisto,
    trabalhado_fora_previsto_min: c.foraPrevisto,
    intervalo_min: lacunas(realizados, ['entrada', 'saida']),
    atestado_min: c.atestado,
    previsto_nao_coberto_min: c.naoCoberto,
    extra_min: Math.max(0, saldo),
    faltante_min: Math.max(0, -saldo),
  });

  if (situacao === 'trabalho' && periodos.length === 0 && cobertos.parciais.length === 0) pendencias.push('sem_lancamento');
  if (situacao !== 'trabalho' && periodos.length > 0) pendencias.push('escala_incoerente');
  return resultado;
}

export function apurarCartao(base) {
  const contexto = { funcionario: base.funcionario, hoje: base.hoje, atestados: base.atestados || [] };
  const dias = base.dias.map((dia) => apurarDia(dia, contexto));
  const totais = Object.fromEntries(TOTAIS_MINUTOS.map((c) => [c, 0]));
  Object.assign(totais, { faltas_qtd: 0, atestados_integrais_qtd: 0, dias_trabalhados: 0, dias_pendentes: 0 });
  for (const dia of dias) {
    for (const campo of TOTAIS_MINUTOS) totais[campo] += dia[campo] ?? 0;
    const apurado = !dia.fora_vinculo && !dia.futuro;
    if (apurado && dia.situacao === 'falta') totais.faltas_qtd += 1;
    if (apurado && dia.situacao === 'atestado') totais.atestados_integrais_qtd += 1;
    if ((dia.trabalhado_min ?? 0) > 0) totais.dias_trabalhados += 1;
    if (dia.pendencias.length > 0) totais.dias_pendentes += 1;
  }
  const diasDentro = dias.filter((d) => !d.fora_vinculo);
  return {
    calculo_versao: CALCULO_VERSAO,
    dias,
    totais,
    // Conferência/fechamento: nenhum dia pendente e nenhum dia do vínculo
    // ainda por vir.
    competencia_encerrada: diasDentro.length > 0 && diasDentro.every((d) => !d.futuro),
  };
}

// O que a tela/PDF/Excel mostram: cartão FECHADO = somente o snapshot
// gravado no fechamento (nunca recalculado com a Escala de hoje); senão a
// apuração da base atual.
export function apuracaoParaExibir(baseComCartao) {
  const cartao = baseComCartao.cartao;
  if (cartao?.status === 'fechado') {
    return { origem: 'snapshot', base: cartao.snapshot.base, apuracao: cartao.snapshot.apuracao };
  }
  return { origem: 'atual', base: baseComCartao, apuracao: apurarCartao(baseComCartao) };
}

function canonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor).sort().map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`).join(',')}}`;
  }
  return JSON.stringify(valor ?? null);
}

// Datas em que a Escala/feriado/vínculo de HOJE diferem do snapshot de um
// cartão fechado -- só para avisar; o documento continua o do snapshot.
export function divergenciasDoSnapshot(snapshotBase, baseAtual) {
  const chave = (d) => canonico({ escala: d?.escala ?? null, feriado: d?.feriado ?? null, vinculo: d?.vinculo ?? null });
  const atual = new Map(baseAtual.dias.map((d) => [d.data, d]));
  return snapshotBase.dias.filter((d) => chave(d) !== chave(atual.get(d.data))).map((d) => d.data);
}
