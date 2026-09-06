// Expansão de recorrência da Agenda — espelha exatamente
// public.agenda_ocorrencia_e_valida (migration 0038). Qualquer mudança
// aqui precisa ser replicada lá, e vice-versa.
//
// NUNCA materializa ocorrências futuras em banco — expande só a janela
// de datas [inicioJanela, fimJanela] que a tela está exibindo, em
// memória, a cada chamada. mensal usa o dia-do-mês literal de
// data_inicio (mês sem esse dia não gera ocorrência, nunca desliza para
// o último dia); anual usa mês+dia literais (29/02 só ocorre em ano
// bissexto).
//
// Datas de calendário (YYYY-MM-DD) são sempre tratadas com a técnica de
// meio-dia local (T12:00:00), mesma usada em lib/data/dataLocal.js e
// lib/producao/sugestaoProducao.js — nunca `new Date('YYYY-MM-DD')` cru,
// que o navegador interpretaria como meia-noite UTC e poderia exibir o
// dia errado dependendo do fuso do dispositivo.

function paraData(dataYYYYMMDD) {
  return new Date(`${dataYYYYMMDD}T12:00:00`);
}

function paraYYYYMMDD(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function somarDiasCalendario(dataYYYYMMDD, dias) {
  const data = paraData(dataYYYYMMDD);
  data.setDate(data.getDate() + dias);
  return paraYYYYMMDD(data);
}

function diaDaSemana(dataYYYYMMDD) {
  return paraData(dataYYYYMMDD).getDay();
}

// Segunda-feira (ISO) da semana de uma data — mesma convenção de
// date_trunc('week', ...) do Postgres, usada só para contar "quantas
// semanas se passaram" no cálculo do intervalo semanal.
function segundaFeiraDaSemana(dataYYYYMMDD) {
  const data = paraData(dataYYYYMMDD);
  const dia = data.getDay(); // 0=domingo..6=sábado
  const deslocamento = dia === 0 ? -6 : 1 - dia;
  data.setDate(data.getDate() + deslocamento);
  return paraYYYYMMDD(data);
}

function diferencaEmDias(dataA, dataB) {
  const ms = paraData(dataA).getTime() - paraData(dataB).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

// Confirma se dataOcorrencia é uma ocorrência real da regra informada —
// mesma lógica de public.agenda_ocorrencia_e_valida.
export function ocorrenciaEValida(item, dataOcorrencia) {
  const { tipo_recorrencia: tipo, data_inicio: dataInicio, recorrencia_intervalo: intervalo,
    recorrencia_dias_semana: diasSemana, recorrencia_data_fim: dataFimSerie } = item;

  if (dataFimSerie && dataOcorrencia > dataFimSerie) return false;

  if (tipo === 'nenhuma') {
    return dataOcorrencia === dataInicio;
  }
  if (dataOcorrencia < dataInicio) return false;

  if (tipo === 'diaria') {
    return diferencaEmDias(dataOcorrencia, dataInicio) % intervalo === 0;
  }

  if (tipo === 'semanal') {
    if (!diasSemana.includes(diaDaSemana(dataOcorrencia))) return false;
    const semanaInicio = segundaFeiraDaSemana(dataInicio);
    const semanaOcorrencia = segundaFeiraDaSemana(dataOcorrencia);
    const semanasPassadas = diferencaEmDias(semanaOcorrencia, semanaInicio) / 7;
    return semanasPassadas % intervalo === 0;
  }

  const dInicio = paraData(dataInicio);
  const dOcorrencia = paraData(dataOcorrencia);

  if (tipo === 'mensal') {
    if (dOcorrencia.getDate() !== dInicio.getDate()) return false;
    const meses =
      (dOcorrencia.getFullYear() - dInicio.getFullYear()) * 12 + (dOcorrencia.getMonth() - dInicio.getMonth());
    return meses >= 0 && meses % intervalo === 0;
  }

  if (tipo === 'anual') {
    if (dOcorrencia.getMonth() !== dInicio.getMonth() || dOcorrencia.getDate() !== dInicio.getDate()) return false;
    const anos = dOcorrencia.getFullYear() - dInicio.getFullYear();
    return anos >= 0 && anos % intervalo === 0;
  }

  return false;
}

// Gera as datas candidatas de uma série dentro de [inicioJanela, fimJanela].
// Percorre dia a dia dentro da janela (volume baixo o suficiente para um
// mês/semana de tela — não é uma varredura de "todo o futuro") e usa
// ocorrenciaEValida para filtrar, garantindo que o mesmo critério da RPC
// é usado aqui.
function candidatasNaJanela(item, inicioJanela, fimJanela) {
  const inicio = item.data_inicio > inicioJanela ? item.data_inicio : inicioJanela;
  const candidatas = [];
  let atual = inicio;
  let protecao = 0;
  while (atual <= fimJanela && protecao < 400) {
    if (atual >= item.data_inicio && ocorrenciaEValida(item, atual)) {
      candidatas.push(atual);
    }
    atual = somarDiasCalendario(atual, 1);
    protecao += 1;
  }
  return candidatas;
}

// Expande séries + exceções numa janela de datas, devolvendo ocorrências
// já resolvidas (overrides/cancelamento/conclusão aplicados).
//
// Entrada:
//   itens: agenda_itens relevantes (avulsos que intersectam a janela +
//     séries com data_inicio <= fimJanela e recorrencia_data_fim NULL ou
//     >= inicioJanela — filtro já feito na consulta ao banco, ver
//     pages/agenda.js);
//   excecoes: agenda_ocorrencias das séries acima (todas, não só as da
//     janela — ver nota de consulta em pages/agenda.js sobre
//     data_override poder mover uma exceção para dentro/fora da janela);
//   inicioJanela/fimJanela: strings YYYY-MM-DD.
//
// Saída: array de { idOcorrencia, item, dataOcorrencia, dataExibicao,
//   titulo, descricao, horaInicio, horaFim, diaInteiro, cancelada,
//   concluida, concluidoEm, concluidoPor, observacaoConclusao, temExcecao }.
// idOcorrencia = `${agenda_item_id}|${data_ocorrencia ORIGINAL}` — nunca
// muda com data_override (identidade imutável, decisão aprovada).
export function expandirRecorrencia({ itens, excecoes, inicioJanela, fimJanela }) {
  const excecoesPorItem = new Map();
  for (const exc of excecoes) {
    if (!excecoesPorItem.has(exc.agenda_item_id)) {
      excecoesPorItem.set(exc.agenda_item_id, new Map());
    }
    excecoesPorItem.get(exc.agenda_item_id).set(exc.data_ocorrencia, exc);
  }

  const resultado = [];

  for (const item of itens) {
    const mapaExcecoes = excecoesPorItem.get(item.id) || new Map();

    if (item.tipo_recorrencia === 'nenhuma') {
      const fim = item.data_fim || item.data_inicio;
      // item avulso: só 1 "ocorrência" (a própria data_inicio); exceção
      // não se aplica a avulso, mas a tabela permite tecnicamente por
      // engano de dado — ignorada aqui de propósito (avulso só edita
      // agenda_itens direto).
      if (fim >= inicioJanela && item.data_inicio <= fimJanela) {
        resultado.push(construirOcorrencia(item, item.data_inicio, null));
      }
      continue;
    }

    const candidatas = candidatasNaJanela(item, inicioJanela, fimJanela);
    const datasResultado = new Set(candidatas);

    // Exceções cuja data ORIGINAL está fora da janela mas cujo
    // data_override cai dentro dela (ou vice-versa) — sem isso, uma
    // ocorrência movida para dentro da semana visível sumiria, e uma
    // movida para fora continuaria aparecendo na data errada.
    for (const [dataOriginal, exc] of mapaExcecoes) {
      const dataExibicaoExc = exc.data_override || dataOriginal;
      const relevantePorExibicao = dataExibicaoExc >= inicioJanela && dataExibicaoExc <= fimJanela;
      if (relevantePorExibicao) {
        datasResultado.add(dataOriginal);
      }
    }

    for (const dataOriginal of datasResultado) {
      const excecao = mapaExcecoes.get(dataOriginal) || null;
      if (excecao?.cancelada) continue; // cancelada não aparece na grade
      const dataExibicao = excecao?.data_override || dataOriginal;
      if (dataExibicao < inicioJanela || dataExibicao > fimJanela) continue;
      resultado.push(construirOcorrencia(item, dataOriginal, excecao));
    }
  }

  return resultado;
}

function construirOcorrencia(item, dataOcorrencia, excecao) {
  return {
    idOcorrencia: `${item.id}|${dataOcorrencia}`,
    item,
    dataOcorrencia,
    dataExibicao: excecao?.data_override || dataOcorrencia,
    titulo: excecao?.titulo_override || item.titulo,
    descricao: excecao?.descricao_override ?? item.descricao,
    horaInicio: excecao?.hora_inicio_override || item.hora_inicio,
    horaFim: excecao?.hora_fim_override || item.hora_fim,
    diaInteiro: item.dia_inteiro,
    cancelada: !!excecao?.cancelada,
    concluida: !!excecao?.concluida || (item.tipo_recorrencia === 'nenhuma' && item.concluido_em != null),
    concluidoEm: excecao?.concluido_em || item.concluido_em || null,
    concluidoPor: excecao?.concluido_por || item.concluido_por || null,
    observacaoConclusao: excecao?.observacao_conclusao || item.observacao_conclusao || null,
    temExcecao: !!excecao,
  };
}
