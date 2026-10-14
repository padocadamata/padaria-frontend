import { compararTexto } from './comparadores';

// Opções NOMINAIS de filtros/selects (produtos, fornecedores, funcionários,
// categorias, cargos...): sempre em ordem alfabética pt-BR, decidida no
// frontend -- nunca dependente da collation do banco.
//
// Só para listas nominais. Listas FUNCIONAIS (status, dias da semana,
// períodos, formas de pagamento, vínculo, frequência...) têm ordem
// semântica própria e NÃO passam por aqui. Opções especiais ("Todos",
// "Selecione"...) também não: ficam escritas antes, no JSX, no topo.
//
// `rotulo` = função que devolve o texto exibido (padrão: item.nome; se o
// item for string, a própria string). Ordena uma CÓPIA; empates (mesmo
// nome) mantêm a ordem recebida.
export function ordenarOpcoes(itens, rotulo = rotuloPadrao) {
  return (itens || [])
    .map((item, indice) => ({ item, indice, texto: rotulo(item) }))
    .sort((a, b) => compararTexto(a.texto, b.texto) || a.indice - b.indice)
    .map((x) => x.item);
}

function rotuloPadrao(item) {
  return typeof item === 'string' ? item : item?.nome;
}
