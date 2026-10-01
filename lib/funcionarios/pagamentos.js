import { createClient } from '../supabase/client';
import { dataLocalHoje } from '../data/dataLocal';

// Folha de Pagamento > Pagamentos (migrations 0065/0066) -- funções puras
// de formatação/agregação + chamadas em lote às RPCs do motor financeiro.
// Toda a lógica de cálculo/validação real mora no banco (RPCs SECURITY
// DEFINER) -- este módulo só organiza o que a UI precisa para montar as
// telas e os payloads.

// ------------------------------------------------------------
// Vínculo/forma de remuneração -- leitura vigente.
// ------------------------------------------------------------

// Forma de remuneração VIGENTE HOJE para 1 funcionário (mensal|por_hora|
// null se nunca configurado). Usado SÓ para gating de UI (ex.: mostrar o
// toggle "Extra remunerado" na Escala, ou decidir qual bloco de
// Configurações exibir) -- NUNCA é a fonte de verdade para cálculo, que
// sempre usa a vigência na data relevante da jornada/competência, resolvida
// pelas RPCs no banco (folha_calcular_pendencias_por_hora,
// folha_criar_pagamento_mensal etc.).
export async function buscarFormaRemuneracaoAtual(funcionarioId) {
  if (!funcionarioId) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('funcionarios_forma_remuneracao')
    .select('forma, vigente_desde')
    .eq('funcionario_id', funcionarioId)
    .lte('vigente_desde', dataLocalHoje())
    .order('vigente_desde', { ascending: false })
    .limit(1);
  if (error) {
    console.error('Erro ao carregar forma de remuneração:', error);
    return null;
  }
  return data?.[0]?.forma || null;
}

// Busca em LOTE (nunca 1 query por funcionário) a forma de remuneração
// vigente hoje de vários funcionários -- usado pela tela de Configurações e
// pela Visão "A Pagar" para decidir, por pessoa, qual bloco mostrar.
// Devolve Map<funcionario_id, 'mensal'|'por_hora'>: ausência de entrada =
// "não configurado" (nunca confundido com um dos dois valores).
export async function buscarFormaRemuneracaoAtualEmLote(funcionarioIds) {
  const idsUnicos = Array.from(new Set((funcionarioIds || []).filter(Boolean)));
  if (idsUnicos.length === 0) return new Map();

  const supabase = createClient();
  const { data, error } = await supabase
    .from('funcionarios_forma_remuneracao')
    .select('funcionario_id, forma, vigente_desde')
    .in('funcionario_id', idsUnicos)
    .lte('vigente_desde', dataLocalHoje())
    .order('vigente_desde', { ascending: false });

  if (error) {
    console.error('Erro ao carregar formas de remuneração:', error);
    return new Map();
  }

  const mapa = new Map();
  for (const linha of data || []) {
    // Primeira ocorrência por funcionário é a de vigente_desde mais recente
    // (já ordenado desc acima) -- nunca sobrescreve com uma vigência mais
    // antiga.
    if (!mapa.has(linha.funcionario_id)) mapa.set(linha.funcionario_id, linha.forma);
  }
  return mapa;
}

// Visão A Pagar: forma vigente hoje + quem teve alguma vigência por_hora
// até hoje (quem passou a mensal ainda pode ter jornadas por hora antigas
// pendentes). 1 query para todos, nunca 1 por funcionário.
export async function buscarSituacaoRemuneracaoEmLote(funcionarioIds) {
  const idsUnicos = Array.from(new Set((funcionarioIds || []).filter(Boolean)));
  const vazio = { formaAtual: new Map(), comPorHora: new Set() };
  if (idsUnicos.length === 0) return vazio;

  const supabase = createClient();
  const { data, error } = await supabase
    .from('funcionarios_forma_remuneracao')
    .select('funcionario_id, forma, vigente_desde')
    .in('funcionario_id', idsUnicos)
    .lte('vigente_desde', dataLocalHoje())
    .order('vigente_desde', { ascending: false });

  if (error) {
    console.error('Erro ao carregar formas de remuneração:', error);
    return vazio;
  }

  const formaAtual = new Map();
  const comPorHora = new Set();
  for (const linha of data || []) {
    if (!formaAtual.has(linha.funcionario_id)) formaAtual.set(linha.funcionario_id, linha.forma);
    if (linha.forma === 'por_hora') comPorHora.add(linha.funcionario_id);
  }
  return { formaAtual, comPorHora };
}

export async function buscarHistoricoConfiguracao(funcionarioId) {
  const supabase = createClient();
  const [formas, bases] = await Promise.all([
    supabase.from('funcionarios_forma_remuneracao').select('forma, vigente_desde').eq('funcionario_id', funcionarioId).order('vigente_desde', { ascending: false }),
    supabase.from('funcionarios_remuneracao_base').select('valor, vigente_desde').eq('funcionario_id', funcionarioId).order('vigente_desde', { ascending: false }),
  ]);
  if (formas.error) console.error('Erro ao carregar histórico de forma de remuneração:', formas.error);
  if (bases.error) console.error('Erro ao carregar histórico de remuneração-base:', bases.error);
  return { formas: formas.data || [], bases: bases.data || [] };
}

export async function buscarValorMensalBaseAtual(funcionarioId) {
  if (!funcionarioId) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('funcionarios_remuneracao_base')
    .select('valor, vigente_desde')
    .eq('funcionario_id', funcionarioId)
    .lte('vigente_desde', dataLocalHoje())
    .order('vigente_desde', { ascending: false })
    .limit(1);
  if (error) {
    console.error('Erro ao carregar remuneração-base:', error);
    return null;
  }
  return data?.[0]?.valor ?? null;
}

export async function buscarValorHoraVigente() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('folha_valor_hora')
    .select('valor, vigente_desde')
    .lte('vigente_desde', dataLocalHoje())
    .order('vigente_desde', { ascending: false })
    .limit(1);
  if (error) {
    console.error('Erro ao carregar valor/hora:', error);
    return null;
  }
  return data?.[0] || null;
}

export async function buscarHistoricoValorHora() {
  const supabase = createClient();
  const { data, error } = await supabase.from('folha_valor_hora').select('valor, vigente_desde').order('vigente_desde', { ascending: false });
  if (error) {
    console.error('Erro ao carregar histórico de valor/hora:', error);
    return [];
  }
  return data || [];
}

export async function buscarPreferenciaPagamento(funcionarioId) {
  if (!funcionarioId) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('funcionarios_preferencia_pagamento')
    .select('funcionario_id, periodicidade, dia_semana_habitual, dia_mes_habitual')
    .eq('funcionario_id', funcionarioId)
    .maybeSingle();
  if (error) {
    console.error('Erro ao carregar preferência de pagamento:', error);
    return null;
  }
  return data;
}

// ------------------------------------------------------------
// Configurações -- escrita SOMENTE por RPC (migration 0066): quem
// registrou (criado_por/atualizado_por) é sempre auth.uid() no servidor,
// nunca enviado pelo navegador. Vigências nunca são editadas/apagadas --
// cada alteração é uma linha nova.
// ------------------------------------------------------------

function mensagemErroConfiguracao(error, padrao) {
  const msg = error?.message || '';
  if (msg.includes('ja existe')) return 'Já existe uma vigência cadastrada para esta data.';
  if (msg.includes('requer a permissao')) return 'Você não tem permissão para alterar esta configuração.';
  if (msg.includes('maior que zero')) return 'Informe um valor maior que zero.';
  console.error(padrao, error);
  return padrao;
}

export async function inserirFormaRemuneracao(funcionarioId, forma, vigenteDesde) {
  const supabase = createClient();
  const { error } = await supabase.rpc('folha_registrar_forma_remuneracao', {
    p_funcionario_id: funcionarioId,
    p_forma: forma,
    p_vigente_desde: vigenteDesde,
  });
  if (error) return { erro: mensagemErroConfiguracao(error, 'Não foi possível salvar a forma de remuneração.') };
  return { erro: '' };
}

export async function inserirRemuneracaoBase(funcionarioId, valor, vigenteDesde) {
  const supabase = createClient();
  const { error } = await supabase.rpc('folha_registrar_remuneracao_base', {
    p_funcionario_id: funcionarioId,
    p_valor: valor,
    p_vigente_desde: vigenteDesde,
  });
  if (error) return { erro: mensagemErroConfiguracao(error, 'Não foi possível salvar a remuneração-base.') };
  return { erro: '' };
}

export async function inserirValorHoraGlobal(valor, vigenteDesde) {
  const supabase = createClient();
  const { error } = await supabase.rpc('folha_registrar_valor_hora', { p_valor: valor, p_vigente_desde: vigenteDesde });
  if (error) return { erro: mensagemErroConfiguracao(error, 'Não foi possível salvar o valor/hora.') };
  return { erro: '' };
}

export async function salvarPreferenciaPagamento(funcionarioId, { periodicidade, diaSemanaHabitual, diaMesHabitual }) {
  const supabase = createClient();
  const { error } = await supabase.rpc('folha_salvar_preferencia_pagamento', {
    p_funcionario_id: funcionarioId,
    p_periodicidade: periodicidade,
    p_dia_semana_habitual: periodicidade === 'semanal' ? diaSemanaHabitual : null,
    p_dia_mes_habitual: periodicidade === 'mensal' ? diaMesHabitual || null : null,
  });
  if (error) return { erro: mensagemErroConfiguracao(error, 'Não foi possível salvar a preferência de pagamento.') };
  return { erro: '' };
}

// ------------------------------------------------------------
// Formatação.
// ------------------------------------------------------------

export function formatarMoeda(valor) {
  if (valor === null || valor === undefined) return '—';
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatarCompetencia(dataYYYYMMDD) {
  if (!dataYYYYMMDD) return '';
  const [ano, mes] = dataYYYYMMDD.split('-');
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${nomes[Number(mes) - 1]}/${ano}`;
}

// ------------------------------------------------------------
// Pendências -- leitura via RPC (SECURITY DEFINER, cruza permissões com
// Escala do mesmo jeito que aplicar_escala_em_lote já faz).
// ------------------------------------------------------------

export async function buscarPendenciasPorHora(funcionarioId) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('folha_calcular_pendencias_por_hora', { p_funcionario_id: funcionarioId });
  if (error) {
    console.error('Erro ao calcular pendências por hora:', error);
    return { pendencias: [], erro: 'Não foi possível calcular as pendências.' };
  }
  return { pendencias: data || [], erro: '' };
}

export async function buscarPendenciaMensal(funcionarioId, competencia) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('folha_calcular_pendencia_mensal', {
    p_funcionario_id: funcionarioId,
    p_competencia: competencia,
  });
  if (error) {
    console.error('Erro ao calcular pendência mensal:', error);
    return { pendencia: null, erro: 'Não foi possível calcular a pendência da competência.' };
  }
  return { pendencia: data?.[0] || null, erro: '' };
}

// ------------------------------------------------------------
// Criação de pagamento -- confirma atomicamente (sem rascunho persistido).
// ------------------------------------------------------------

export function mensagemErroPagamento(error) {
  const msg = error?.message || '';
  if (msg.includes('ja foi paga em outro pagamento') || msg.includes('ja foi pago em outro pagamento')) {
    return 'Uma ou mais jornadas selecionadas já foram pagas em outro pagamento. Atualize a lista e tente novamente.';
  }
  if (msg.includes('condicao de corrida')) {
    return 'Uma ou mais jornadas selecionadas acabaram de ser pagas por outro pagamento. Atualize a lista e tente novamente.';
  }
  if (msg.includes('descontos') && msg.includes('ultrapassam')) {
    return 'Os descontos informados ultrapassam o valor bruto do pagamento.';
  }
  if (msg.includes('nao esta configurado como por_hora') || msg.includes('nao esta configurado como mensal')) {
    return 'A forma de remuneração deste funcionário mudou e não corresponde mais a este tipo de pagamento. Atualize a tela e tente novamente.';
  }
  if (msg.includes('nao ha remuneracao-base mensal configurada')) {
    return 'Não há remuneração-base mensal configurada para esta competência.';
  }
  if (msg.includes('nao ha valor/hora vigente')) {
    return 'Não há valor/hora configurado para a data de uma das jornadas.';
  }
  if (msg.includes('integral precisa quitar exatamente')) {
    return 'Integral precisa quitar exatamente todo o saldo da competência. Atualize a tela (o saldo pode ter mudado) ou use Adiantamento/Parcial para um valor menor.';
  }
  if (msg.includes('integral sem saldo')) {
    return 'A base desta competência já foi quitada. Use Complemento para lançar apenas extras.';
  }
  if (msg.includes('excede o saldo')) {
    return 'O valor da base informado é maior que o saldo ainda não pago desta competência. Atualize a tela e confira os pagamentos já lançados.';
  }
  if (msg.includes('pagamento sem valor')) {
    return 'Informe um valor de base maior que zero ou selecione ao menos um extra.';
  }
  if (msg.includes('e futura') || msg.includes('e futuro')) {
    return 'Só é possível pagar jornadas até hoje.';
  }
  if (msg.includes('falta/atestado registrado')) {
    return 'Uma das jornadas selecionadas tem falta ou atestado registrado e não pode ser paga.';
  }
  if (msg.includes('nao encontrada na Escala')) {
    return 'Uma das jornadas selecionadas foi alterada na Escala. Atualize a lista e tente novamente.';
  }
  if (msg.includes('requer a permissao')) {
    return 'Você não tem permissão para confirmar pagamentos.';
  }
  if (msg.includes('nao esta marcado como extra remunerado')) {
    return 'Um dos períodos selecionados como extra não está mais marcado como "Extra remunerado" na Escala.';
  }
  console.error('Erro ao criar pagamento:', error);
  return 'Não foi possível criar o pagamento. Tente novamente ou avise um administrador.';
}

export async function criarPagamentoPorHora({ funcionarioId, jornadas, descontos, dataEfetiva, observacao }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('folha_criar_pagamento_por_hora', {
    p_funcionario_id: funcionarioId,
    p_jornadas: jornadas,
    p_descontos: descontos,
    p_data_efetiva: dataEfetiva,
    p_observacao: observacao || null,
  });
  if (error) return { id: null, erro: mensagemErroPagamento(error) };
  return { id: data, erro: '' };
}

export async function criarPagamentoMensal({ funcionarioId, competencia, tipoLancamento, valorBase, extras, descontos, dataEfetiva, observacao }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('folha_criar_pagamento_mensal', {
    p_funcionario_id: funcionarioId,
    p_competencia: competencia,
    p_tipo_lancamento: tipoLancamento,
    p_valor_base: valorBase,
    p_extras: extras,
    p_descontos: descontos,
    p_data_efetiva: dataEfetiva,
    p_observacao: observacao || null,
  });
  if (error) return { id: null, erro: mensagemErroPagamento(error) };
  return { id: data, erro: '' };
}

export async function cancelarPagamento(pagamentoId, motivo) {
  const supabase = createClient();
  const { error } = await supabase.rpc('folha_cancelar_pagamento', { p_pagamento_id: pagamentoId, p_motivo: motivo });
  if (error) {
    const msg = error?.message || '';
    if (msg.includes('ja esta cancelado')) return { erro: 'Este pagamento já está cancelado.' };
    if (msg.includes('motivo do cancelamento e obrigatorio')) return { erro: 'Informe o motivo do cancelamento.' };
    console.error('Erro ao cancelar pagamento:', error);
    return { erro: 'Não foi possível cancelar o pagamento. Tente novamente.' };
  }
  return { erro: '' };
}

// ------------------------------------------------------------
// Histórico (visão Pagos).
// ------------------------------------------------------------

// Filtro de período = data efetiva do pagamento. Vínculo e forma filtram
// pelo SNAPSHOT do pagamento (tipo_vinculo_snapshot/natureza), nunca pelo
// cadastro atual -- histórico nunca é reinterpretado.
export async function buscarHistoricoPagamentos({ dataInicio, dataFim, funcionarioId, status, tipoVinculo, natureza } = {}) {
  const supabase = createClient();
  let query = supabase
    .from('folha_pagamentos')
    .select(
      'id, funcionario_id, natureza, competencia, tipo_vinculo_snapshot, tipo_lancamento, valor_base_pago, valor_mensal_base_snapshot, valor_hora_snapshot, valor_bruto, total_descontos, valor_liquido, status, data_prevista, data_efetiva, observacao, confirmado_em, confirmado_por_nome, funcionarios(nome)',
    )
    .order('data_efetiva', { ascending: false })
    .order('confirmado_em', { ascending: false });

  if (dataInicio) query = query.gte('data_efetiva', dataInicio);
  if (dataFim) query = query.lte('data_efetiva', dataFim);
  if (funcionarioId) query = query.eq('funcionario_id', funcionarioId);
  if (status) query = query.eq('status', status);
  if (tipoVinculo) query = query.eq('tipo_vinculo_snapshot', tipoVinculo);
  if (natureza) query = query.eq('natureza', natureza);

  const { data, error } = await query;
  if (error) {
    console.error('Erro ao carregar histórico de pagamentos:', error);
    return [];
  }
  return data || [];
}

export async function buscarDetalhePagamento(pagamentoId) {
  const supabase = createClient();
  const [itensResp, descontosResp, cancelamentoResp] = await Promise.all([
    supabase.from('folha_pagamentos_itens').select('*').eq('pagamento_id', pagamentoId).order('data').order('hora_inicio'),
    supabase.from('folha_pagamentos_descontos').select('*').eq('pagamento_id', pagamentoId),
    supabase.from('folha_pagamentos_cancelamentos').select('*').eq('pagamento_id', pagamentoId).maybeSingle(),
  ]);
  if (itensResp.error) console.error('Erro ao carregar itens do pagamento:', itensResp.error);
  if (descontosResp.error) console.error('Erro ao carregar descontos do pagamento:', descontosResp.error);
  if (cancelamentoResp.error) console.error('Erro ao carregar cancelamento do pagamento:', cancelamentoResp.error);
  return {
    itens: itensResp.data || [],
    descontos: descontosResp.data || [],
    cancelamento: cancelamentoResp.data || null,
  };
}
