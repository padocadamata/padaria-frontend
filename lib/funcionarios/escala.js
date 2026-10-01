import { createClient } from '../supabase/client';
import { somarDias } from '../data/dataLocal';

// Escala por DATA (migration 0055) -- NUNCA escala padrão recorrente
// (decisão revisada explicitamente após a Agenda ter sido descartada como
// precedente arquitetural: a operação real varia demais para um modelo de
// regra+exceção fazer sentido). Este módulo só tem funções puras de
// formatação/agregação/montagem de payload + a busca em lote (nunca 1
// query por funcionário/dia) -- toda a lógica de "o que fazer com o
// resultado" mora nas páginas/componentes que chamam.

// "HH:MM:SS" (vindo do Postgres, tipo `time`) -> "HH:MM" para exibição.
export function formatarHora(horaComSegundos) {
  if (!horaComSegundos) return '';
  return horaComSegundos.slice(0, 5);
}

export function formatarPeriodo(periodo) {
  return `${formatarHora(periodo.hora_inicio)}–${formatarHora(periodo.hora_fim)}`;
}

// Domingo=0 .. Sábado=6, mesma convenção de agenda_itens.recorrencia_dias_
// semana -- não inventa uma segunda numeração de dia da semana no projeto.
// Mesma técnica T12:00:00 de lib/agenda/expandirRecorrencia.js para nunca
// sofrer o bug de fuso ao fazer `new Date('YYYY-MM-DD')` cru.
export function diaDaSemanaIndice(dataYYYYMMDD) {
  return new Date(`${dataYYYYMMDD}T12:00:00`).getDay();
}

// SEMANA OPERACIONAL da Escala (visões Semanal e Cobertura): SEGUNDA a
// DOMINGO -- o domingo fecha a semana (pagamentos semanais costumam sair
// no domingo). Só define navegação/apresentação: datas gravadas, Escala
// Padrão (dia_semana Domingo=0) e a visão Mensal não dependem disto -- o
// Mensal usa apenas diaDaSemanaIndice/ROTULO_DIA_SEMANA, que continuam
// na convenção Domingo=0 acima/abaixo.
// Posição do dia na semana operacional: Segunda=0 .. Domingo=6.
export function indiceNaSemanaOperacional(dataYYYYMMDD) {
  return (diaDaSemanaIndice(dataYYYYMMDD) + 6) % 7;
}

// Segunda-feira da semana operacional que contém `data`.
export function inicioDaSemana(dataYYYYMMDD) {
  return somarDias(dataYYYYMMDD, -indiceNaSemanaOperacional(dataYYYYMMDD));
}

// As 7 datas (segunda a domingo) da semana operacional que contém `data`.
export function diasDaSemana(dataYYYYMMDD) {
  const inicio = inicioDaSemana(dataYYYYMMDD);
  return Array.from({ length: 7 }, (_, i) => somarDias(inicio, i));
}

// Indexado por diaDaSemanaIndice (Domingo=0) -- nunca pela posição da
// coluna; use rotuloDiaSemana(data) para rotular a partir da data.
export const ROTULO_DIA_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function rotuloDiaSemana(dataYYYYMMDD) {
  return ROTULO_DIA_SEMANA[diaDaSemanaIndice(dataYYYYMMDD)];
}

export function formatarDataCurta(dataYYYYMMDD) {
  const [, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}`;
}

// Título "27/09 — 03/10/2026" (ou com os dois anos, se o período cruzar
// virada de ano) para o cabeçalho de navegação -- reaproveitado pela Visão
// Semanal (sempre 7 dias) e pela Visão Cobertura (período flexível, 1 a 7
// dias) -- por isso usa o ÚLTIMO elemento do array, não um índice fixo.
export function formatarPeriodoSemana(dias) {
  const [anoIni, mesIni, diaIni] = dias[0].split('-');
  if (dias.length === 1) return `${diaIni}/${mesIni}/${anoIni}`;
  const [anoFim, mesFim, diaFim] = dias[dias.length - 1].split('-');
  if (anoIni === anoFim) return `${diaIni}/${mesIni} — ${diaFim}/${mesFim}/${anoFim}`;
  return `${diaIni}/${mesIni}/${anoIni} — ${diaFim}/${mesFim}/${anoFim}`;
}

// Junta dias+períodos+ocorrências (já carregados em lote) num
// Map<funcionario_id, Map<data, EstadoDia>>. EstadoDia = { id, tipo:
// 'trabalho'|'folga', periodos: [{hora_inicio,hora_fim}] (ordenados),
// ocorrencia: {tipo,observacao}|null }. Ausência de entrada = "não
// definido" -- NUNCA confundido com folga (estado explícito, sempre
// presente como uma EstadoDia real quando existe).
export function construirMapaEscala(dias, periodosPorDiaId, ocorrenciasPorDiaId) {
  const mapa = new Map();
  for (const dia of dias) {
    if (!mapa.has(dia.funcionario_id)) mapa.set(dia.funcionario_id, new Map());
    const periodos = (periodosPorDiaId.get(dia.id) || [])
      .slice()
      .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
    mapa.get(dia.funcionario_id).set(dia.data, {
      id: dia.id,
      tipo: dia.tipo_dia,
      periodos,
      ocorrencia: ocorrenciasPorDiaId.get(dia.id) || null,
    });
  }
  return mapa;
}

export function obterEstadoDia(mapaEscala, funcionarioId, data) {
  return mapaEscala.get(funcionarioId)?.get(data) || null;
}

// Busca em LOTE (nunca 1 query por funcionário/dia) o estado de escala de
// um conjunto de funcionários numa janela de datas -- até 3 consultas no
// total, para qualquer tamanho de janela/quantidade de funcionários (mesma
// arquitetura de lib/pedidos/historicoCompras.js: janela bem delimitada,
// nunca "todo o histórico").
export async function buscarEscalaPeriodo(funcionarioIds, dataInicio, dataFim) {
  const idsUnicos = Array.from(new Set((funcionarioIds || []).filter(Boolean)));
  if (idsUnicos.length === 0) return new Map();

  const supabase = createClient();

  const { data: diasData, error: erroDias } = await supabase
    .from('funcionarios_escala_dias')
    .select('id, funcionario_id, data, tipo_dia, observacao')
    .in('funcionario_id', idsUnicos)
    .gte('data', dataInicio)
    .lte('data', dataFim);

  if (erroDias) {
    console.error('Erro ao carregar escala (dias):', erroDias);
    return new Map();
  }

  const diaIds = (diasData || []).map((d) => d.id);
  let periodosData = [];
  let ocorrenciasData = [];

  if (diaIds.length > 0) {
    const [periodosResp, ocorrenciasResp] = await Promise.all([
      supabase.from('funcionarios_escala_periodos').select('id, escala_dia_id, hora_inicio, hora_fim, natureza_financeira').in('escala_dia_id', diaIds),
      supabase.from('funcionarios_escala_ocorrencias').select('id, escala_dia_id, tipo, observacao').in('escala_dia_id', diaIds),
    ]);
    if (periodosResp.error) console.error('Erro ao carregar escala (períodos):', periodosResp.error);
    if (ocorrenciasResp.error) console.error('Erro ao carregar escala (ocorrências):', ocorrenciasResp.error);
    periodosData = periodosResp.data || [];
    ocorrenciasData = ocorrenciasResp.data || [];
  }

  const periodosPorDiaId = new Map();
  for (const p of periodosData) {
    if (!periodosPorDiaId.has(p.escala_dia_id)) periodosPorDiaId.set(p.escala_dia_id, []);
    periodosPorDiaId.get(p.escala_dia_id).push(p);
  }

  const ocorrenciasPorDiaId = new Map();
  for (const o of ocorrenciasData) {
    ocorrenciasPorDiaId.set(o.escala_dia_id, o);
  }

  return construirMapaEscala(diasData || [], periodosPorDiaId, ocorrenciasPorDiaId);
}

// ------------------------------------------------------------
// Montagem de payload para aplicar_escala_em_lote (RPC única de escrita) --
// "copiar dia"/"copiar semana"/"aplicar em lote" são todas o MESMO array,
// só de tamanho/origem diferente.
// ------------------------------------------------------------

// Item para 1 funcionário em 1 data, a partir de um EstadoDia de origem (ou
// de tipo/períodos explícitos). `null` quando a origem é "não definido"
// (nada a copiar).
//
// natureza_financeira (migration 0065/0066, frente Pagamentos): só entra no
// payload quando o período de origem já tem o campo preenchido -- preserva
// uma classificação extra_remunerado já existente ao resalvar/copiar;
// ausência do campo é exatamente o comportamento antigo (aplicar_escala_em_
// lote trata ausente/vazio como 'normal'), então todo chamador que nunca
// conheceu esse campo (lote, aplicação em massa) continua funcionando
// idêntico.
export function construirItemEscala({ funcionarioId, data, tipoDia, periodos }) {
  if (!tipoDia) return null;
  return {
    funcionario_id: funcionarioId,
    data,
    tipo_dia: tipoDia,
    periodos:
      tipoDia === 'trabalho'
        ? (periodos || []).map((p) => ({
            hora_inicio: formatarHora(p.hora_inicio),
            hora_fim: formatarHora(p.hora_fim),
            ...(p.natureza_financeira ? { natureza_financeira: p.natureza_financeira } : {}),
          }))
        : [],
  };
}

export function construirCopiaDia({ funcionarioId, estadoOrigem, dataDestino }) {
  if (!estadoOrigem) return null;
  return construirItemEscala({ funcionarioId, data: dataDestino, tipoDia: estadoOrigem.tipo, periodos: estadoOrigem.periodos });
}

// "Copiar semana anterior" (recurso mais usado, seção 10 da arquitetura
// aprovada): mesma semana inteira (7 dias, segunda->segunda ...
// domingo->domingo, pois origem e destino são ambos segundas-feiras e o
// deslocamento é sempre de 7 dias), mesmo offset para todos os
// funcionários selecionados. Dias "não definidos" na origem simplesmente
// não entram no array (nada a copiar, não sobrescreve nada no destino).
export function construirCopiaSemana({ funcionarioIds, mapaEscala, semanaOrigemInicio, semanaDestinoInicio }) {
  const atribuicoes = [];
  for (let i = 0; i < 7; i++) {
    const dataOrigem = somarDias(semanaOrigemInicio, i);
    const dataDestino = somarDias(semanaDestinoInicio, i);
    for (const funcionarioId of funcionarioIds) {
      const item = construirCopiaDia({ funcionarioId, estadoOrigem: obterEstadoDia(mapaEscala, funcionarioId, dataOrigem), dataDestino });
      if (item) atribuicoes.push(item);
    }
  }
  return atribuicoes;
}

// "Aplicar horário a vários dias/funcionários selecionados": mesmo
// tipo_dia/períodos para todo o produto cartesiano funcionarioIds x datas.
export function construirAplicacaoEmLote({ funcionarioIds, datas, tipoDia, periodos }) {
  const atribuicoes = [];
  for (const funcionarioId of funcionarioIds) {
    for (const data of datas) {
      atribuicoes.push(construirItemEscala({ funcionarioId, data, tipoDia, periodos }));
    }
  }
  return atribuicoes;
}

// Detecta se algum (funcionário, data) do alvo já tem estado definido
// (trabalho ou folga) -- usado para exigir confirmação explícita antes de
// uma operação que sobrescreveria escala já existente (seção 10 da
// arquitetura aprovada: "sempre permitir revisar antes de substituições
// perigosas").
export function detectarSobrescritas({ funcionarioIds, datas, mapaEscala }) {
  const conflitos = [];
  for (const funcionarioId of funcionarioIds) {
    for (const data of datas) {
      const estado = obterEstadoDia(mapaEscala, funcionarioId, data);
      if (estado) conflitos.push({ funcionarioId, data, estadoAnterior: estado });
    }
  }
  return conflitos;
}

// ------------------------------------------------------------
// Escala Padrão (template semanal, migration 0059) -- SOMENTE origem para
// materializar dias vazios via a RPC aplicar_escala_padrao. NUNCA é
// consultada para calcular a escala operacional diretamente (Mensal e
// Cobertura continuam lendo exclusivamente funcionarios_escala_dias/
// periodos, nunca estas tabelas).
// ------------------------------------------------------------

// Map<funcionario_id, Map<dia_semana, EstadoPadraoDia>>. EstadoPadraoDia =
// { id, tipo: 'trabalho'|'folga', periodos: [{hora_inicio,hora_fim}] }.
// Ausência de entrada = "não configurado" -- mesmo princípio de
// construirMapaEscala, nunca confundido com folga.
export function construirMapaEscalaPadrao(dias, periodosPorDiaId) {
  const mapa = new Map();
  for (const dia of dias) {
    if (!mapa.has(dia.funcionario_id)) mapa.set(dia.funcionario_id, new Map());
    const periodos = (periodosPorDiaId.get(dia.id) || [])
      .slice()
      .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
    mapa.get(dia.funcionario_id).set(dia.dia_semana, {
      id: dia.id,
      tipo: dia.tipo_dia,
      periodos,
    });
  }
  return mapa;
}

export function obterEstadoPadraoDia(mapaEscalaPadrao, funcionarioId, diaSemana) {
  return mapaEscalaPadrao.get(funcionarioId)?.get(diaSemana) || null;
}

// Busca em LOTE (nunca 1 query por funcionário) o padrão de um conjunto de
// funcionários -- mesma arquitetura de buscarEscalaPeriodo, só sem janela
// de datas (o padrão não tem período -- é 1 semana fixa por funcionário).
export async function buscarEscalaPadrao(funcionarioIds) {
  const idsUnicos = Array.from(new Set((funcionarioIds || []).filter(Boolean)));
  if (idsUnicos.length === 0) return new Map();

  const supabase = createClient();

  const { data: diasData, error: erroDias } = await supabase
    .from('funcionarios_escala_padrao_dias')
    .select('id, funcionario_id, dia_semana, tipo_dia')
    .in('funcionario_id', idsUnicos);

  if (erroDias) {
    console.error('Erro ao carregar escala padrão (dias):', erroDias);
    return new Map();
  }

  const diaIds = (diasData || []).map((d) => d.id);
  let periodosData = [];

  if (diaIds.length > 0) {
    const { data, error } = await supabase
      .from('funcionarios_escala_padrao_periodos')
      .select('id, padrao_dia_id, hora_inicio, hora_fim')
      .in('padrao_dia_id', diaIds);
    if (error) console.error('Erro ao carregar escala padrão (períodos):', error);
    periodosData = data || [];
  }

  const periodosPorDiaId = new Map();
  for (const p of periodosData) {
    if (!periodosPorDiaId.has(p.padrao_dia_id)) periodosPorDiaId.set(p.padrao_dia_id, []);
    periodosPorDiaId.get(p.padrao_dia_id).push(p);
  }

  return construirMapaEscalaPadrao(diasData || [], periodosPorDiaId);
}

// Monta o payload para salvar_escala_padrao -- SEMPRE os 7 dias da semana
// (índice = dia_semana), nunca um diff parcial: a RPC salva a semana
// inteira atomicamente. `estadosPorDiaSemana[i]` = { tipo:
// 'trabalho'|'folga'|null, periodos } -- null ("não configurado") vira
// tipo_dia='remover' (apaga a linha se existir; idempotente se nunca
// existiu -- por isso é seguro sempre mandar os 7 dias, mesmo os que
// nunca foram tocados).
export function construirPayloadEscalaPadrao(estadosPorDiaSemana) {
  return estadosPorDiaSemana.map((estado, diaSemana) => ({
    dia_semana: diaSemana,
    tipo_dia: estado && estado.tipo ? estado.tipo : 'remover',
    periodos:
      estado && estado.tipo === 'trabalho'
        ? (estado.periodos || []).map((p) => ({ hora_inicio: formatarHora(p.hora_inicio), hora_fim: formatarHora(p.hora_fim) }))
        : [],
  }));
}

// Monta os argumentos de aplicar_escala_padrao a partir de uma semana
// (7 datas) e dos funcionários selecionados -- p_datas sempre as 7 datas da
// semana exibida na Visão Semanal (a RPC decide, por dia_semana, o que
// cada funcionário tem no padrão; dias sem padrão voltam como
// 'sem_padrao', nunca erro).
export function construirArgsAplicarEscalaPadrao({ funcionarioIds, datas }) {
  return { p_funcionario_ids: funcionarioIds, p_datas: datas };
}

// Agrega o retorno de aplicar_escala_padrao (1 linha por funcionário+data)
// em contagens por situação, para a UI resumir o resultado sem o
// chamador ter que conhecer os 4 valores possíveis de antemão.
export function resumirResultadoAplicacaoPadrao(linhas) {
  const resumo = { preenchido: 0, ignorado: 0, sem_padrao: 0, funcionario_inativo: 0 };
  for (const linha of linhas || []) {
    if (Object.prototype.hasOwnProperty.call(resumo, linha.situacao)) {
      resumo[linha.situacao] += 1;
    }
  }
  return resumo;
}

// Cobertura por horário (Mensal/Visão do Dia/Por Hora) foi movida para
// lib/funcionarios/escalaCobertura.js -- motor único, para os três
// consumidores nunca recalcularem identidade/faixas de formas diferentes.
