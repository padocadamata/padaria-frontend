import { createClient } from '../supabase/client';

// Financeiro > Contas a Pagar (migration 0073) -- leitura pelas funções
// contas_pagar_listar_* (SECURITY DEFINER, exigem contas_pagar.visualizar
// e devolvem só o necessário de compras/fornecedores; filtros e ordem são
// aplicados pelo PostgREST sobre o resultado) e escrita SÓ pelas RPCs. Nenhuma regra
// de negócio mora aqui: valores, somas, datas e permissões são validados
// de novo pelo banco.

// ------------------------------------------------------------
// Mensagens de erro (texto do banco -> frase para a tela).
// ------------------------------------------------------------
const TRADUCOES = [
  ['requer a permissao', 'Você não tem permissão para esta ação no Financeiro.'],
  ['lancar o financeiro requer', 'Você não tem permissão para lançar o financeiro -- receba sem lançar.'],
  ['ja tem lancamento financeiro ativo', 'Esta compra já tem lançamento financeiro ativo.'],
  ['precisa ser exatamente o total', 'A soma das parcelas precisa ser exatamente o total da compra.'],
  ['continuar igual ao total da compra', 'A soma das parcelas precisa continuar igual ao total da compra.'],
  ['diverge da soma das parcelas', 'A compra tem lançamento financeiro ativo e o total dela mudaria. Ajuste ou cancele o financeiro antes.'],
  ['o fornecedor nao pode ser alterado', 'A compra tem lançamento financeiro ativo: o fornecedor não pode ser trocado. Cancele o financeiro antes.'],
  ['antes de reabrir ou alterar o status', 'A compra tem lançamento financeiro ativo. Estorne os pagamentos e cancele o lançamento antes de reabrir o recebimento.'],
  ['historico no Financeiro', 'A compra tem histórico no Financeiro e não pode ser excluída.'],
  ['valores recebidos completos', 'A compra não tem valores recebidos completos (recebimento antigo) -- registre como despesa manual, se precisar.'],
  ['nao tem valor a pagar', 'A compra não tem valor a pagar (total R$ 0,00).'],
  ['somente compras recebidas', 'Só compras recebidas podem ter o financeiro lançado.'],
  ['boleto nao e pagamento no ato', 'Boleto não é pagamento no ato -- use "A prazo".'],
  ['cartao', 'Cartão é sempre pago no ato.'],
  ['nao pode ser no futuro', 'A data não pode ser no futuro.'],
  ['anterior a data', 'Há vencimento anterior à data da compra.'],
  ['ja esta paga', 'Esta parcela já está paga.'],
  ['nao confere com valor original', 'O valor pago não confere com original + juros + multa − desconto.'],
  ['valor efetivamente pago precisa ser maior que zero', 'O valor efetivamente pago precisa ser maior que zero.'],
  ['nao podem ser negativos', 'Juros, multa e desconto não podem ser negativos.'],
  ['ja foi estornado', 'Este pagamento já foi estornado.'],
  ['motivo do estorno e obrigatorio', 'Informe o motivo do estorno.'],
  ['motivo do cancelamento e obrigatorio', 'Informe o motivo do cancelamento.'],
  ['estorne o(s) pagamento(s) antes', 'A conta tem pagamento registrado. Estorne o pagamento antes de cancelar.'],
  ['ja esta cancelada', 'Esta conta já está cancelada.'],
  ['conta cancelada', 'Esta conta está cancelada.'],
  ['exatamente as parcelas ainda nao pagas', 'A lista mudou (alguma parcela foi paga). Atualize e tente de novo.'],
  ['ja existe uma categoria', 'Já existe uma categoria com este nome.'],
  ['categoria inexistente ou inativa', 'Escolha uma categoria ativa.'],
  ['fornecedor inexistente ou inativo', 'Escolha um fornecedor ativo.'],
  ['OU o credor livre', 'Informe o fornecedor cadastrado OU o credor livre, não os dois.'],
  ['informe o fornecedor ou o credor', 'Informe o fornecedor ou o credor.'],
  ['descricao obrigatoria', 'Informe a descrição.'],
  ['competencia obrigatoria', 'Informe a competência.'],
  ['exatamente uma parcela', 'Pagamento no ato tem um único valor.'],
  ['2 casas', 'Use no máximo 2 casas decimais nos valores.'],
];

export function mensagemErroFinanceiro(error, padrao = 'Não foi possível concluir. Tente novamente.') {
  const msg = error?.message || '';
  for (const [trecho, frase] of TRADUCOES) {
    if (msg.includes(trecho)) return frase;
  }
  console.error('Erro no Financeiro:', error);
  return padrao;
}

// ------------------------------------------------------------
// Leitura.
// ------------------------------------------------------------
const CAMPOS_PARCELA =
  'id, conta_id, numero, total_parcelas, vencimento, valor, origem, pedido_id, condicao, forma_prevista, status_conta, descricao, categoria_id, categoria_nome, competencia, fornecedor_id, credor_exibicao, data_compra, modalidade_compra, baixa_id, pago_em, forma_pagamento, juros, multa, desconto, valor_pago, observacao_pagamento, registrado_por_nome, registrado_em, situacao';

export async function buscarParcelas({ situacao, pagoDe, pagoAte, vencimentoDe, vencimentoAte, contaId, pedidoId } = {}) {
  const supabase = createClient();
  let consulta = supabase.rpc('contas_pagar_listar_parcelas').select(CAMPOS_PARCELA);
  if (situacao) consulta = consulta.eq('situacao', situacao);
  if (pagoDe) consulta = consulta.gte('pago_em', pagoDe);
  if (pagoAte) consulta = consulta.lte('pago_em', pagoAte);
  if (vencimentoDe) consulta = consulta.gte('vencimento', vencimentoDe);
  if (vencimentoAte) consulta = consulta.lte('vencimento', vencimentoAte);
  if (contaId) consulta = consulta.eq('conta_id', contaId);
  if (pedidoId) consulta = consulta.eq('pedido_id', pedidoId);
  consulta = situacao === 'paga'
    ? consulta.order('pago_em', { ascending: false }).order('numero')
    : consulta.order('vencimento').order('numero');
  const { data, error } = await consulta;
  if (error) return { dados: [], erro: mensagemErroFinanceiro(error, 'Não foi possível carregar as parcelas.') };
  return { dados: data || [], erro: '' };
}

export async function buscarResumoContas({ pedidoId, ids } = {}) {
  const supabase = createClient();
  let consulta = supabase.rpc('contas_pagar_listar_contas').select('*');
  if (pedidoId) consulta = consulta.eq('pedido_id', pedidoId);
  if (ids) consulta = consulta.in('id', ids);
  const { data, error } = await consulta.order('criado_em', { ascending: false });
  if (error) return { dados: [], erro: mensagemErroFinanceiro(error, 'Não foi possível carregar as contas.') };
  return { dados: data || [], erro: '' };
}

export async function buscarConta(contaId) {
  const supabase = createClient();
  const [resumo, parcelas, baixas, historico] = await Promise.all([
    supabase.rpc('contas_pagar_listar_contas').select('*').eq('id', contaId).maybeSingle(),
    supabase.rpc('contas_pagar_listar_parcelas').select(CAMPOS_PARCELA).eq('conta_id', contaId).order('numero'),
    supabase
      .from('contas_pagar_baixas')
      .select('id, parcela_id, pago_em, forma_pagamento, valor_original, juros, multa, desconto, valor_pago, observacao, registrado_por_nome, registrado_em, estornado_em, estornado_por_nome, motivo_estorno, contas_pagar_parcelas!inner(conta_id, numero)')
      .eq('contas_pagar_parcelas.conta_id', contaId)
      .order('registrado_em'),
    // Histórico (logs_auditoria) só é legível por administradores -- para
    // os demais volta vazio, sem erro.
    supabase
      .from('logs_auditoria')
      .select('id, data_hora, usuario_nome, acao, campo, valor_anterior, valor_novo')
      .eq('entidade', 'conta_pagar')
      .eq('registro_id', contaId)
      .order('data_hora'),
  ]);
  const erro = resumo.error || parcelas.error || baixas.error;
  if (erro) return { conta: null, erro: mensagemErroFinanceiro(erro, 'Não foi possível carregar a conta.') };
  return {
    conta: resumo.data,
    parcelas: parcelas.data || [],
    baixas: baixas.data || [],
    historico: historico.error ? [] : historico.data || [],
    erro: '',
  };
}

export async function buscarComprasSemLancamento({ pedidoId } = {}) {
  const supabase = createClient();
  let consulta = supabase
    .rpc('contas_pagar_listar_compras_sem_lancamento')
    .select('pedido_id, fornecedor_id, fornecedor_nome, modalidade_compra, data_pedido, data_compra, recebido_em, numero_nota_fiscal, qtd_itens, total, elegivel, anterior_implantacao');
  if (pedidoId) consulta = consulta.eq('pedido_id', pedidoId);
  else consulta = consulta.eq('elegivel', true).eq('anterior_implantacao', false);
  const { data, error } = await consulta.order('recebido_em', { ascending: false });
  if (error) return { dados: [], erro: mensagemErroFinanceiro(error, 'Não foi possível carregar as compras sem lançamento.') };
  return { dados: data || [], erro: '' };
}

export async function buscarCategorias({ somenteAtivas = false } = {}) {
  const supabase = createClient();
  let consulta = supabase.from('contas_pagar_categorias').select('id, nome, ativo');
  if (somenteAtivas) consulta = consulta.eq('ativo', true);
  const { data, error } = await consulta.order('nome');
  if (error) return { dados: [], erro: mensagemErroFinanceiro(error, 'Não foi possível carregar as categorias.') };
  return { dados: data || [], erro: '' };
}

// Fornecedores (id, nome, ativo) pela função do Financeiro: quem tem só
// contas_pagar.visualizar não lê a tabela fornecedores direto.
export async function buscarFornecedoresAtivos() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('contas_pagar_listar_fornecedores').select('id, nome, ativo').order('nome');
  if (error) return [];
  return data || [];
}

// ------------------------------------------------------------
// Escrita (RPCs).
// ------------------------------------------------------------
async function chamar(rpc, args, padrao) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(rpc, args);
  if (error) return { dados: null, erro: mensagemErroFinanceiro(error, padrao) };
  return { dados: data, erro: '' };
}

export function lancarFinanceiroCompra(pedidoId, pagamento) {
  return chamar('contas_pagar_lancar_compra', {
    p_pedido_id: pedidoId,
    p_condicao: pagamento.condicao,
    p_forma_prevista: pagamento.forma,
    p_parcelas: pagamento.parcelas,
    p_pago_em: pagamento.pagoEm,
    p_observacao: pagamento.observacao,
  }, 'Não foi possível lançar o financeiro.');
}

// Argumentos financeiros dos wrappers atômicos de Pedidos.
export function argumentosFinanceiros(pagamento) {
  return {
    p_condicao: pagamento.condicao,
    p_forma_prevista: pagamento.forma,
    p_parcelas: pagamento.parcelas,
    p_pago_em: pagamento.pagoEm,
    p_observacao_financeiro: pagamento.observacao,
  };
}

export function criarDespesaManual(dados, pagamento) {
  return chamar('contas_pagar_criar_manual', {
    p_descricao: dados.descricao,
    p_categoria_id: dados.categoriaId,
    p_fornecedor_id: dados.fornecedorId || null,
    p_credor_nome: dados.fornecedorId ? null : dados.credorNome,
    p_competencia: dados.competencia,
    p_condicao: pagamento.condicao,
    p_forma_prevista: pagamento.forma,
    p_parcelas: pagamento.parcelas,
    p_pago_em: pagamento.pagoEm,
    p_observacao: pagamento.observacao,
  }, 'Não foi possível criar a despesa.');
}

export function editarConta(contaId, dados) {
  return chamar('contas_pagar_editar_conta', {
    p_conta_id: contaId,
    p_descricao: dados.descricao ?? null,
    p_categoria_id: dados.categoriaId ?? null,
    p_fornecedor_id: dados.fornecedorId || null,
    p_credor_nome: dados.fornecedorId ? null : dados.credorNome ?? null,
    p_competencia: dados.competencia ?? null,
    p_observacao: dados.observacao ?? null,
  }, 'Não foi possível salvar a conta.');
}

export function replanejarConta(contaId, forma, parcelas) {
  return chamar('contas_pagar_replanejar', { p_conta_id: contaId, p_forma_prevista: forma, p_parcelas: parcelas }, 'Não foi possível replanejar.');
}

export function pagarParcela(parcelaId, { pagoEm, forma, juros, multa, desconto, valorPago, observacao }) {
  return chamar('contas_pagar_pagar_parcela', {
    p_parcela_id: parcelaId,
    p_pago_em: pagoEm,
    p_forma_pagamento: forma,
    p_juros: juros,
    p_multa: multa,
    p_desconto: desconto,
    p_valor_pago: valorPago,
    p_observacao: observacao || null,
  }, 'Não foi possível registrar o pagamento.');
}

export function estornarBaixa(baixaId, motivo) {
  return chamar('contas_pagar_estornar_baixa', { p_baixa_id: baixaId, p_motivo: motivo }, 'Não foi possível estornar o pagamento.');
}

export function cancelarConta(contaId, motivo) {
  return chamar('contas_pagar_cancelar', { p_conta_id: contaId, p_motivo: motivo }, 'Não foi possível cancelar a conta.');
}

export function salvarCategoria(id, nome) {
  return chamar('contas_pagar_salvar_categoria', { p_id: id || null, p_nome: nome }, 'Não foi possível salvar a categoria.');
}

export function definirCategoriaAtiva(id, ativo) {
  return chamar('contas_pagar_definir_categoria_ativa', { p_id: id, p_ativo: ativo }, 'Não foi possível alterar a categoria.');
}
