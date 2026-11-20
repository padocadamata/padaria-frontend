// Acesso da Central de Notificações ao banco (migration 0080). Só RPCs
// SECURITY INVOKER: o que volta já passou pela RLS do usuário logado
// (perfil + permissão efetiva + ativo + autor excluído). Nenhuma escrita
// fora de "marcar como lida".

export const TAMANHO_PAGINA = 20;
export const TAMANHO_PAINEL = 8;

function falhou(error, contexto) {
  const erro = new Error(`${contexto}: ${error?.message || 'erro desconhecido'}`);
  erro.causa = error;
  return erro;
}

export async function contarNaoLidas(supabase) {
  const { data, error } = await supabase.rpc('notificacoes_contar_nao_lidas');
  if (error) throw falhou(error, 'contar notificações');
  return Number(data) || 0;
}

// cursor = última notificação da página anterior ({ criado_em, id }) ou null.
// leitura: 'todas' | 'nao_lidas' | 'lidas'.
export async function listarNotificacoes(
  supabase,
  { limite = TAMANHO_PAGINA, cursor = null, leitura = 'todas', somentePendenciasAbertas = false } = {}
) {
  const { data, error } = await supabase.rpc('notificacoes_listar', {
    p_limite: limite,
    p_antes_em: cursor?.criado_em ?? null,
    p_antes_id: cursor?.id ?? null,
    p_leitura: leitura,
    p_somente_pendencias_abertas: somentePendenciasAbertas,
  });
  if (error) throw falhou(error, 'listar notificações');
  return Array.isArray(data) ? data : [];
}

export async function marcarComoLidas(supabase, ids) {
  const lista = [...new Set((ids || []).filter(Boolean))];
  if (lista.length === 0) return 0;
  const { data, error } = await supabase.rpc('notificacoes_marcar_lidas', { p_ids: lista });
  if (error) throw falhou(error, 'marcar notificações como lidas');
  return Number(data) || 0;
}

export async function marcarTodasComoLidas(supabase) {
  const { data, error } = await supabase.rpc('notificacoes_marcar_todas_lidas');
  if (error) throw falhou(error, 'marcar todas as notificações como lidas');
  return Number(data) || 0;
}

// Atualização otimista local: marca as notificações como lidas na lista em
// memória (sem esperar o servidor) -- devolve a MESMA lista se nada mudou.
export function aplicarLeituraLocal(lista, ids, lidaEm = new Date().toISOString()) {
  const alvo = new Set(ids);
  let mudou = false;
  const nova = lista.map((n) => {
    if (!alvo.has(n.id) || n.lida_em) return n;
    mudou = true;
    return { ...n, lida_em: lidaEm };
  });
  return mudou ? nova : lista;
}
