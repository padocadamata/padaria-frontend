import { createClient } from '../supabase/client';

/**
 * Fundação reutilizável de auditoria (Prompt 04, seção 11).
 * Nenhum módulo de negócio chama isto ainda — Produção/Fluxo de
 * Mercadorias/Estoque não existem nesta etapa. Está pronta para os
 * próximos `services` chamarem, ex.:
 *
 *   await registrarAuditoria({
 *     entidade: 'fornecedor',
 *     registroId: fornecedor.id,
 *     acao: 'editou',
 *     campo: 'telefone',
 *     valorAnterior: '11 1111-1111',
 *     valorNovo: '11 2222-2222',
 *   });
 *
 * Grava em nome do usuário autenticado atual (RLS em logs_auditoria só
 * permite usuario_id = auth.uid()). Se ninguém estiver logado, não grava
 * nada e retorna { sucesso: false } em vez de lançar exceção — auditoria
 * não deve derrubar a operação de negócio que a chamou.
 */
export async function registrarAuditoria({ entidade, registroId, acao, campo = null, valorAnterior = null, valorNovo = null }) {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { sucesso: false, erro: 'Nenhum usuário autenticado.' };
  }

  const { error } = await supabase.from('logs_auditoria').insert({
    usuario_id: user.id,
    usuario_nome: user.user_metadata?.nome ?? null,
    usuario_email: user.email ?? null,
    entidade,
    registro_id: String(registroId),
    acao,
    campo,
    valor_anterior: valorAnterior != null ? String(valorAnterior) : null,
    valor_novo: valorNovo != null ? String(valorNovo) : null,
  });

  if (error) {
    return { sucesso: false, erro: error.message };
  }

  return { sucesso: true };
}
