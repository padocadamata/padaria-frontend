import { useCallback, useState } from 'react';
import { aplicarOrdenacao, proximaOrdenacao } from './tabela';

// Estado LOCAL de ordenação de uma tabela. Começa em null (= a ordem padrão
// que a tela já tinha) e só muda quando o usuário clica num cabeçalho
// ordenável. Não usa banco nem localStorage: recarregar a tela volta à
// ordem padrão, e a escolha de um usuário nunca chega a outro.
//
// `inicial` (opcional): só para telas que JÁ abriam com uma coluna ordenada
// e indicada no cabeçalho antes desta frente (ex.: Catálogo, Produto A → Z) --
// preserva exatamente o comportamento de abertura delas.
//
// `aoMudar` (opcional): chamado a cada mudança -- as telas paginadas usam
// para voltar à página 1.
//
// Uso:
//   const ord = useOrdenacao({ aoMudar: () => setPagina(1) });
//   const ordenadas = ord.ordenar(filtradas, colunas);   // antes de paginarLista
//   <DataTable ... ordenacao={ord.props} />
export function useOrdenacao({ aoMudar, inicial = null } = {}) {
  const [ordenacao, setOrdenacao] = useState(inicial);

  const onOrdenar = useCallback(
    (chave) => {
      setOrdenacao((atual) => proximaOrdenacao(atual, chave));
      if (aoMudar) aoMudar();
    },
    [aoMudar]
  );

  const ordenar = useCallback((linhas, colunas) => aplicarOrdenacao(linhas, colunas, ordenacao), [ordenacao]);

  return {
    ordenacao,
    ordenar,
    props: { chave: ordenacao?.chave ?? null, direcao: ordenacao?.direcao ?? null, onOrdenar },
  };
}
