// Seleção múltipla + ações em lote de Pedidos > Solicitações (concluir /
// excluir várias). Funções PURAS -- testáveis sem React/Supabase.
//
// Nenhuma regra de negócio nova: o lote chama, item a item, EXATAMENTE as
// mesmas RPCs da ação individual (marcar_solicitacao_realizada /
// excluir_solicitacao_pendente, migration 0043), que continuam validando
// permissão e status no servidor. Cada item é atômico por si; o lote NÃO é
// (não existe RPC de lote) -- por isso o resultado é sempre apurado item a
// item e informado com clareza (sucesso total, parcial ou falha), nunca
// presumido.

// Uma solicitação só é selecionável quando ao menos uma ação em lote se
// aplica a ela -- mesmas condições que exibem os botões individuais em
// SolicitacoesLista.js (pendente && permissão). Realizadas nunca entram:
// nenhuma das duas ações individuais existe para elas.
export function podeSelecionarSolicitacao(solicitacao, { podeRealizar, podeExcluir }) {
  return solicitacao.status === 'pendente' && (podeRealizar || podeExcluir);
}

export function idsSelecionaveis(solicitacoesVisiveis, permissoes) {
  return solicitacoesVisiveis.filter((s) => podeSelecionarSolicitacao(s, permissoes)).map((s) => s.id);
}

// Estado do "selecionar todos" sobre os itens VISÍVEIS e selecionáveis
// (nunca itens fora do filtro atual).
export function estadoSelecaoTodos(idsVisiveisSelecionaveis, selecionados) {
  if (idsVisiveisSelecionaveis.length === 0) return 'nenhum';
  const marcados = idsVisiveisSelecionaveis.filter((id) => selecionados.has(id)).length;
  if (marcados === 0) return 'nenhum';
  return marcados === idsVisiveisSelecionaveis.length ? 'todos' : 'parcial';
}

// Cabeçalho: se TODOS os visíveis já estão marcados, desmarca todos; senão
// (nenhum ou parcial), marca todos os visíveis. Sempre devolve um Set novo.
export function alternarTodos(idsVisiveisSelecionaveis, selecionados) {
  if (estadoSelecaoTodos(idsVisiveisSelecionaveis, selecionados) === 'todos') return new Set();
  return new Set(idsVisiveisSelecionaveis);
}

export function alternarUm(id, selecionados) {
  const novo = new Set(selecionados);
  if (novo.has(id)) novo.delete(id);
  else novo.add(id);
  return novo;
}

// Remove da seleção o que deixou de estar visível/selecionável (excluído,
// concluído, fora do filtro) -- nunca fica seleção "invisível".
export function podarSelecao(selecionados, idsVisiveisSelecionaveis) {
  const visiveis = new Set(idsVisiveisSelecionaveis);
  const novo = new Set();
  for (const id of selecionados) if (visiveis.has(id)) novo.add(id);
  return novo;
}

// Traduz a mensagem de erro da RPC (textos de 0043) para um motivo curto em
// português. Desconhecido -> genérico (o erro técnico vai para o console).
export function motivoFalha(error) {
  const msg = (error?.message || '').toLowerCase();
  if (msg.includes('requer a permissao')) return 'sem permissão para esta ação';
  if (msg.includes('nao encontrada')) return 'não encontrada (pode ter sido excluída por outra pessoa)';
  if (msg.includes('ja esta realizada')) return 'já estava realizada';
  if (msg.includes('somente solicitacoes pendentes')) return 'não está mais pendente ou já tem pedido vinculado';
  return 'erro inesperado ao processar';
}

// Executa `acao(id)` (que devolve `{ error }`, como supabase.rpc) para cada
// id, em SEQUÊNCIA -- ordem previsível, sem rajada de chamadas, e um item
// que falha nunca interrompe os demais. Exceção lançada conta como falha
// daquele item. `aoProgredir(feitos, total)` é opcional (UI).
export async function executarEmLote(ids, acao, aoProgredir) {
  const sucesso = [];
  const falhas = [];
  let feitos = 0;
  for (const id of ids) {
    let error = null;
    try {
      const resp = await acao(id);
      error = resp?.error || null;
    } catch (e) {
      error = e;
    }
    if (error) falhas.push({ id, motivo: motivoFalha(error), error });
    else sucesso.push(id);
    feitos += 1;
    if (aoProgredir) aoProgredir(feitos, ids.length);
  }
  return { sucesso, falhas };
}

const TEXTOS = {
  concluir: { verbo: 'concluída', verboPlural: 'concluídas', naoPude: 'não pôde ser concluída', naoPuderam: 'não puderam ser concluídas' },
  excluir: { verbo: 'excluída', verboPlural: 'excluídas', naoPude: 'não pôde ser excluída', naoPuderam: 'não puderam ser excluídas' },
};

function plural(n, singular, pluralTxt) {
  return n === 1 ? singular : pluralTxt;
}

// Resumo para a UI: tom do alerta, frase principal e a lista de falhas com
// a descrição de cada solicitação (para a pessoa saber QUAIS ficaram).
export function resumirResultadoLote({ sucesso, falhas }, tipo, descricaoPorId = {}) {
  const t = TEXTOS[tipo];
  const total = sucesso.length + falhas.length;
  const detalhes = falhas.map((f) => `${descricaoPorId[f.id] || 'Solicitação'}: ${f.motivo}`);

  if (falhas.length === 0) {
    return {
      tom: 'success',
      titulo: `${sucesso.length} ${plural(sucesso.length, 'solicitação', 'solicitações')} ${plural(sucesso.length, t.verbo, t.verboPlural)}.`,
      detalhes,
    };
  }
  if (sucesso.length === 0) {
    return {
      tom: 'danger',
      titulo: `Nenhuma solicitação foi ${t.verbo}. ${falhas.length} ${plural(falhas.length, t.naoPude, t.naoPuderam)}.`,
      detalhes,
    };
  }
  return {
    tom: 'warning',
    titulo: `${sucesso.length} de ${total} ${plural(total, 'solicitação', 'solicitações')} ${plural(sucesso.length, t.verbo, t.verboPlural)}. ${falhas.length} ${plural(falhas.length, t.naoPude, t.naoPuderam)}.`,
    detalhes,
  };
}
