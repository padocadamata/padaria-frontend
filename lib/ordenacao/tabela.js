import { ordenarLinhas } from './comparadores';

// Ordenação de tabelas (DataTable): regras PURAS, sem React.
//
// Uma coluna é ordenável quando declara `ordenavel`:
//   ordenavel: true                       -> texto, valor = linha[chave]
//   ordenavel: { tipo, valor(linha), ordem }
//     tipo  = 'texto' | 'numero' | 'moeda' | 'data' | 'booleano'
//     valor = de onde ler o valor COMPARADO (pode diferir do que é exibido)
//     ordem = lista de valores em ordem semântica (status etc.)
//   ordenavel: { campoConsulta }          -> paginação NO BANCO: a tela
//     ordena a consulta por esse campo; o DataTable só desenha o estado.
//
// Estado da ordenação: null (ordem padrão da tela, a de antes desta frente)
// ou { chave, direcao: 'asc' | 'desc' }. Estado da tela, de quem está
// olhando -- só é guardado (durante a sessão de login) quando a tela pede,
// via useOrdenacao({ persistirEm }).

export function definicaoOrdenacao(coluna) {
  if (!coluna?.ordenavel) return null;
  const def = coluna.ordenavel === true ? {} : coluna.ordenavel;
  return {
    tipo: def.tipo || 'texto',
    ordem: def.ordem,
    valor: def.valor || ((linha) => linha[coluna.chave]),
    campoConsulta: def.campoConsulta,
  };
}

// Clique no cabeçalho: coluna nova começa crescente; a mesma coluna alterna
// crescente <-> decrescente (sem terceiro estado).
export function proximaOrdenacao(atual, chave) {
  if (atual && atual.chave === chave) {
    return { chave, direcao: atual.direcao === 'asc' ? 'desc' : 'asc' };
  }
  return { chave, direcao: 'asc' };
}

// Aplica a ordenação escolhida às linhas (já filtradas, ANTES de paginar).
// Sem ordenação (ou coluna desconhecida/não ordenável), devolve as linhas
// como vieram -- a ordem padrão da tela.
export function aplicarOrdenacao(linhas, colunas, ordenacao) {
  if (!ordenacao) return linhas;
  const coluna = colunas.find((c) => c.chave === ordenacao.chave);
  const def = definicaoOrdenacao(coluna);
  if (!def || def.campoConsulta) return linhas;
  return ordenarLinhas(linhas, { valor: def.valor, tipo: def.tipo, ordem: def.ordem, direcao: ordenacao.direcao });
}
