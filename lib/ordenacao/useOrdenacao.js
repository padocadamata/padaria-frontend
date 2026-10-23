import { useCallback } from 'react';
import { aplicarOrdenacao, proximaOrdenacao } from './tabela';
import { useFiltrosPersistidos } from '../filtros/useFiltrosPersistidos';
import { ordenacaoValida } from '../filtros/persistenciaFiltros';

// Estado de ordenação de uma tabela. Começa em null (= a ordem padrão que a
// tela já tinha) e só muda quando o usuário clica num cabeçalho ordenável.
// Nunca usa banco.
//
// `inicial` (opcional): só para telas que JÁ abriam com uma coluna ordenada
// e indicada no cabeçalho antes desta frente (ex.: Catálogo, Produto A → Z) --
// preserva exatamente o comportamento de abertura delas.
//
// `aoMudar` (opcional): chamado a cada mudança -- as telas paginadas usam
// para voltar à página 1.
//
// `persistirEm` (opcional): identificador da tabela (ex.: 'catalogo'). Só
// com ele a escolha é guardada durante a sessão de login (mesma
// infraestrutura dos filtros, lib/filtros); sem ele o estado é local como
// sempre foi -- recarregar a tela volta à ordem padrão.
//
// Uso:
//   const ord = useOrdenacao({ aoMudar: () => setPagina(1) });
//   const ordenadas = ord.ordenar(filtradas, colunas);   // antes de paginarLista
//   <DataTable ... ordenacao={ord.props} />
const VERSAO_ORDENACAO = 1;

export function useOrdenacao({ aoMudar, inicial = null, persistirEm = null } = {}) {
  const estado = useFiltrosPersistidos(persistirEm ? `ordenacao:${persistirEm}` : null, {
    versao: VERSAO_ORDENACAO,
    padrao: { ordenacao: inicial },
    validadores: { ordenacao: ordenacaoValida },
  });
  const ordenacao = estado.valores.ordenacao;
  const { definir } = estado;

  const onOrdenar = useCallback(
    (chave) => {
      definir('ordenacao', (atual) => proximaOrdenacao(atual, chave));
      if (aoMudar) aoMudar();
    },
    [aoMudar, definir]
  );

  const ordenar = useCallback((linhas, colunas) => aplicarOrdenacao(linhas, colunas, ordenacao), [ordenacao]);

  return {
    ordenacao,
    ordenar,
    props: { chave: ordenacao?.chave ?? null, direcao: ordenacao?.direcao ?? null, onOrdenar },
  };
}
