// Comunicação / Documentos de RH -- acesso ao Supabase (Etapa 2).
// Leitura pelas tabelas (RLS da migration 0077); escrita SOMENTE pelas 5
// RPCs. Nenhuma regra aqui: erros sobem como vieram (a tela traduz com
// mensagemErroDocumento) -- funções que lançam, para a tela decidir.

import { createClient } from '../supabase/client';
import { condicoesConsultaDocumentos } from './apresentacao';

function falhar(error) {
  if (error) throw error;
}

// Colunas do histórico: o snapshot inteiro fica fora da lista (só o nome do
// modelo e do funcionário congelados na emissão).
const COLUNAS_LISTA = [
  'id', 'ano', 'numero', 'numero_formatado', 'data_emissao', 'titulo', 'assunto', 'data_ocorrencia',
  'abrangencia', 'status', 'modelo_id', 'modelo_versao', 'funcionario_id', 'criado_por_nome', 'cancelado_em',
  'modelo_nome:snapshot->modelo->>nome', 'funcionario_nome:snapshot->funcionario->>nome',
].join(', ');

export async function listarDocumentos(filtros = {}) {
  let query = createClient()
    .from('folha_documentos')
    .select(COLUNAS_LISTA)
    .order('data_emissao', { ascending: false })
    .order('ano', { ascending: false })
    .order('numero', { ascending: false });
  for (const [operador, coluna, valor] of condicoesConsultaDocumentos(filtros)) query = query[operador](coluna, valor);
  const { data, error } = await query;
  falhar(error);
  return data || [];
}

export async function carregarDocumento(id) {
  const { data, error } = await createClient().from('folha_documentos').select('*').eq('id', id).maybeSingle();
  falhar(error);
  return data;
}

export async function listarModelos() {
  const { data, error } = await createClient().from('folha_documentos_modelos').select('*').order('nome');
  falhar(error);
  return data || [];
}

export async function carregarModelo(id) {
  const { data, error } = await createClient().from('folha_documentos_modelos').select('*').eq('id', id).maybeSingle();
  falhar(error);
  return data;
}

export async function carregarConfig() {
  const { data, error } = await createClient().from('folha_documentos_config').select('*').maybeSingle();
  falhar(error);
  return data;
}

// Funcionários para escolher/filtrar (ativos e inativos). A leitura segue a
// RLS do cadastro (funcionarios.visualizar). cargo = nome do cargo, como a
// emissão usa.
export async function listarFuncionarios() {
  const { data, error } = await createClient()
    .from('funcionarios')
    .select('id, nome, cpf, rg, data_admissao, ativo, cargo_id, funcionarios_cargos(nome)')
    .order('nome');
  falhar(error);
  return (data || []).map(({ funcionarios_cargos: cargo, ...f }) => ({ ...f, cargo: cargo?.nome ?? null }));
}

// --- RPCs ------------------------------------------------------------------

export async function salvarConfig(c) {
  const { error } = await createClient().rpc('folha_documentos_config_salvar', {
    p_nome_fantasia: c.nome_fantasia,
    p_razao_social: c.razao_social,
    p_cnpj: c.cnpj,
    p_endereco: c.endereco,
    p_cidade_uf: c.cidade_uf,
    p_responsavel_nome: c.responsavel_nome,
    p_responsavel_cargo: c.responsavel_cargo,
  });
  falhar(error);
}

// modelo: payload de normalizarModelo; id/versaoEsperada só na edição.
export async function salvarModelo(modelo, { id = null, versaoEsperada = null, ativo = true } = {}) {
  const { data, error } = await createClient().rpc('folha_documento_modelo_salvar', {
    p_modelo_id: id,
    p_versao_esperada: versaoEsperada,
    p_nome: modelo.nome,
    p_descricao: modelo.descricao,
    p_titulo_impresso: modelo.titulo_impresso,
    p_abrangencia: modelo.abrangencia,
    p_corpo: modelo.corpo,
    p_campos: modelo.campos,
    p_assinatura_empresa: modelo.assinatura_empresa,
    p_assinatura_funcionario: modelo.assinatura_funcionario,
    p_testemunhas: modelo.testemunhas,
    p_local_data: modelo.local_data,
    p_ativo: ativo,
  });
  falhar(error);
  return data; // { id, versao }
}

export async function definirModeloAtivo(id, ativo) {
  const { error } = await createClient().rpc('folha_documento_modelo_definir_ativo', { p_modelo_id: id, p_ativo: ativo });
  falhar(error);
}

// Emissão autoritativa: o banco relê tudo, numera e grava. Devolve o id.
export async function emitirDocumento({ modeloId, modeloVersao, funcionarioId, valores }) {
  const { data, error } = await createClient().rpc('folha_documento_emitir', {
    p_modelo_id: modeloId,
    p_modelo_versao: modeloVersao,
    p_funcionario_id: funcionarioId,
    p_valores: valores,
  });
  falhar(error);
  return data;
}

export async function cancelarDocumento(id, motivo) {
  const { error } = await createClient().rpc('folha_documento_cancelar', { p_documento_id: id, p_motivo: motivo });
  falhar(error);
}
