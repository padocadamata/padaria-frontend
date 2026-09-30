import { createClient } from '../supabase/client';

// Acesso ao banco de Tarefas (migration 0061). Leitura direta nas tabelas
// (RLS: tarefas.visualizar); TODA escrita passa pelas RPCs SECURITY
// DEFINER -- não existe policy de escrita nessas tabelas.

const TAMANHO_LOTE = 1000;

export async function carregarCadastro() {
  const supabase = createClient();
  const [categorias, grupos, tarefas, regras, nomes] = await Promise.all([
    supabase.from('tarefas_categorias').select('valor, ordem').order('ordem'),
    supabase.from('tarefas_grupos').select('id, nome, rotacao, ordem').order('ordem'),
    supabase.from('tarefas').select('id, descricao, categoria, ordem, ativo, observacao').order('ordem'),
    supabase.from('tarefas_regras').select('id, tarefa_id, vigente_desde, tipo, dias_semana, semanas_do_mes, grupo_id').order('vigente_desde'),
    supabase.from('tarefas_posicoes_nomes').select('id, posicao, vigente_desde, nome').order('vigente_desde'),
  ]);
  const erro = [categorias, grupos, tarefas, regras, nomes].find((r) => r.error)?.error;
  if (erro) throw erro;

  const regrasPorTarefa = new Map();
  for (const r of regras.data) {
    if (!regrasPorTarefa.has(r.tarefa_id)) regrasPorTarefa.set(r.tarefa_id, []);
    regrasPorTarefa.get(r.tarefa_id).push(r);
  }
  return {
    categorias: categorias.data,
    grupos: grupos.data,
    tarefas: tarefas.data,
    regrasPorTarefa,
    nomes: nomes.data,
  };
}

// Ocorrências materializadas de um intervalo, paginadas (um mês passa de
// 700 linhas -- nunca depender do limite padrão de linhas do PostgREST).
export async function carregarOcorrencias(inicio, fim) {
  const supabase = createClient();
  const todas = [];
  for (let de = 0; ; de += TAMANHO_LOTE) {
    const { data, error } = await supabase
      .from('tarefas_ocorrencias')
      .select('*')
      .gte('data', inicio)
      .lte('data', fim)
      .order('data')
      .order('id')
      .range(de, de + TAMANHO_LOTE - 1);
    if (error) throw error;
    todas.push(...data);
    if (data.length < TAMANHO_LOTE) break;
  }
  return todas;
}

// Execuções reais (migration 0062) das ocorrências de um intervalo --
// filtro pela data da ocorrência via join embutido (!inner), paginado.
export async function carregarExecucoes(inicio, fim) {
  const supabase = createClient();
  const todas = [];
  for (let de = 0; ; de += TAMANHO_LOTE) {
    const { data, error } = await supabase
      .from('tarefas_ocorrencias_execucoes')
      .select('id, ocorrencia_id, ordem, responsavel_nome, concluido_por, concluido_em, tarefas_ocorrencias!inner(data)')
      .gte('tarefas_ocorrencias.data', inicio)
      .lte('tarefas_ocorrencias.data', fim)
      .order('id')
      .range(de, de + TAMANHO_LOTE - 1);
    if (error) throw error;
    todas.push(...data.map(({ tarefas_ocorrencias: _ocorrencia, ...execucao }) => execucao));
    if (data.length < TAMANHO_LOTE) break;
  }
  return todas;
}

export async function carregarMesProgramado(mes) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('tarefas_meses')
    .select('mes, programado_em, programado_por, sincronizado_em')
    .eq('mes', mes)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Nome de quem marcou/ajustou/cancelou -- melhor esforço: a RLS de
// public.usuarios só libera a própria linha (ou todas para admin); ids
// não resolvidos simplesmente ficam sem nome na tela.
export async function carregarNomesUsuarios(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (unicos.length === 0) return new Map();
  const supabase = createClient();
  const { data } = await supabase.from('usuarios').select('id, nome').in('id', unicos);
  return new Map((data || []).map((u) => [u.id, u.nome]));
}

async function chamar(nome, parametros) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(nome, parametros);
  if (error) throw error;
  return data;
}

export const programarMes = (mes, simular) => chamar('programar_mes_tarefas', { p_mes: mes, p_simular: simular });

export const salvarTarefa = (dados, simular) =>
  chamar('salvar_tarefa', {
    p_tarefa_id: dados.id ?? null,
    p_descricao: dados.descricao,
    p_categoria: dados.categoria,
    p_ordem: dados.ordem ?? null,
    p_observacao: dados.observacao ?? null,
    p_tipo: dados.tipo,
    p_dias_semana: dados.dias_semana,
    p_semanas_do_mes: dados.semanas_do_mes,
    p_grupo_id: dados.grupo_id ?? null,
    p_aplicar_a_partir_de: dados.aplicarAPartirDe ?? null,
    p_ativo: dados.ativo ?? null,
    p_simular: simular,
  });

export const inativarTarefa = (id, aPartirDe, simular) =>
  chamar('inativar_tarefa', { p_tarefa_id: id, p_a_partir_de: aPartirDe, p_simular: simular });

export const excluirTarefa = (id) => chamar('excluir_tarefa', { p_tarefa_id: id });

export const salvarGrupo = (id, nome, rotacao) =>
  chamar('salvar_grupo_tarefas', { p_grupo_id: id ?? null, p_nome: nome, p_rotacao: rotacao ?? null, p_ordem: null });

export const excluirGrupo = (id) => chamar('excluir_grupo_tarefas', { p_grupo_id: id });

export const definirNomePosicao = (posicao, nome, aPartirDe, simular) =>
  chamar('definir_nome_posicao_tarefas', { p_posicao: posicao, p_nome: nome, p_a_partir_de: aPartirDe, p_simular: simular });

// Execuções (0062): todas devolvem { ocorrencia, execucoes }.
export const registrarExecucao = (ocorrenciaId, responsavelNome) =>
  chamar('registrar_execucao_tarefa', { p_ocorrencia_id: ocorrenciaId, p_responsavel_nome: responsavelNome || null });

export const removerExecucao = (execucaoId) => chamar('remover_execucao_tarefa', { p_execucao_id: execucaoId });

export const renomearExecucao = (execucaoId, responsavelNome) =>
  chamar('renomear_execucao_tarefa', { p_execucao_id: execucaoId, p_responsavel_nome: responsavelNome || null });

export const ajustarOcorrencia = (id, posicao, responsavelAvulso) =>
  chamar('ajustar_ocorrencia_tarefa', { p_ocorrencia_id: id, p_posicao: posicao, p_responsavel_avulso: responsavelAvulso || null });

export const desfazerAjuste = (id) => chamar('desfazer_ajuste_ocorrencia_tarefa', { p_ocorrencia_id: id });

export const cancelarOcorrencia = (id, motivo) =>
  chamar('cancelar_ocorrencia_tarefa', { p_ocorrencia_id: id, p_motivo: motivo });

export const restaurarOcorrencia = (id) => chamar('restaurar_ocorrencia_tarefa', { p_ocorrencia_id: id });

export const criarOcorrenciaAvulsa = (tarefaId, data, posicao, responsavelAvulso) =>
  chamar('criar_ocorrencia_avulsa_tarefa', {
    p_tarefa_id: tarefaId,
    p_data: data,
    p_posicao: posicao,
    p_responsavel_avulso: responsavelAvulso || null,
  });

export const excluirOcorrenciaAvulsa = (id) => chamar('excluir_ocorrencia_avulsa_tarefa', { p_ocorrencia_id: id });
