// Regras do seletor "Produtos de interesse" (Clientes) -- autocomplete no
// mesmo espírito do "Produto do Catálogo" de Pedidos: campo vazio não busca
// nem mostra lista; a lista só aparece para um termo digitado; escolher um
// produto limpa o termo e fecha a lista. Funções puras (sem React/Supabase)
// para serem testáveis; o componente só as aplica.

export function termoDeBusca(texto) {
  return String(texto ?? '').trim();
}

// Busca SÓ quando há termo -- campo vazio nunca chama a RPC.
export async function buscarSeHouverTermo(texto, buscar, limite) {
  const termo = termoDeBusca(texto);
  if (!termo) return { buscou: false, termo: '', produtos: [], erro: '' };
  const { produtos, erro } = await buscar(termo, limite);
  return { buscou: true, termo, produtos: produtos || [], erro: erro || '' };
}

// O que mostrar abaixo do campo.
//   tipo: 'oculto'   -> campo vazio: nada (nem lista, nem mensagem)
//         'buscando' -> termo digitado, resposta ainda não chegou
//         'erro'     -> falha técnica (mensagem do erro, nunca "nenhum")
//         'vazio'    -> busca concluída sem resultado: "Nenhum produto encontrado."
//         'lista'    -> resultados
//   avisoLimite: só com termo digitado E resultado no teto (refinar busca).
export function estadoListaResultados({ termo, termoBuscado, buscando, erro, resultados, limite }) {
  const t = termoDeBusca(termo);
  if (!t) return { tipo: 'oculto', avisoLimite: false };
  if (buscando || termoDeBusca(termoBuscado) !== t) return { tipo: 'buscando', avisoLimite: false };
  if (erro) return { tipo: 'erro', avisoLimite: false };
  if (!resultados || resultados.length === 0) return { tipo: 'vazio', avisoLimite: false };
  return { tipo: 'lista', avisoLimite: resultados.length >= limite };
}

// Resultados com a marca de já adicionado (botão "Adicionado", desabilitado).
export function marcarJaAdicionados(resultados, selecionados) {
  const ids = new Set((selecionados || []).map((p) => p.produto_id));
  return (resultados || []).map((p) => ({ ...p, adicionado: ids.has(p.id) }));
}

// Inclui o produto escolhido nos selecionados, sem duplicar, em ordem de nome.
export function adicionarProduto(selecionados, produto) {
  if ((selecionados || []).some((p) => p.produto_id === produto.id)) return selecionados;
  return [...(selecionados || []), { produto_id: produto.id, nome: produto.nome, ativo: true, disponivel: true }].sort((a, b) =>
    a.nome.localeCompare(b.nome, 'pt-BR')
  );
}

export function removerProduto(selecionados, produtoId) {
  return (selecionados || []).filter((p) => p.produto_id !== produtoId);
}
