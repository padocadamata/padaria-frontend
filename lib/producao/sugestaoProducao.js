// Motor de sugestão de produção — Planejamento V1 (regra transparente e
// auditável, sem IA/modelo preditivo). Todos os parâmetros abaixo são
// constantes nomeadas exportadas de propósito, para permitir calibração
// futura sem reescrever o algoritmo. Nenhuma função aqui grava dado
// nenhum — é puro cálculo em memória; quem decide persistir (ou não) é a
// tela, via UPSERT explícito em planejamento_producao só quando o usuário
// clicar em Salvar.

// Até quantas ocorrências históricas comparáveis (mesmo produto, mesmo
// turno, mesmo dia da semana, status='fechado') entram no cálculo.
export const JANELA_MAXIMA = 8;

// Abaixo desta taxa (sobra_total / quantidade_produzida), tratamos como
// possível sinal de escassez (vendeu quase tudo — pode ter faltado).
export const LIMIAR_ESCASSEZ = 0.05;

// Bônus percentual aplicado à ocorrência quando o sinal de escassez acima
// é detectado.
export const BONUS_ESCASSEZ_PCT = 0.05;

// Pesos da penalização por sobra, em ordem decrescente de "quão ruim foi":
// perda/descarte pesa mais que sobra não classificada, que pesa mais que
// sobra aproveitável (que é recuperável, quase não penaliza).
export const PESO_PERDA = 0.5;
export const PESO_NAO_CLASSIFICADA = 0.25;
export const PESO_APROVEITAVEL = 0.1;

// Amortecimento aplicado à tendência (recente vs. anterior) antes de
// somar à média ponderada — evita reagir com força total a uma variação
// de poucos pontos.
export const PESO_TENDENCIA = 0.5;

// Proteção mínima/máxima: a sugestão final nunca sai do intervalo
// [mediana * CLAMP_MIN, mediana * CLAMP_MAX] das ocorrências usadas.
export const CLAMP_MIN = 0.7;
export const CLAMP_MAX = 1.3;

// Tendência só é calculada com pelo menos esta quantidade de ocorrências
// (precisa de pelo menos 2+2 para dividir em "recentes"/"anteriores" com
// algum sentido estatístico mínimo).
export const MIN_OCORRENCIAS_TENDENCIA = 4;

const DIA_SEMANA_PLURAL = [
  'domingos',
  'segundas-feiras',
  'terças-feiras',
  'quartas-feiras',
  'quintas-feiras',
  'sextas-feiras',
  'sábados',
];

// Mesma técnica segura já usada em lib/data/dataLocal.js
// (diaDaSemanaExibicao): meio-dia local evita que a conversão de fuso
// empurre a data para o dia anterior/seguinte.
function indiceDiaSemana(dataYYYYMMDD) {
  return new Date(`${dataYYYYMMDD}T12:00:00`).getDay();
}

// Qualidade mínima de uma ocorrência histórica (decisão aprovada
// 2026-08-24): só entra no cálculo se tiver os dados essenciais válidos.
// Nunca reconstruímos/inventamos quantidade_vendida ausente — a ocorrência
// é simplesmente descartada do cálculo.
function ocorrenciaValida(registro) {
  return (
    registro.status === 'fechado' &&
    Number.isInteger(registro.quantidade_produzida) &&
    registro.quantidade_produzida > 0 &&
    Number.isInteger(registro.quantidade_vendida) &&
    registro.quantidade_vendida >= 0
  );
}

// Ajuste percentual de uma ocorrência individual, combinando o sinal de
// possível escassez (bônus) com a penalização diferenciada por tipo de
// sobra. Sobra ausente (sobra_total null — comum em histórico antigo ou
// em registro ainda sem gestão de sobra) não gera bônus nem penalização:
// a ocorrência entra no cálculo só com o valor de venda puro.
function calcularAjustePercentual(registro) {
  if (registro.sobra_total == null) {
    return 0;
  }

  const produzida = registro.quantidade_produzida;
  const taxaSobra = registro.sobra_total / produzida;
  const bonusEscassez = taxaSobra < LIMIAR_ESCASSEZ ? BONUS_ESCASSEZ_PCT : 0;

  const perda = registro.perda_descarte ?? 0;
  const aproveitavel = registro.sobra_aproveitavel ?? 0;
  const naoClassificada = Math.max(0, registro.sobra_total - aproveitavel - perda);

  const penalizacao =
    PESO_PERDA * (perda / produzida) +
    PESO_NAO_CLASSIFICADA * (naoClassificada / produzida) +
    PESO_APROVEITAVEL * (aproveitavel / produzida);

  return bonusEscassez - penalizacao;
}

function possuiSobraNaoClassificada(registro) {
  if (registro.sobra_total == null) {
    return false;
  }
  const aproveitavel = registro.sobra_aproveitavel ?? 0;
  const perda = registro.perda_descarte ?? 0;
  return registro.sobra_total - aproveitavel - perda > 0;
}

function mediana(valores) {
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  if (ordenado.length % 2 === 0) {
    return (ordenado[meio - 1] + ordenado[meio]) / 2;
  }
  return ordenado[meio];
}

function media(valores) {
  return valores.reduce((soma, v) => soma + v, 0) / valores.length;
}

// Classificação de confiança — só apresentação, não entra na fórmula.
function classificarConfianca(n) {
  if (n === 0) return 'Sem base';
  if (n === 1) return 'Baixa';
  if (n <= 3) return 'Média';
  return 'Boa';
}

// Calcula a sugestão de produção para um slot (produto + turno + data
// alvo), a partir do histórico já fechado desse mesmo produto.
//
// Parâmetros:
//   registros: array de producao_registros do MESMO produto (o chamador
//     já filtra por receita_id antes de passar aqui — este módulo não
//     sabe nada sobre qual produto é, só processa o que recebe);
//   dataAlvo: data futura (YYYY-MM-DD) para a qual queremos sugerir;
//   turno: 'manha' | 'tarde';
//   diasFechados: Set<string> de datas (YYYY-MM-DD) marcadas
//     producao_dias.fechado=true — ocorrências históricas nessas datas são
//     excluídas do cálculo (dia anômalo, não representativo).
//
// Retorno: {
//   quantidadeSugerida, confianca, quantidadeOcorrencias, justificativa,
//   mediaVendida, sobraMedia, tendenciaPct, temSobraNaoClassificada
// }
// quantidadeSugerida é null quando não há nenhuma ocorrência comparável.
// mediaVendida/sobraMedia/tendenciaPct são os mesmos números já usados
// para montar `justificativa` (nenhum cálculo novo) — expostos também
// separadamente para a tela poder montar um resumo compacto sem precisar
// reinterpretar o texto. tendenciaPct continua null sempre que n <
// MIN_OCORRENCIAS_TENDENCIA, exatamente como antes — nenhuma mudança de
// fórmula ou de parâmetro, só de formato do retorno.
export function calcularSugestaoProducao({ registros, dataAlvo, turno, diasFechados }) {
  const diaSemanaAlvo = indiceDiaSemana(dataAlvo);

  const candidatos = registros
    .filter((r) => r.turno === turno)
    .filter((r) => indiceDiaSemana(r.data) === diaSemanaAlvo)
    .filter((r) => !diasFechados.has(r.data))
    .filter(ocorrenciaValida)
    .sort((a, b) => (a.data < b.data ? 1 : -1)) // mais recente primeiro
    .slice(0, JANELA_MAXIMA);

  const n = candidatos.length;
  const temSobraNaoClassificada = candidatos.some(possuiSobraNaoClassificada);
  const sufixoNaoClassificada = temSobraNaoClassificada
    ? ' Inclui dado ainda não classificado — sugestão tratada com cautela adicional.'
    : '';

  if (n === 0) {
    return {
      quantidadeSugerida: null,
      confianca: classificarConfianca(0),
      quantidadeOcorrencias: 0,
      mediaVendida: null,
      sobraMedia: null,
      tendenciaPct: null,
      temSobraNaoClassificada: false,
      justificativa: 'Sem histórico comparável — informe manualmente.',
    };
  }

  // Descritivos: sempre calculados a partir do valor real vendido/sobra
  // (não do valor ajustado usado internamente pela fórmula) — são só para
  // exibição, mesma fonte que já alimentava a justificativa antes.
  const mediaVendida = Math.round(media(candidatos.map((r) => r.quantidade_vendida)));
  const sobrasValidas = candidatos.filter((r) => r.sobra_total != null).map((r) => r.sobra_total);
  const sobraMedia = sobrasValidas.length > 0 ? Math.round(media(sobrasValidas)) : null;

  const valoresAjustados = candidatos.map(
    (r) => Math.max(0, r.quantidade_vendida * (1 + calcularAjustePercentual(r)))
  );

  if (n === 1) {
    return {
      quantidadeSugerida: Math.round(valoresAjustados[0]),
      confianca: classificarConfianca(1),
      quantidadeOcorrencias: 1,
      mediaVendida,
      sobraMedia,
      tendenciaPct: null,
      temSobraNaoClassificada,
      justificativa: `Baseado em apenas 1 ocorrência — use com cautela.${sufixoNaoClassificada}`,
    };
  }

  // Média ponderada: mais recente (índice 0) tem peso N, o mais antigo
  // usado tem peso 1 — linear e fácil de auditar, sem caixa-preta.
  const pesos = valoresAjustados.map((_, i) => n - i);
  const somaPesos = pesos.reduce((soma, p) => soma + p, 0);
  const mediaPonderada =
    valoresAjustados.reduce((soma, v, i) => soma + v * pesos[i], 0) / somaPesos;

  let tendenciaPct = null;
  let sugestaoBase = mediaPonderada;

  if (n >= MIN_OCORRENCIAS_TENDENCIA) {
    const tamanhoRecente = Math.ceil(n / 2);
    const recentes = valoresAjustados.slice(0, tamanhoRecente);
    const anteriores = valoresAjustados.slice(tamanhoRecente);
    const mediaRecente = media(recentes);
    const mediaAnterior = media(anteriores);

    if (mediaAnterior > 0) {
      tendenciaPct = (mediaRecente - mediaAnterior) / mediaAnterior;
      sugestaoBase = mediaPonderada * (1 + tendenciaPct * PESO_TENDENCIA);
    }
  }

  const medianaValores = mediana(valoresAjustados);
  const limiteMin = medianaValores * CLAMP_MIN;
  const limiteMax = medianaValores * CLAMP_MAX;
  const sugestaoProtegida = Math.min(Math.max(sugestaoBase, limiteMin), limiteMax);
  const quantidadeSugerida = Math.round(sugestaoProtegida);

  if (n <= 3) {
    return {
      quantidadeSugerida,
      confianca: classificarConfianca(n),
      quantidadeOcorrencias: n,
      mediaVendida,
      sobraMedia,
      tendenciaPct,
      temSobraNaoClassificada,
      justificativa: `Poucos dados — sugestão baseada em ${n} ocorrências comparáveis.${sufixoNaoClassificada}`,
    };
  }

  const diaSemanaPlural = DIA_SEMANA_PLURAL[diaSemanaAlvo];
  const turnoLabelMinusculo = turno === 'manha' ? 'manhã' : 'tarde';

  let justificativa = `Baseada nas últimas ${n} ${diaSemanaPlural} de ${turnoLabelMinusculo}; média vendida ${mediaVendida}`;
  if (sobraMedia != null) {
    justificativa += `; sobra média ${sobraMedia}`;
  }
  if (tendenciaPct != null) {
    const sinal = tendenciaPct >= 0 ? '+' : '';
    justificativa += `; tendência ${sinal}${Math.round(tendenciaPct * 100)}%`;
  }
  justificativa += '.' + sufixoNaoClassificada;

  return {
    quantidadeSugerida,
    confianca: classificarConfianca(n),
    quantidadeOcorrencias: n,
    mediaVendida,
    sobraMedia,
    tendenciaPct,
    temSobraNaoClassificada,
    justificativa,
  };
}
