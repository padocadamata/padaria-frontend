// Consultas da Agenda compartilhadas entre a página /agenda e o card
// "Agenda de hoje" do Dashboard -- ÚNICA definição das regras de busca, para
// as duas telas nunca divergirem. Código movido de pages/agenda.js sem mudar
// nenhuma regra (mesmos filtros, mesmas 3 consultas, mesmo tratamento das
// exceções). Não escreve nada: só SELECT.
//
// Permissões: agenda_itens/agenda_ocorrencias só respondem para quem tem
// agenda.visualizar (RLS, migration 0038); funcionários só respondem para
// quem tem funcionarios.visualizar. Quem chama decide se dispara cada busca
// (mesmo gate de sempre) -- este arquivo não decide acesso.

export const SELECT_ITENS_AGENDA =
  'id, tipo, titulo, descricao, categoria, data_inicio, data_fim, hora_inicio, hora_fim, dia_inteiro, ' +
  'tipo_recorrencia, recorrencia_intervalo, recorrencia_dias_semana, recorrencia_data_fim, ' +
  'concluido_em, concluido_por, observacao_conclusao, criado_por, criado_em, atualizado_em';

// Consulta por janela (seção 22/6 da arquitetura aprovada): nunca
// busca "todas as ocorrências futuras" nem superbusca avulsos antigos
// indefinidamente. 3 consultas em paralelo, cada uma com o filtro
// correto para o seu caso (mais simples e seguro do que tentar
// expressar tudo numa única consulta com OR/AND aninhados):
//   A) eventos avulsos: data_inicio <= fim E
//      coalesce(data_fim, data_inicio) >= início;
//   B) tarefas avulsas: data_inicio dentro de [início, fim];
//   C) itens recorrentes: data_inicio <= fim E (recorrencia_data_fim
//      IS NULL OU recorrencia_data_fim >= início).
// agenda_ocorrencias: TODAS as exceções dos itens carregados, sem
// filtrar por data — necessário porque data_override pode mover uma
// exceção para dentro/fora da janela (uma exceção cuja data_ocorrencia
// original está fora da janela mas data_override cai dentro dela não
// pode ser perdida).
//
// `continuar` (opcional): função chamada entre as duas fases; se devolver
// false (ex.: a tela já foi desmontada), a segunda consulta não é feita e o
// resultado vem com { cancelado: true }.
//
// Retorno: { itens, excecoes, erro, cancelado }.
export async function buscarItensDaAgenda(supabase, janela, { continuar } = {}) {
  const [eventosAvulsos, tarefasAvulsas, recorrentes] = await Promise.all([
    supabase
      .from('agenda_itens')
      .select(SELECT_ITENS_AGENDA)
      .eq('tipo', 'evento')
      .eq('tipo_recorrencia', 'nenhuma')
      .lte('data_inicio', janela.fim)
      .or(`data_fim.gte.${janela.inicio},and(data_fim.is.null,data_inicio.gte.${janela.inicio})`),
    supabase
      .from('agenda_itens')
      .select(SELECT_ITENS_AGENDA)
      .eq('tipo', 'tarefa')
      .eq('tipo_recorrencia', 'nenhuma')
      .gte('data_inicio', janela.inicio)
      .lte('data_inicio', janela.fim),
    supabase
      .from('agenda_itens')
      .select(SELECT_ITENS_AGENDA)
      .neq('tipo_recorrencia', 'nenhuma')
      .lte('data_inicio', janela.fim)
      .or(`recorrencia_data_fim.is.null,recorrencia_data_fim.gte.${janela.inicio}`),
  ]);

  if (continuar && !continuar()) {
    return { itens: [], excecoes: [], erro: null, cancelado: true };
  }

  const primeiroErro = eventosAvulsos.error || tarefasAvulsas.error || recorrentes.error;
  if (primeiroErro) {
    console.error('Erro ao carregar itens da Agenda:', primeiroErro);
    return { itens: [], excecoes: [], erro: primeiroErro, cancelado: false };
  }

  const itens = [...(eventosAvulsos.data || []), ...(tarefasAvulsas.data || []), ...(recorrentes.data || [])];

  const ids = itens.map((it) => it.id);
  const excecoesResp = ids.length
    ? await supabase.from('agenda_ocorrencias').select('*').in('agenda_item_id', ids)
    : { data: [], error: null };

  if (continuar && !continuar()) {
    return { itens: [], excecoes: [], erro: null, cancelado: true };
  }

  if (excecoesResp.error) {
    console.error('Erro ao carregar exceções da Agenda:', excecoesResp.error);
    return { itens: [], excecoes: [], erro: excecoesResp.error, cancelado: false };
  }

  return { itens, excecoes: excecoesResp.data || [], erro: null, cancelado: false };
}

// Fonte de verdade dos aniversários continua sendo funcionarios.data_nascimento
// -- nada é gravado em agenda_itens. Busca só id/nome/data_nascimento (nunca
// CPF/telefone/endereço) de funcionários ATIVOS; um funcionário inativado
// some daqui na consulta seguinte, sem nenhuma limpeza manual. Só deve ser
// chamada por quem tem funcionarios.visualizar.
// Retorno: { data, error } (formato do Supabase).
export function buscarNascimentosParaAgenda(supabase) {
  return supabase
    .from('funcionarios')
    .select('id, nome, data_nascimento')
    .eq('ativo', true)
    .not('data_nascimento', 'is', null);
}
