import { formatarHora, obterEstadoDia } from './escala';
import { LIMITE_MANHA_TARDE } from './escalaConfig';

// Motor ÚNICO de cobertura (seção "MOTOR ÚNICO DE COBERTURA" da instrução
// aprovada) -- Mensal, Detalhamento do Dia e Por Hora NUNCA recalculam
// identidade/cobertura por conta própria: todos consomem as funções deste
// arquivo. A única coisa que muda entre eles é qual pedaço do resultado é
// exibido (resumo compacto no Mensal, versão completa no dia, timeline na
// semana).

// Primeiro nome para apresentação compacta -- SÓ decisão de apresentação,
// nunca de identidade: internamente tudo continua indexado por
// funcionario_id. Preparado para uma desambiguação simples (ver
// EscalaCoberturaDiaModal) se dois funcionários colidirem no primeiro nome
// -- não implementado aqui por decisão explícita (não alterar a modelagem
// por causa disso ainda).
export function obterPrimeiroNome(nomeCompleto) {
  if (!nomeCompleto) return '';
  return nomeCompleto.trim().split(/\s+/)[0];
}

function identidadeFuncionario(funcionario) {
  return {
    funcionario_id: funcionario.id,
    nome: funcionario.nome,
    primeiro_nome: obterPrimeiroNome(funcionario.nome),
    cargo_id: funcionario.cargo_id || null,
    cargo_nome: funcionario.funcionarios_cargos?.nome || null,
    tipo_vinculo: funcionario.tipo_vinculo || null,
  };
}

// Junta os primeiros nomes de uma lista de identidades numa string compacta
// ("Ana, Bia, Carla"). Desambiguação simples: se dois primeiros nomes
// colidirem na MESMA lista, a partir da 2ª ocorrência ganha a inicial do
// sobrenome entre parênteses -- só apresentação, nunca muda a identidade
// (continua indexada por funcionario_id em toda parte). Não implementado
// como mudança de modelagem: só entra em ação quando a colisão realmente
// ocorre (decisão explícita da instrução aprovada).
export function nomesComDesambiguacao(pessoas) {
  const vistos = new Map();
  return pessoas.map((p) => {
    const contagem = (vistos.get(p.primeiro_nome) || 0) + 1;
    vistos.set(p.primeiro_nome, contagem);
    return contagem === 1 ? p.primeiro_nome : `${p.primeiro_nome} (${p.nome.slice(0, 1)}.)`;
  });
}

function pontosDeQuebra(periodos) {
  const pontos = new Set();
  for (const p of periodos) {
    pontos.add(formatarHora(p.horaInicio));
    pontos.add(formatarHora(p.horaFim));
  }
  return Array.from(pontos).sort();
}

function quemCobre(periodos, inicio, fim) {
  const porId = new Map();
  for (const p of periodos) {
    const hi = formatarHora(p.horaInicio);
    const hf = formatarHora(p.horaFim);
    if (hi <= inicio && hf >= fim) porId.set(p.funcionario.funcionario_id, p.funcionario);
  }
  return Array.from(porId.values()).sort((a, b) => a.nome.localeCompare(b.nome));
}

function idsDe(pessoas) {
  return pessoas.map((p) => p.funcionario_id).sort().join(',');
}

// Quem está PREVISTO numa faixa mas não está EFETIVO (falta/atestado) --
// anexa o tipo de ocorrência para a UI poder dizer "Laura · Falta".
function calcularAusentes(periodosPrevistos, previstos, efetivos, inicio, fim) {
  const efetivosIds = new Set(efetivos.map((p) => p.funcionario_id));
  return previstos
    .filter((p) => !efetivosIds.has(p.funcionario_id))
    .map((p) => {
      const periodo = periodosPrevistos.find(
        (per) =>
          per.funcionario.funcionario_id === p.funcionario_id &&
          formatarHora(per.horaInicio) <= inicio &&
          formatarHora(per.horaFim) >= fim
      );
      return { ...p, ocorrenciaTipo: periodo?.ocorrenciaTipo || null };
    });
}

// Resolve o estado de UM dia para um conjunto de funcionários -- ÚNICA
// função que lê mapaEscala e monta identidade completa. `cargoId` filtra a
// ORIGEM (quais funcionários entram no cálculo), nunca um pós-filtro
// (cargo é filtro de análise, nunca uma regra nova da escala).
export function resolverEstadosDoDia({ funcionarios, mapaEscala, data, cargoId }) {
  const funcionariosFiltrados = cargoId ? funcionarios.filter((f) => f.cargo_id === cargoId) : funcionarios;

  const previstos = [];
  const efetivos = [];
  const folgas = [];
  const faltas = [];
  const atestados = [];
  const periodosPrevistos = [];
  const periodosEfetivos = [];
  const escalaIndividual = [];

  for (const funcionario of funcionariosFiltrados) {
    const estado = obterEstadoDia(mapaEscala, funcionario.id, data);
    if (!estado) continue;

    const identidade = identidadeFuncionario(funcionario);

    if (estado.tipo === 'folga') {
      folgas.push(identidade);
      escalaIndividual.push({ funcionario: identidade, tipo: 'folga', periodos: [], ocorrencia: null });
      continue;
    }

    // tipo === 'trabalho'
    previstos.push(identidade);
    const temOcorrencia = !!estado.ocorrencia;
    if (!temOcorrencia) efetivos.push(identidade);
    if (estado.ocorrencia?.tipo === 'falta') faltas.push(identidade);
    if (estado.ocorrencia?.tipo === 'atestado') atestados.push(identidade);

    for (const p of estado.periodos) {
      const item = {
        horaInicio: p.hora_inicio,
        horaFim: p.hora_fim,
        funcionario: identidade,
        ocorrenciaTipo: estado.ocorrencia?.tipo || null,
      };
      periodosPrevistos.push(item);
      if (!temOcorrencia) periodosEfetivos.push(item);
    }

    escalaIndividual.push({ funcionario: identidade, tipo: 'trabalho', periodos: estado.periodos, ocorrencia: estado.ocorrencia });
  }

  escalaIndividual.sort((a, b) => a.funcionario.nome.localeCompare(b.funcionario.nome));

  return { previstos, efetivos, folgas, faltas, atestados, periodosPrevistos, periodosEfetivos, escalaIndividual };
}

// Sweep-line: entre dois horários REAIS consecutivos (nunca blocos
// artificiais de 1h), o conjunto de quem cobre a faixa é constante. Depois
// consolida faixas ADJACENTES com exatamente o mesmo conjunto de pessoas
// (previstos E efetivos) -- evita fragmentar a visualização quando um ponto
// de quebra não muda quem está de fato cobrindo aquele intervalo.
export function calcularFaixasCobertura(periodosPrevistos, periodosEfetivos) {
  const pontos = Array.from(new Set([...pontosDeQuebra(periodosPrevistos), ...pontosDeQuebra(periodosEfetivos)])).sort();

  const bruta = [];
  for (let i = 0; i < pontos.length - 1; i++) {
    const inicio = pontos[i];
    const fim = pontos[i + 1];
    const previstos = quemCobre(periodosPrevistos, inicio, fim);
    const efetivos = quemCobre(periodosEfetivos, inicio, fim);
    if (previstos.length === 0 && efetivos.length === 0) continue;
    const ausentes = calcularAusentes(periodosPrevistos, previstos, efetivos, inicio, fim);
    bruta.push({ inicio, fim, previstos, efetivos, ausentes });
  }

  const consolidada = [];
  for (const faixa of bruta) {
    const anterior = consolidada[consolidada.length - 1];
    const mesmoConjunto =
      anterior &&
      anterior.fim === faixa.inicio &&
      idsDe(anterior.previstos) === idsDe(faixa.previstos) &&
      idsDe(anterior.efetivos) === idsDe(faixa.efetivos);
    if (mesmoConjunto) {
      anterior.fim = faixa.fim;
    } else {
      consolidada.push({ ...faixa });
    }
  }
  return consolidada;
}

// "Visão do Dia" (detalhamento completo, ao clicar num dia do Mensal):
// resumo (previsto/efetivo/folgas/faltas/atestados, todos com nomes),
// faixas de cobertura com nomes e ausências, e a escala individual do dia.
export function calcularCoberturaDia({ funcionarios, mapaEscala, data, cargoId }) {
  const estados = resolverEstadosDoDia({ funcionarios, mapaEscala, data, cargoId });
  const faixas = calcularFaixasCobertura(estados.periodosPrevistos, estados.periodosEfetivos);
  const pontos = pontosDeQuebra([...estados.periodosPrevistos, ...estados.periodosEfetivos]);

  return {
    resumo: {
      previstos: estados.previstos.length,
      efetivos: estados.efetivos.length,
      folgas: estados.folgas,
      faltas: estados.faltas,
      atestados: estados.atestados,
    },
    faixas,
    pontosDeQuebra: pontos,
    escalaIndividual: estados.escalaIndividual,
  };
}

// Resumo COMPACTO para a célula do calendário Mensal: manhã/tarde COM
// nomes (não só contagem), usando o mesmo corte fixo de sempre
// (LIMITE_MANHA_TARDE) -- é a única função que ainda bucketiza por
// manhã/tarde; a Visão do Dia e o Por Hora usam os horários reais direto.
export function calcularResumoMensalDia({ funcionarios, mapaEscala, data, cargoId, corte = LIMITE_MANHA_TARDE }) {
  const estados = resolverEstadosDoDia({ funcionarios, mapaEscala, data, cargoId });

  const manhaPorId = new Map();
  const tardePorId = new Map();
  for (const p of estados.periodosEfetivos) {
    const hi = formatarHora(p.horaInicio);
    const hf = formatarHora(p.horaFim);
    if (hi < corte) manhaPorId.set(p.funcionario.funcionario_id, p.funcionario);
    if (hf > corte) tardePorId.set(p.funcionario.funcionario_id, p.funcionario);
  }

  const porNome = (a, b) => a.nome.localeCompare(b.nome);
  return {
    manha: Array.from(manhaPorId.values()).sort(porNome),
    tarde: Array.from(tardePorId.values()).sort(porNome),
    folgas: estados.folgas.slice().sort(porNome),
    faltas: estados.faltas.slice().sort(porNome),
    atestados: estados.atestados.slice().sort(porNome),
  };
}

// Timeline da SEMANA (Visão Por Hora): reúne os pontos de quebra reais de
// TODOS os dias exibidos (nenhum horário intermediário de nenhum dia se
// perde), e para cada faixa resultante calcula quem cobre em CADA dia
// independentemente (um dia sem período numa faixa mostra 0, não "sem
// linha"). Consolida linhas adjacentes só quando TODOS os dias têm
// exatamente o mesmo conjunto de pessoas (previsto e efetivo).
export function calcularTimelineSemana({ funcionarios, mapaEscala, datas, cargoId }) {
  const estadosPorData = new Map();
  const todosPeriodos = [];
  for (const data of datas) {
    const estados = resolverEstadosDoDia({ funcionarios, mapaEscala, data, cargoId });
    estadosPorData.set(data, estados);
    todosPeriodos.push(...estados.periodosPrevistos, ...estados.periodosEfetivos);
  }

  const pontos = pontosDeQuebra(todosPeriodos);

  const linhas = [];
  for (let i = 0; i < pontos.length - 1; i++) {
    const inicio = pontos[i];
    const fim = pontos[i + 1];
    const colunas = {};
    let algumComPessoas = false;

    for (const data of datas) {
      const estados = estadosPorData.get(data);
      const previstos = quemCobre(estados.periodosPrevistos, inicio, fim);
      const efetivos = quemCobre(estados.periodosEfetivos, inicio, fim);
      if (previstos.length > 0 || efetivos.length > 0) algumComPessoas = true;
      const ausentes = calcularAusentes(estados.periodosPrevistos, previstos, efetivos, inicio, fim);
      colunas[data] = { previstos, efetivos, ausentes };
    }

    if (algumComPessoas) linhas.push({ inicio, fim, colunas });
  }

  const consolidada = [];
  for (const linha of linhas) {
    const anterior = consolidada[consolidada.length - 1];
    const mesmoConjunto =
      anterior &&
      anterior.fim === linha.inicio &&
      datas.every(
        (data) =>
          idsDe(anterior.colunas[data].previstos) === idsDe(linha.colunas[data].previstos) &&
          idsDe(anterior.colunas[data].efetivos) === idsDe(linha.colunas[data].efetivos)
      );
    if (mesmoConjunto) {
      anterior.fim = linha.fim;
    } else {
      consolidada.push({ ...linha, colunas: { ...linha.colunas } });
    }
  }

  return { pontosDeQuebra: pontos, linhas: consolidada };
}
