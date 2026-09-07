// Janela (em dias) usada para "recebidos recentemente" -- compartilhada
// entre pages/pedidos/resumo.js (contagem/card) e pages/pedidos.js (filtro
// ?filtro=recebidos_recentemente vindo do card, mesma janela), para nunca
// existir uma segunda definição divergente do mesmo conceito.
export const JANELA_RECEBIDOS_DIAS = 7;
