// Abertura direta de uma Solicitação via /pedidos/solicitacoes?id=<uuid>
// (link da Central de Notificações, migration 0080). Funções puras, sem
// React -- testadas em lib/pedidos/__tests__/solicitacaoDestaque.test.mjs.
//
// Regras:
//   * id inválido (não-UUID, vazio, repetido na URL) = ignorado.
//   * Solicitação encontrada e pendente: destacada na lista normal.
//   * Encontrada e REALIZADA com "Mostrar realizadas" desligado: aparece
//     mesmo assim (só ela), sem alterar o filtro salvo do usuário.
//   * Não encontrada (excluída, ou id de outro ambiente): aviso informativo,
//     nunca erro.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function idDestaqueDaQuery(valor) {
  if (typeof valor !== 'string') return null;
  const id = valor.trim();
  return UUID.test(id) ? id.toLowerCase() : null;
}

// 'nenhum' | 'carregando' | 'encontrada' | 'nao_encontrada'
export function estadoDoDestaque(idDestaque, solicitacoes, carregando) {
  if (!idDestaque) return 'nenhum';
  if (carregando) return 'carregando';
  return solicitacoes.some((s) => s.id === idDestaque) ? 'encontrada' : 'nao_encontrada';
}

// Lista exibida: o filtro normal (pendentes, ou todas com "Mostrar
// realizadas") + a solicitação destacada, mesmo que esteja realizada.
export function solicitacoesExibidas(solicitacoes, mostrarRealizadas, idDestaque) {
  return solicitacoes.filter((s) => mostrarRealizadas || s.status === 'pendente' || (idDestaque && s.id === idDestaque));
}

// A solicitação destacada só aparece por causa do link (o filtro a esconderia).
export function destaqueForaDoFiltro(solicitacoes, mostrarRealizadas, idDestaque) {
  if (!idDestaque || mostrarRealizadas) return false;
  const alvo = solicitacoes.find((s) => s.id === idDestaque);
  return !!alvo && alvo.status !== 'pendente';
}

// Id DOM estável da linha/cartão (âncora para rolar até ela).
export function idDomDaSolicitacao(id) {
  return `solicitacao-${id}`;
}
