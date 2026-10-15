import { indiceNaSemanaOperacional } from './escala';

// Apresentação COMPACTA da Escala (celular e tablet pequeno) -- só funções
// puras de organização da tela; dados, filtros, handlers e regras são os
// mesmos das grades do desktop.

// Até esta largura (px) as visões Semanal, Mensal e Cobertura usam a
// apresentação compacta -- o mesmo limite em que a Semanal já trocava a
// tabela por cartões (DataTable cartoesAte={900}).
export const ESCALA_COMPACTA_ATE = 900;
export const MQ_ESCALA_COMPACTA = `(max-width: ${ESCALA_COMPACTA_ATE}px)`;

// Dia exibido no seletor de dia: mantém a escolha atual se ela ainda faz
// parte da lista (ex.: trocou o filtro); senão hoje, se estiver na lista
// (semana/período corrente); senão o primeiro dia. Derivado a cada render,
// sem efeito -- trocar de semana nunca deixa um dia "fantasma" selecionado.
export function diaSelecionadoNaLista(dias, hoje, escolhido) {
  if (!dias || dias.length === 0) return '';
  if (escolhido && dias.includes(escolhido)) return escolhido;
  if (dias.includes(hoje)) return hoje;
  return dias[0];
}

// Mês em semanas operacionais (segunda a domingo) para o calendário do
// celular: cada semana tem 7 posições; posições fora do mês ficam null.
export function semanasDoCalendario(dias) {
  const semanas = [];
  let atual = null;
  for (const data of dias || []) {
    const posicao = indiceNaSemanaOperacional(data);
    if (!atual || posicao === 0) {
      atual = Array(7).fill(null);
      semanas.push(atual);
    }
    atual[posicao] = data;
  }
  return semanas;
}

// Quantos filtros da Escala estão ativos (cargo, funcionária) -- só filtros,
// nunca ações; mostrado no botão "Filtros e ações" da Semanal no celular.
export function contarFiltrosEscalaAtivos(filtro) {
  return (filtro?.cargoId ? 1 : 0) + (filtro?.funcionarioId ? 1 : 0);
}
