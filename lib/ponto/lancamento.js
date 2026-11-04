import { horaValida, paraMinutos, sobrepoe } from './tempo.js';
import { atestadosDoDia, motivoForaVinculo, situacaoDaEscala, SITUACOES_AJUSTE, TIPOS_ATESTADO } from './apuracao.js';

// Lançamento do Cartão-Ponto -- montagem e validação do que vai para as
// RPCs folha_ponto_dias_salvar e folha_ponto_atestado_salvar (migration
// 0078). O banco aplica as MESMAS regras e devolve o mesmo código
// ("folha_ponto: [codigo] ..."); aqui elas existem para a tela avisar antes
// de enviar.

export const LIMITES = { periodos: 6, motivo: 500, observacao: 500, lote: 62 };

export const MENSAGENS = {
  data_fora_competencia: 'A data não pertence à competência do cartão.',
  data_repetida: 'O mesmo dia foi enviado duas vezes.',
  data_futura: 'Não é possível lançar ponto em data futura.',
  fora_vinculo: 'Há dia fora do vínculo CLT da funcionária.',
  situacao_invalida: 'Situação inválida (atestado é registrado em "Registrar atestado").',
  motivo_obrigatorio: 'Informe o motivo do ajuste da situação.',
  motivo_longo: 'O motivo pode ter até 500 caracteres.',
  ajuste_invalido: 'Falta só em dia de trabalho na Escala (ou dia ainda não definido).',
  lancamento_exige_trabalho: 'Horários só podem ser lançados em dia de trabalho.',
  dia_com_atestado_integral: 'Este dia está coberto por atestado integral. Para registrar trabalho, troque por atestado parcial.',
  hora_invalida: 'Horário inválido (use HH:MM).',
  periodo_invalido: 'A saída precisa ser depois da entrada.',
  periodos_sobrepostos: 'Os períodos trabalhados não podem se sobrepor.',
  periodos_demais: 'No máximo 6 períodos por dia.',
  observacao_longa: 'A observação pode ter até 500 caracteres.',
  lote_vazio: 'Nenhum dia para salvar.',
  lote_grande: 'Dias demais num único envio.',
  atestado_tipo_invalido: 'Tipo de atestado inválido.',
  atestado_abrangencia_invalida: 'Informe se o atestado é do dia inteiro ou parcial.',
  atestado_periodo_invalido: 'A data final do atestado não pode ser antes da inicial.',
  atestado_parcial_um_dia: 'Atestado parcial vale para um único dia.',
  atestado_horario_invalido: 'O fim do atestado precisa ser depois do início.',
  atestado_sobreposto: 'Já existe atestado ativo cobrindo esse período.',
  atestado_com_trabalho: 'Há horários trabalhados num dos dias. Use atestado parcial nesse dia.',
  atestado_inexistente: 'Atestado não encontrado.',
  atestado_cancelado: 'Este atestado já foi cancelado.',
  atestado_alterado: 'O atestado foi alterado por outra pessoa. Recarregue antes de continuar.',
  cancelamento_motivo_obrigatorio: 'Informe o motivo do cancelamento.',
  cartao_inexistente: 'Cartão-ponto não encontrado.',
  cartao_fechado: 'Há cartão fechado nesse período. Reabra-o para alterar.',
  cartao_aberto: 'Este cartão não está fechado.',
  cartao_alterado: 'O cartão foi alterado por outra pessoa. Recarregue antes de continuar.',
  competencia_invalida: 'Informe a competência.',
  competencia_futura: 'Ainda não é possível abrir o cartão de uma competência futura.',
  funcionario_inexistente: 'Funcionária não encontrada.',
  sem_vinculo_na_competencia: 'A funcionária não tem vínculo CLT em nenhum dia desta competência.',
  pendencias: 'Ainda há dias pendentes no cartão.',
  competencia_em_andamento: 'A competência ainda não terminou para esta funcionária.',
  nao_conferido: 'Confira o cartão antes de fechar.',
  conferencia_desatualizada: 'A Escala ou o cartão mudou depois da conferência. Confira de novo.',
  reabertura_motivo_obrigatorio: 'Informe o motivo da reabertura.',
};

function erro(codigo) {
  return { codigo, mensagem: MENSAGENS[codigo] };
}

export function codigoDoErro(mensagem) {
  const m = /folha_ponto: \[([a-z_]+)\]/.exec(String(mensagem ?? ''));
  return m ? m[1] : null;
}

export function mensagemDoErro(e) {
  const codigo = codigoDoErro(e?.message);
  return (codigo && MENSAGENS[codigo]) || 'Não foi possível salvar o cartão-ponto.';
}

function aparar(texto) {
  const t = typeof texto === 'string' ? texto.trim() : '';
  return t === '' ? null : t;
}

// Valida e normaliza UM item do lote de dias. `dia` = o dia da base (Escala
// + vínculo); `atestados` = os atestados ativos da base. Situação igual à da
// Escala é gravada como null (segue a Escala) -- só um AJUSTE de verdade
// exige motivo.
export function validarItemDia(item, { dia, funcionario, hoje, atestados = [] }) {
  if (item.data > hoje) return { erro: erro('data_futura') };
  if (motivoForaVinculo(funcionario, dia)) return { erro: erro('fora_vinculo') };

  const escala = dia.escala || null;
  const situacaoEscala = situacaoDaEscala(escala);
  let situacao = item.situacao ?? null;
  if (situacao === situacaoEscala) situacao = null;
  if (situacao !== null && !SITUACOES_AJUSTE.includes(situacao)) return { erro: erro('situacao_invalida') };
  const motivo = situacao === null ? null : aparar(item.motivo);
  if (situacao !== null && motivo === null) return { erro: erro('motivo_obrigatorio') };
  if (motivo && motivo.length > LIMITES.motivo) return { erro: erro('motivo_longo') };
  if (situacao === 'falta' && escala?.tipo === 'folga') return { erro: erro('ajuste_invalido') };

  const periodos = (item.periodos || []).map((p) => ({ entrada: p.entrada, saida: p.saida }));
  if (periodos.length > 0 && (situacao ?? situacaoEscala) !== 'trabalho') return { erro: erro('lancamento_exige_trabalho') };
  if (periodos.length > 0 && atestadosDoDia(atestados, item.data).integral) return { erro: erro('dia_com_atestado_integral') };
  if (periodos.length > LIMITES.periodos) return { erro: erro('periodos_demais') };
  const faixas = [];
  for (const p of periodos) {
    if (!horaValida(p.entrada) || !horaValida(p.saida)) return { erro: erro('hora_invalida') };
    const faixa = [paraMinutos(p.entrada), paraMinutos(p.saida)];
    if (faixa[1] <= faixa[0]) return { erro: erro('periodo_invalido') };
    if (faixas.some((f) => sobrepoe(f, faixa))) return { erro: erro('periodos_sobrepostos') };
    faixas.push(faixa);
  }

  const observacao = aparar(item.observacao);
  if (observacao && observacao.length > LIMITES.observacao) return { erro: erro('observacao_longa') };

  periodos.sort((a, b) => a.entrada.localeCompare(b.entrada));
  return { item: { data: item.data, situacao, motivo, observacao, periodos } };
}

// Um dia sem nada (segue a Escala, sem horário/observação): a RPC apaga o
// lançamento do dia.
export function itemVazio(item) {
  return item.situacao === null && !item.observacao && item.periodos.length === 0;
}

function diasEntre(inicio, fim) {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86400000);
}

// Alerta da tela (NÃO é bloqueio; o banco não limita a duração): fim muito
// depois de hoje ou duração muito longa costuma ser erro de digitação (ex.:
// 2206 em vez de 2026). A tela pede confirmação explícita antes de enviar.
export const ALERTA_ATESTADO = { fim_apos_hoje_dias: 365, duracao_dias: 365 };

export function alertaAtestado(atestado, { hoje, limites = ALERTA_ATESTADO } = {}) {
  const { data_inicio: inicio, data_fim: fim } = atestado;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio || '') || !/^\d{4}-\d{2}-\d{2}$/.test(fim || '') || fim < inicio) return null;
  const duracao = diasEntre(inicio, fim) + 1;
  const aposHoje = diasEntre(hoje, fim);
  const motivos = [];
  if (aposHoje > limites.fim_apos_hoje_dias) motivos.push('fim_distante');
  if (duracao > limites.duracao_dias) motivos.push('duracao_longa');
  if (motivos.length === 0) return null;
  return {
    motivos,
    duracao_dias: duracao,
    fim_apos_hoje_dias: aposHoje,
    mensagem: `O atestado cobre ${duracao} dias e termina em ${fim.split('-').reverse().join('/')}. Confirme as datas antes de salvar.`,
  };
}

// Atestado de um ou vários dias (integral) ou de parte de um dia (parcial).
// Sem limite de dias; data futura é PERMITIDA (atestado entregue antes).
// Descrição opcional (vazia = null). Vínculo e cartão
// fechado nos dias cobertos só o banco confere (precisa do histórico).
// `outros` = demais atestados ativos da funcionária (sobreposição).
export function validarAtestado(atestado, { outros = [] } = {}) {
  if (!TIPOS_ATESTADO.includes(atestado.tipo)) return { erro: erro('atestado_tipo_invalido') };
  const descricao = aparar(atestado.descricao) || null;
  if (descricao && descricao.length > LIMITES.observacao) return { erro: erro('observacao_longa') };
  if (!['integral', 'parcial'].includes(atestado.abrangencia)) return { erro: erro('atestado_abrangencia_invalida') };
  const { data_inicio: inicio, data_fim: fim } = atestado;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio || '') || !/^\d{4}-\d{2}-\d{2}$/.test(fim || '') || fim < inicio) {
    return { erro: erro('atestado_periodo_invalido') };
  }

  let horaInicio = null;
  let horaFim = null;
  if (atestado.abrangencia === 'parcial') {
    if (inicio !== fim) return { erro: erro('atestado_parcial_um_dia') };
    if (!horaValida(atestado.hora_inicio) || !horaValida(atestado.hora_fim)) return { erro: erro('hora_invalida') };
    if (paraMinutos(atestado.hora_fim) <= paraMinutos(atestado.hora_inicio)) return { erro: erro('atestado_horario_invalido') };
    horaInicio = atestado.hora_inicio;
    horaFim = atestado.hora_fim;
  }

  const mesmo = (o) => Boolean(atestado.id) && o.id === atestado.id;
  const sobrepostos = outros.filter((o) => !mesmo(o) && o.data_inicio <= fim && o.data_fim >= inicio);
  const conflita = sobrepostos.some((o) => o.abrangencia === 'integral' || atestado.abrangencia === 'integral'
    || sobrepoe([paraMinutos(o.hora_inicio), paraMinutos(o.hora_fim)], [paraMinutos(horaInicio), paraMinutos(horaFim)]));
  if (conflita) return { erro: erro('atestado_sobreposto') };

  return {
    atestado: { tipo: atestado.tipo, abrangencia: atestado.abrangencia, data_inicio: inicio, data_fim: fim, hora_inicio: horaInicio, hora_fim: horaFim, descricao },
  };
}

// "Igual ao previsto": os períodos da Escala viram os períodos realizados.
export function igualAoPrevisto(escala) {
  if (escala?.tipo !== 'trabalho') return [];
  return (escala.periodos || []).map((p) => ({ entrada: p.inicio.slice(0, 5), saida: p.fim.slice(0, 5) }));
}

// Caso comum na tela: Entrada | Saída intervalo | Retorno intervalo | Saída
// (2 períodos). 1 período ocupa Entrada/Saída; 3+ períodos seguem em
// `extras` (o banco aceita até 6).
export function colunasPrincipais(periodos) {
  const lista = [...(periodos || [])].sort((a, b) => a.entrada.localeCompare(b.entrada));
  if (lista.length === 0) return { entrada: '', saida_intervalo: '', retorno_intervalo: '', saida: '', extras: [] };
  if (lista.length === 1) return { entrada: lista[0].entrada, saida_intervalo: '', retorno_intervalo: '', saida: lista[0].saida, extras: [] };
  return {
    entrada: lista[0].entrada,
    saida_intervalo: lista[0].saida,
    retorno_intervalo: lista[1].entrada,
    saida: lista[1].saida,
    extras: lista.slice(2),
  };
}

// Inverso de colunasPrincipais (campos vazios = período não informado).
export function periodosDasColunas({ entrada, saida_intervalo, retorno_intervalo, saida, extras = [] }) {
  const periodos = [];
  if (saida_intervalo || retorno_intervalo) {
    periodos.push({ entrada, saida: saida_intervalo });
    periodos.push({ entrada: retorno_intervalo, saida });
  } else if (entrada || saida) {
    periodos.push({ entrada, saida });
  }
  return [...periodos, ...extras];
}

// "Repetir horários": os mesmos períodos realizados em vários dias,
// mantendo a situação/observação já lançadas em cada um.
export function repetirHorarios(diasBase, datas, periodos) {
  const porData = new Map(diasBase.map((d) => [d.data, d]));
  return datas.map((data) => {
    const atual = porData.get(data)?.lancamento || null;
    return {
      data,
      situacao: atual?.situacao ?? null,
      motivo: atual?.motivo ?? null,
      observacao: atual?.observacao ?? null,
      periodos: periodos.map((p) => ({ ...p })),
    };
  });
}

// Próximo dia pendente depois de `data` (ciclo "Salvar e próximo").
export function proximoPendente(apuracao, data) {
  return apuracao.dias.find((d) => d.data > data && d.pendencias.length > 0)?.data || null;
}
