import { createClient } from '../supabase/client';

// Folha > Pagamentos > Lançamentos (migration 0076). Leitura direta (RLS:
// folha_pagamentos.visualizar); escrita SOMENTE por RPC -- autoria, status e
// vínculo com pagamento são sempre do servidor, nunca do navegador.
// { disponivel: false } quando a 0076 ainda não está no banco: a tela
// esconde a funcionalidade em vez de quebrar.

function mensagemErroLancamento(error, padrao) {
  const msg = error?.message || '';
  if (msg.includes('requer a permissao')) return 'Você não tem permissão para esta ação.';
  if (msg.includes('ja existe um tipo')) return 'Já existe um tipo de lançamento com este nome.';
  if (msg.includes('tipo de lancamento inativo')) return 'Este tipo de lançamento está inativo. Escolha um tipo ativo.';
  if (msg.includes('funcionaria inativa')) return 'Esta funcionária está inativa e não recebe novos lançamentos.';
  if (msg.includes('so lancamento pendente')) return 'Este lançamento não está mais pendente (já foi usado num pagamento ou cancelado). Atualize a tela.';
  if (msg.includes('motivo do cancelamento e obrigatorio')) return 'Informe o motivo do cancelamento.';
  if (msg.includes('nao pode ser no futuro')) return 'A data do lançamento não pode ser no futuro.';
  if (msg.includes('maior que zero')) return 'Informe um valor maior que zero.';
  if (msg.includes('nome do tipo muito longo')) return 'O nome do tipo pode ter no máximo 60 caracteres.';
  if (msg.includes('nao encontrad')) return 'Registro não encontrado. Atualize a tela.';
  console.error(padrao, error);
  return padrao;
}

export async function buscarTiposLancamento() {
  const supabase = createClient();
  const { data, error } = await supabase.from('folha_lancamentos_tipos').select('id, nome, natureza, ativo').order('nome');
  if (error) {
    console.error('Tipos de lançamento indisponíveis:', error);
    return { disponivel: false, tipos: [] };
  }
  return { disponivel: true, tipos: data || [] };
}

export async function salvarTipoLancamento({ id = null, nome, natureza, ativo = true }) {
  const supabase = createClient();
  const { error } = await supabase.rpc('folha_lancamento_tipo_salvar', { p_tipo_id: id, p_nome: nome, p_natureza: natureza, p_ativo: ativo });
  if (error) return { erro: mensagemErroLancamento(error, 'Não foi possível salvar o tipo de lançamento.') };
  return { erro: '' };
}

const COLUNAS_LANCAMENTO =
  'id, funcionario_id, tipo_id, natureza, valor, data_lancamento, observacao, status, criado_em, criado_por_nome, atualizado_em, atualizado_por_nome, folha_lancamentos_tipos(nome, ativo), funcionarios(nome, ativo)';

// Todos os PENDENTES (de todas as funcionárias) numa consulta só.
export async function buscarLancamentosPendentes() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('folha_lancamentos')
    .select(COLUNAS_LANCAMENTO)
    .eq('status', 'pendente')
    .order('data_lancamento')
    .order('criado_em');
  if (error) {
    console.error('Lançamentos indisponíveis:', error);
    return { disponivel: false, lancamentos: [] };
  }
  return {
    disponivel: true,
    lancamentos: (data || []).map((l) => ({
      ...l,
      tipo_nome: l.folha_lancamentos_tipos?.nome || '—',
      tipo_ativo: l.folha_lancamentos_tipos?.ativo ?? true,
      funcionario_nome: l.funcionarios?.nome || '—',
      funcionario_ativo: l.funcionarios?.ativo ?? true,
    })),
  };
}

export async function criarLancamento({ funcionarioId, tipoId, natureza, valor, data, observacao }) {
  const supabase = createClient();
  const { error } = await supabase.rpc('folha_lancamento_criar', {
    p_funcionario_id: funcionarioId,
    p_tipo_id: tipoId,
    p_natureza: natureza,
    p_valor: valor,
    p_data_lancamento: data,
    p_observacao: observacao || null,
  });
  if (error) return { erro: mensagemErroLancamento(error, 'Não foi possível registrar o lançamento.') };
  return { erro: '' };
}

export async function editarLancamento(id, { tipoId, natureza, valor, data, observacao }) {
  const supabase = createClient();
  const { error } = await supabase.rpc('folha_lancamento_editar', {
    p_lancamento_id: id,
    p_tipo_id: tipoId,
    p_natureza: natureza,
    p_valor: valor,
    p_data_lancamento: data,
    p_observacao: observacao || null,
  });
  if (error) return { erro: mensagemErroLancamento(error, 'Não foi possível salvar o lançamento.') };
  return { erro: '' };
}

export async function cancelarLancamento(id, motivo) {
  const supabase = createClient();
  const { error } = await supabase.rpc('folha_lancamento_cancelar', { p_lancamento_id: id, p_motivo: motivo });
  if (error) return { erro: mensagemErroLancamento(error, 'Não foi possível cancelar o lançamento.') };
  return { erro: '' };
}
