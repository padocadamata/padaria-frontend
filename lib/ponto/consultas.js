// Cartão-Ponto -- acesso ao Supabase (Etapa 2). Leitura pelas 2 RPCs de
// leitura da migration 0078 e pelas tabelas (RLS: SELECT com
// folha_ponto.visualizar); ESCRITA somente pelas 7 RPCs da 0078 (SECURITY
// DEFINER, cada uma confere a sua permissão, a versão esperada e as mesmas
// regras de lib/ponto) -- nunca insert/update/delete direto. Nenhuma regra
// aqui: erros sobem como vieram (a tela traduz com mensagemDoErro de
// lancamento.js) -- funções que lançam. Só TEMPO: nenhuma ligação com a parte
// financeira da Folha.

import { createClient } from '../supabase/client.js';

// Únicas RPCs chamadas por este arquivo (o teste confere).
export const RPCS_LEITURA = ['folha_ponto_competencia_resumo', 'folha_ponto_base'];
export const RPCS_ESCRITA = [
  'folha_ponto_cartao_abrir', 'folha_ponto_dias_salvar', 'folha_ponto_atestado_salvar', 'folha_ponto_atestado_cancelar',
  'folha_ponto_cartao_conferir', 'folha_ponto_cartao_fechar', 'folha_ponto_cartao_reabrir',
];

function falhar(error) {
  if (error) throw error;
}

// 'AAAA-MM' ou 'AAAA-MM-DD' -> 'AAAA-MM-01' (o banco guarda a competência
// no dia 1).
export function competenciaDe(valor) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(valor || '');
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error('competência inválida (use AAAA-MM).');
  return `${m[1]}-${m[2]}-01`;
}

// Funcionárias da competência (algum dia do mês no vínculo CLT, ou cartão
// já existente): [{funcionario_id, nome, cargo, ativo, cartao_id, status,
// versao, conferido}] -- cartao_id null = cartão ainda não aberto.
export async function listarCompetencia(competencia) {
  const { data, error } = await createClient()
    .rpc('folha_ponto_competencia_resumo', { p_competencia: competenciaDe(competencia) });
  falhar(error);
  return data || [];
}

// Base do mês (entrada de apurarCartao) + `cartao` (null = ainda não
// aberto). A PRÉVIA usa esta mesma leitura: nada é criado no banco. Cartão
// fechado: a tela usa SÓ cartao.snapshot.
export async function carregarCartao(funcionarioId, competencia) {
  if (!funcionarioId) throw new Error('informe a funcionária.');
  const { data, error } = await createClient()
    .rpc('folha_ponto_base', { p_funcionario_id: funcionarioId, p_competencia: competenciaDe(competencia) });
  falhar(error);
  return data;
}

const COLUNAS_ATESTADO = [
  'id', 'funcionario_id', 'tipo', 'abrangencia', 'data_inicio', 'data_fim', 'hora_inicio', 'hora_fim', 'descricao',
  'status', 'versao', 'criado_em', 'criado_por_nome', 'atualizado_em', 'atualizado_por_nome',
  'cancelado_em', 'cancelado_por_nome', 'motivo_cancelamento',
].join(', ');

// Todos os atestados da funcionária (a base do mês só traz os ativos que
// tocam aquele mês). Mais recentes primeiro.
export async function listarAtestados(funcionarioId, { incluirCancelados = false } = {}) {
  let query = createClient()
    .from('folha_ponto_atestados')
    .select(COLUNAS_ATESTADO)
    .eq('funcionario_id', funcionarioId)
    .order('data_inicio', { ascending: false });
  if (!incluirCancelados) query = query.eq('status', 'ativo');
  const { data, error } = await query;
  falhar(error);
  return data || [];
}

// Histórico do cartão. `dados` fica de fora: no evento reabrir ele guarda o
// snapshot inteiro desfeito (pesado) -- a tela pede à parte se precisar.
const COLUNAS_EVENTO = 'id, acao, data, situacao_anterior, situacao_nova, motivo, versao, criado_em, criado_por_nome';

export async function listarEventosDoCartao(cartaoId) {
  const { data, error } = await createClient()
    .from('folha_ponto_eventos')
    .select(COLUNAS_EVENTO)
    .eq('cartao_id', cartaoId)
    .order('criado_em', { ascending: true });
  falhar(error);
  return data || [];
}

// Histórico de um atestado, com o antes/depois de cada alteração.
export async function listarEventosDoAtestado(atestadoId) {
  const { data, error } = await createClient()
    .from('folha_ponto_eventos')
    .select(`${COLUNAS_EVENTO}, dados`)
    .eq('atestado_id', atestadoId)
    .order('criado_em', { ascending: true });
  falhar(error);
  return data || [];
}

// Dados da empresa para o PDF de um cartão AINDA NÃO fechado (o fechado usa
// o do snapshot). A RLS da 0077 só libera para quem vê/emite documentos:
// sem acesso, o PDF sai com o nome da marca -- nunca é erro.
export async function carregarEmpresa() {
  const { data, error } = await createClient()
    .from('folha_documentos_config')
    .select('nome_fantasia, razao_social, cnpj, cidade_uf')
    .maybeSingle();
  if (error) return null;
  return data || null;
}

// --- Escrita (somente RPCs da 0078) ----------------------------------------------

async function rpc(nome, args) {
  const { data, error } = await createClient().rpc(nome, args);
  falhar(error);
  return data;
}

// Ação EXPLÍCITA do usuário (nunca automática na prévia): {cartao_id, versao, criado}.
export function abrirCartao(funcionarioId, competencia) {
  return rpc('folha_ponto_cartao_abrir', { p_funcionario_id: funcionarioId, p_competencia: competenciaDe(competencia) });
}

// Lote validado por montarLote (apresentacao.js). Devolve a nova versão.
export function salvarDias(cartaoId, versaoEsperada, itens) {
  return rpc('folha_ponto_dias_salvar', { p_cartao_id: cartaoId, p_versao_esperada: versaoEsperada, p_dias: itens });
}

// Registrar (id null) ou alterar (id + versão) -- atestado como validarAtestado devolve.
export function salvarAtestado({ id = null, versao = null, funcionarioId, atestado }) {
  return rpc('folha_ponto_atestado_salvar', {
    p_atestado_id: id,
    p_versao_esperada: versao,
    p_funcionario_id: funcionarioId,
    p_tipo: atestado.tipo,
    p_abrangencia: atestado.abrangencia,
    p_data_inicio: atestado.data_inicio,
    p_data_fim: atestado.data_fim,
    p_hora_inicio: atestado.hora_inicio,
    p_hora_fim: atestado.hora_fim,
    p_descricao: atestado.descricao,
  });
}

export function cancelarAtestado(id, versaoEsperada, motivo) {
  return rpc('folha_ponto_atestado_cancelar', { p_atestado_id: id, p_versao_esperada: versaoEsperada, p_motivo: motivo });
}

export function conferirCartao(cartaoId, versaoEsperada) {
  return rpc('folha_ponto_cartao_conferir', { p_cartao_id: cartaoId, p_versao_esperada: versaoEsperada });
}

export function fecharCartao(cartaoId, versaoEsperada) {
  return rpc('folha_ponto_cartao_fechar', { p_cartao_id: cartaoId, p_versao_esperada: versaoEsperada });
}

export function reabrirCartao(cartaoId, versaoEsperada, motivo) {
  return rpc('folha_ponto_cartao_reabrir', { p_cartao_id: cartaoId, p_versao_esperada: versaoEsperada, p_motivo: motivo });
}
