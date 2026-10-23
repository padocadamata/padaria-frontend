import { ordenarOpcoes } from '../ordenacao/opcoes';

// Tela Hoje: uma LINHA OPERACIONAL por Produto × Turno, e os filtros locais
// (Tipo de produto, Situação, Turno) sobre essas linhas. Funções PURAS --
// testadas em lib/producao/__tests__/linhasHoje.test.mjs. Nenhuma regra de
// produção aqui: só organização e filtragem do que a tela já carregou.

// Situações REAIS de um turno: sem registro, ou o status de
// producao_registros ('aberto' | 'fechado' | 'reaberto'). Ordem operacional
// (não alfabética), com os mesmos rótulos usados nos cartões.
export const SITUACOES_TURNO = [
  { valor: 'sem_producao', rotulo: 'Sem produção' },
  { valor: 'aberto', rotulo: 'Em produção' },
  { valor: 'fechado', rotulo: 'Fechado' },
  { valor: 'reaberto', rotulo: 'Em correção' },
];

// '' = "Todos" em cada filtro. Padrão da tela; a escolha do usuário fica
// guardada durante a sessão de login (lib/filtros/telas.js,
// FILTROS_PRODUCAO_HOJE).
export const FILTROS_HOJE_PADRAO = { tipo: '', situacao: '', turno: '' };

export function situacaoDoTurno(registro) {
  return registro ? registro.status : 'sem_producao';
}

// Linhas na ordem da tela: produtos na ordem recebida (Francês primeiro,
// depois os com registro hoje, depois os adicionados -- regra de quem monta
// `blocos`) e, dentro de cada produto, os turnos na ordem de `turnos`
// (Manhã, Tarde).
export function montarLinhasHoje({ blocos, turnos, registroDoBloco, tipoPorReceita = {} }) {
  const linhas = [];
  for (const bloco of blocos) {
    for (const t of turnos) {
      const registro = registroDoBloco(bloco.receitaId, t.chave) || null;
      linhas.push({
        chave: `${bloco.receitaId}:${t.chave}`,
        receitaId: bloco.receitaId,
        receitaNome: bloco.receitaNome,
        tipo: tipoPorReceita[bloco.receitaId] || null,
        turno: t.chave,
        turnoLabel: t.label,
        registro,
        situacao: situacaoDoTurno(registro),
      });
    }
  }
  return marcarPrimeirasDoProduto(linhas);
}

// A primeira linha VISÍVEL de cada produto mostra o nome; as seguintes ficam
// subordinadas a ela. Recalculado depois de filtrar (ex.: Turno = Tarde faz
// a linha da Tarde ser a primeira).
function marcarPrimeirasDoProduto(linhas) {
  return linhas.map((linha, i) => ({ ...linha, primeiraDoProduto: i === 0 || linhas[i - 1].receitaId !== linha.receitaId }));
}

// Filtros combinados (E lógico); '' em um filtro = não restringe por ele.
export function filtrarLinhasHoje(linhas, { tipo = '', situacao = '', turno = '' } = {}) {
  return marcarPrimeirasDoProduto(
    linhas.filter(
      (l) => (!tipo || l.tipo === tipo) && (!situacao || l.situacao === situacao) && (!turno || l.turno === turno)
    )
  );
}

export function contarFiltrosHojeAtivos(filtros) {
  return ['tipo', 'situacao', 'turno'].filter((c) => filtros[c]).length;
}

// Tipos de produto REAIS presentes nas linhas (receitas.tipo), em ordem
// alfabética pt-BR (lista nominal); produtos sem tipo não geram opção.
export function tiposDasLinhas(linhas) {
  return ordenarOpcoes(Array.from(new Set(linhas.map((l) => l.tipo).filter(Boolean))));
}
