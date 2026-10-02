import { createClient } from '../supabase/client';

// Clientes (migration 0069). Leitura direta (RLS: clientes.visualizar),
// numa única consulta com os produtos de interesse embutidos (nunca 1
// consulta por cliente). Escrita SOMENTE pelas RPCs salvar_cliente /
// definir_status_cliente; o seletor de produtos usa
// buscar_produtos_interesse_cliente (só produtos ativos e marcados no
// Catálogo como "Disponível para interesse de clientes", no máximo
// LIMITE_BUSCA_PRODUTOS por busca -- o mesmo teto do banco).

const LIMITE_CLIENTES = 2000;
export const LIMITE_BUSCA_PRODUTOS = 50;

export async function carregarClientes() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('clientes')
    .select('id, nome, telefone, observacao, ativo, criado_em, atualizado_em, clientes_produtos(produto_id, produtos(id, nome, ativo, disponivel_interesse_cliente))')
    .order('nome')
    .limit(LIMITE_CLIENTES);
  if (error) {
    console.error('Erro ao carregar clientes:', error);
    return { clientes: [], erro: 'Não foi possível carregar os clientes.', limiteAtingido: false };
  }
  const clientes = (data || []).map((c) => ({
    id: c.id,
    nome: c.nome,
    telefone: c.telefone,
    observacao: c.observacao,
    ativo: c.ativo,
    criado_em: c.criado_em,
    atualizado_em: c.atualizado_em,
    produtos: (c.clientes_produtos || [])
      .map((cp) => ({
        produto_id: cp.produto_id,
        nome: cp.produtos?.nome || '(produto removido)',
        ativo: cp.produtos?.ativo !== false,
        disponivel: cp.produtos?.disponivel_interesse_cliente !== false,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  }));
  return { clientes, erro: '', limiteAtingido: clientes.length >= LIMITE_CLIENTES };
}

export function mensagemErroCliente(error) {
  const msg = error?.message || '';
  const dup = msg.match(/telefone ja cadastrado para (.+) \((ativo|inativo)\)/);
  if (dup) return `Este telefone já está cadastrado para ${dup[1]}${dup[2] === 'inativo' ? ' (cliente inativo — reative o cadastro existente)' : ''}.`;
  if (msg.includes('telefone ja cadastrado')) return 'Este telefone já está cadastrado para outro cliente.';
  if (msg.includes('telefone invalido')) return 'Telefone inválido. Informe DDD + número (celular com 9 dígitos ou fixo com 8).';
  if (msg.includes('informe o nome')) return 'Informe o nome do cliente.';
  if (msg.includes('nome muito longo')) return 'Nome muito longo (máximo 120 caracteres).';
  if (msg.includes('observacao muito longa')) return 'Observação muito longa (máximo 1000 caracteres).';
  const produto = msg.match(/o produto "(.+)" nao pode ser associado/);
  if (produto) return `O produto "${produto[1]}" não pode receber novos interesses: precisa estar ativo e marcado no Catálogo como "Disponível para interesse de clientes".`;
  if (msg.includes('requer a permissao')) return 'Você não tem permissão para alterar clientes.';
  console.error('Erro ao salvar cliente:', error);
  return 'Não foi possível salvar o cliente. Tente novamente.';
}

export async function salvarCliente({ id, nome, telefone, observacao, produtoIds }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('salvar_cliente', {
    p_cliente_id: id || null,
    p_nome: nome,
    p_telefone: telefone,
    p_observacao: observacao || null,
    p_produto_ids: produtoIds || [],
  });
  if (error) return { id: null, erro: mensagemErroCliente(error) };
  return { id: data, erro: '' };
}

export async function definirStatusCliente(id, ativo) {
  const supabase = createClient();
  const { error } = await supabase.rpc('definir_status_cliente', { p_cliente_id: id, p_ativo: ativo });
  if (error) return { erro: mensagemErroCliente(error) };
  return { erro: '' };
}

export async function buscarProdutosInteresse(termo, limite = LIMITE_BUSCA_PRODUTOS) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('buscar_produtos_interesse_cliente', { p_termo: termo || '', p_limite: limite });
  if (error) {
    // Falha técnica (nunca confundir com "nenhum resultado", que volta com
    // erro vazio e lista vazia). O código do Postgres vai para o console
    // para diagnóstico -- ex.: 42804 era o defeito de tipo corrigido pela
    // migration 0070.
    console.error('Erro ao buscar produtos:', error?.code, error);
    if (error?.code === '42501') return { produtos: [], erro: 'Você não tem permissão para buscar produtos (clientes.visualizar).' };
    return { produtos: [], erro: 'Não foi possível buscar produtos agora (erro técnico). Tente novamente; se continuar, avise o administrador.' };
  }
  return { produtos: data || [], erro: '' };
}
