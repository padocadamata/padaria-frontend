import { createClient } from '../supabase/client';

// Encomendas (migration 0071). Leitura SEMPRE por listar_encomendas (a
// mesma RPC alimenta a tela, a Agenda e o Dashboard -- nunca duas
// definições de consulta); escrita SOMENTE por salvar_encomenda /
// definir_status_encomenda; buscas do formulário por
// buscar_clientes_encomenda / buscar_produtos_encomenda (teto 20 / 50, o
// mesmo do banco). O cadastro rápido de cliente usa salvarCliente de
// lib/clientes/clientes.js (mesma RPC e regras de Clientes).

export const LIMITE_ENCOMENDAS = 2000;
export const LIMITE_BUSCA_CLIENTES = 20;
export const LIMITE_BUSCA_PRODUTOS_ENCOMENDA = 50;

function mapear(linha) {
  return {
    id: linha.id,
    cliente_id: linha.cliente_id,
    cliente_nome: linha.cliente_nome,
    cliente_telefone: linha.cliente_telefone,
    cliente_ativo: linha.cliente_ativo,
    data_retirada: linha.data_retirada,
    hora_retirada: linha.hora_retirada,
    data_pedido: linha.data_pedido,
    status: linha.status,
    criado_em: linha.criado_em,
    atualizado_em: linha.atualizado_em,
    itens: (linha.itens || []).map((i) => ({
      produto_id: i.produto_id,
      produto_nome: i.produto_nome,
      produto_ativo: i.produto_ativo !== false,
      produto_disponivel: i.produto_disponivel !== false,
      quantidade: Number(i.quantidade),
      comentario: i.comentario || '',
    })),
  };
}

// Encomendas com retirada em [inicio, fim] (YYYY-MM-DD).
export async function carregarEncomendas(inicio, fim, supabase = createClient()) {
  const { data, error } = await supabase.rpc('listar_encomendas', { p_inicio: inicio, p_fim: fim });
  if (error) {
    console.error('Erro ao carregar encomendas:', error?.code, error);
    return { encomendas: [], erro: 'Não foi possível carregar as encomendas.', limiteAtingido: false };
  }
  const encomendas = (data || []).map(mapear);
  return { encomendas, erro: '', limiteAtingido: encomendas.length >= LIMITE_ENCOMENDAS };
}

export function mensagemErroEncomenda(error) {
  const msg = error?.message || '';
  if (error?.code === '42501' || msg.includes('requer a permissao')) return 'Você não tem permissão para alterar encomendas.';
  const produto = msg.match(/o produto "(.+)" nao pode ser encomendado/);
  if (produto) return `O produto "${produto[1]}" não pode ser encomendado: precisa estar ativo e marcado no Catálogo como "Disponível para encomenda".`;
  const textos = [
    ['so encomendas pendentes podem ser editadas', 'Só encomendas pendentes podem ser editadas. Reabra a encomenda antes.'],
    ['cliente inativo', 'Este cliente está inativo. Reative o cadastro em Clientes antes de registrar a encomenda.'],
    ['informe o cliente', 'Escolha o cliente da encomenda.'],
    ['data e o horario', 'Informe a data e o horário da retirada.'],
    ['informe a data do pedido', 'Informe a data do pedido.'],
    ['nao pode ser futura', 'A data do pedido não pode ser futura.'],
    ['depois da retirada', 'A data do pedido não pode ser depois da retirada.'],
    ['nao pode estar no passado', 'A data de retirada não pode estar no passado.'],
    ['pelo menos um produto', 'Inclua pelo menos um produto.'],
    ['no maximo 100 itens', 'No máximo 100 itens por encomenda.'],
    ['quantidade', 'Quantidade inválida: maior que zero, até 99999, no máximo 3 casas decimais.'],
    ['comentario muito longo', 'Comentário muito longo (máximo 500 caracteres).'],
    ['reabra a encomenda', 'Reabra a encomenda antes de mudar para outro status.'],
    ['ja esta com este status', 'A encomenda já está com este status. Recarregue a página.'],
    ['nao encontrad', 'Registro não encontrado. Recarregue a página.'],
  ];
  const conhecido = textos.find(([trecho]) => msg.includes(trecho));
  if (conhecido) return conhecido[1];
  console.error('Erro ao salvar encomenda:', error);
  return 'Não foi possível salvar a encomenda. Tente novamente.';
}

export async function salvarEncomenda({ id, clienteId, dataRetirada, horaRetirada, dataPedido, itens }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('salvar_encomenda', {
    p_encomenda_id: id || null,
    p_cliente_id: clienteId,
    p_data_retirada: dataRetirada,
    p_hora_retirada: horaRetirada,
    p_data_pedido: dataPedido,
    p_itens: itens,
  });
  if (error) return { id: null, erro: mensagemErroEncomenda(error) };
  return { id: data, erro: '' };
}

export async function definirStatusEncomenda(id, status) {
  const supabase = createClient();
  const { error } = await supabase.rpc('definir_status_encomenda', { p_encomenda_id: id, p_status: status });
  if (error) return { erro: mensagemErroEncomenda(error) };
  return { erro: '' };
}

function erroDeBusca(error, o_que) {
  console.error(`Erro ao buscar ${o_que}:`, error?.code, error);
  if (error?.code === '42501') return 'Você não tem permissão para lançar encomendas.';
  return `Não foi possível buscar ${o_que} agora (erro técnico). Tente novamente.`;
}

// Mesmo contrato de buscarProdutosInteresse ({ produtos, erro }) para
// reaproveitar lib/clientes/seletorProdutos.js.
export async function buscarProdutosEncomenda(termo, limite = LIMITE_BUSCA_PRODUTOS_ENCOMENDA) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('buscar_produtos_encomenda', { p_termo: termo || '', p_limite: limite });
  if (error) return { produtos: [], erro: erroDeBusca(error, 'produtos') };
  return { produtos: data || [], erro: '' };
}

// Devolve no formato { produtos } de propósito: o seletor genérico
// (buscarSeHouverTermo) espera essa chave.
export async function buscarClientesEncomenda(termo, limite = LIMITE_BUSCA_CLIENTES) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('buscar_clientes_encomenda', { p_termo: termo || '', p_limite: limite });
  if (error) return { produtos: [], erro: erroDeBusca(error, 'clientes') };
  return { produtos: data || [], erro: '' };
}
