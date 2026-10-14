// Paginação VISUAL de uma lista que já está inteira em memória (telas cujo
// conjunto completo precisa existir para outros cálculos/edições). Fatia a
// lista e já devolve a página "efetiva": se a lista encolher e a página
// pedida deixar de existir (filtro, exclusão, recarga), cai na última
// página válida -- a tela nunca renderiza uma página vazia.
export const TAMANHO_PAGINA_PADRAO = 20;

export function paginarLista(lista, pagina, tamanho = TAMANHO_PAGINA_PADRAO) {
  const total = lista.length;
  const totalPaginas = Math.max(1, Math.ceil(total / tamanho));
  const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
  const inicio = (paginaAtual - 1) * tamanho;
  return {
    itens: lista.slice(inicio, inicio + tamanho),
    paginaAtual,
    totalPaginas,
    total,
    primeiro: total === 0 ? 0 : inicio + 1,
    ultimo: Math.min(inicio + tamanho, total),
  };
}
