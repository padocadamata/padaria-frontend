import { createClient } from '../supabase/client';
import { registrarAuditoria } from '../audit/registrarAuditoria';

// Modelo GLOBAL da mensagem de pedido (public.pedidos_mensagem_config,
// migration 0075 -- linha única). Leitura: quem vê Pedidos. Escrita: só
// proprietario_admin, garantida pela RLS (is_admin()) -- esconder o botão é
// só UX.

// { template, atualizadoEm, atualizadoPorNome, disponivel }. disponivel =
// false quando a tabela não existe/não pode ser lida (0075 não aplicada).
export async function carregarTemplateMensagem() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('pedidos_mensagem_config')
    .select('template, atualizado_em, atualizado_por_nome')
    .maybeSingle();
  if (error || !data) {
    if (error) console.error('Modelo de mensagem indisponível:', error);
    return { template: null, atualizadoEm: null, atualizadoPorNome: null, disponivel: false };
  }
  return { template: data.template, atualizadoEm: data.atualizado_em, atualizadoPorNome: data.atualizado_por_nome, disponivel: true };
}

// Atualiza o texto da linha única. A RLS recusa quem não é proprietario_admin
// (nenhuma linha é alterada) -- tratado como erro aqui.
export async function salvarTemplateMensagem(templateNovo, templateAnterior) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('pedidos_mensagem_config')
    .update({ template: templateNovo })
    .eq('id', true)
    .select('template, atualizado_em, atualizado_por_nome');
  if (error) {
    console.error('Erro ao salvar o modelo de mensagem:', error);
    return { erro: 'Não foi possível salvar o modelo. Tente novamente.' };
  }
  if (!data || data.length === 0) {
    return { erro: 'Você não tem permissão para alterar o modelo de mensagem.' };
  }
  registrarAuditoria({
    entidade: 'pedidos_mensagem_config',
    registroId: 'template',
    acao: 'editou',
    campo: 'template',
    valorAnterior: templateAnterior,
    valorNovo: templateNovo,
  }).catch(() => {});
  return { erro: '', registro: data[0] };
}
