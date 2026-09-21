import { expandirRecorrencia } from './expandirRecorrencia';
import { itemAgendaAniversario } from '../funcionarios/aniversarios';

// Resumo do DIA para o card "Agenda de hoje" do Dashboard. Funções puras,
// sem nenhuma consulta: recebem o que lib/agenda/consultasAgenda.js já
// buscou e reaproveitam a MESMA expansão de recorrência e a MESMA síntese
// de aniversário da página /agenda -- nenhuma regra de data nova aqui.

export const MAX_ITENS_AGENDA_DE_HOJE = 3;

// Todas as ocorrências reais de um dia (YYYY-MM-DD): eventos/tarefas
// avulsos (inclusive multi-dia que cobrem o dia), séries recorrentes com
// exceções aplicadas (cancelada some; data_override move para dentro/fora
// do dia) e aniversários de funcionários sintetizados em memória.
// `funcionariosNascimento` deve vir vazio para quem não tem
// funcionarios.visualizar (mesmo gate da Agenda).
export function ocorrenciasDoDia({ itens, excecoes, funcionariosNascimento, dia }) {
  const aniversarios = (funcionariosNascimento || []).map(itemAgendaAniversario);
  return expandirRecorrencia({
    itens: [...(itens || []), ...aniversarios],
    excecoes: excecoes || [],
    inicioJanela: dia,
    fimJanela: dia,
  }).filter((oc) => !oc.cancelada);
}

// Ordem (previsível):
//   0) aniversários (aviso de dia inteiro, sem horário);
//   1) itens COM horário ainda não concluídos, em ordem cronológica;
//   2) demais itens do dia (dia inteiro / sem horário) ainda não concluídos;
//   3) tarefas já concluídas, por último (o resumo do card as descarta antes de
//      ordenar; o grupo só existe para esta função continuar total e previsível).
// Dentro do grupo: horário (grupos 1 e 3), depois título (pt-BR), depois id
// da ocorrência -- desempate final estável.
function grupoDe(oc) {
  if (oc.item.tipo === 'aniversario') return 0;
  if (oc.concluida) return 3;
  if (!oc.diaInteiro && oc.horaInicio) return 1;
  return 2;
}

function tituloOrdenacao(oc) {
  return oc.item.tipo === 'aniversario' ? oc.item.funcionarioNome || '' : oc.titulo || '';
}

export function ordenarOcorrenciasDoDia(ocorrencias) {
  return [...ocorrencias].sort((a, b) => {
    const ga = grupoDe(a);
    const gb = grupoDe(b);
    if (ga !== gb) return ga - gb;

    if (ga === 1 || ga === 3) {
      const ha = (!a.diaInteiro && a.horaInicio) || '99:99:99';
      const hb = (!b.diaInteiro && b.horaInicio) || '99:99:99';
      if (ha !== hb) return ha < hb ? -1 : 1;
      const fa = a.horaFim || '';
      const fb = b.horaFim || '';
      if (fa !== fb) return fa < fb ? -1 : 1;
    }

    const porTitulo = tituloOrdenacao(a).localeCompare(tituloOrdenacao(b), 'pt-BR', { sensitivity: 'base' });
    if (porTitulo !== 0) return porTitulo;
    return a.idOcorrencia < b.idOcorrencia ? -1 : a.idOcorrencia > b.idOcorrencia ? 1 : 0;
  });
}

// Resumo exibido no card: no máximo `max` itens já ordenados + quantas
// ocorrências ficaram de fora (para "+ N outros eventos hoje").
//
// Tarefas JÁ CONCLUÍDAS não entram no resumo: o Dashboard mostra só o que
// ainda merece atenção hoje. É apenas um filtro de APRESENTAÇÃO deste
// resumo -- a tarefa continua existindo, concluída, e aparece normalmente em
// /agenda (nada é excluído nem alterado; a Agenda não usa esta função).
// Total e "restantes" são calculados DEPOIS do filtro; se só sobrarem
// concluídas, o total é 0 e o card mostra o estado vazio.
export function resumirAgendaDoDia(ocorrencias, max = MAX_ITENS_AGENDA_DE_HOJE) {
  const ordenadas = ordenarOcorrenciasDoDia(ocorrencias.filter((oc) => !oc.concluida));
  const itens = ordenadas.slice(0, max).map((oc) => ({
    id: oc.idOcorrencia,
    tipo: oc.item.tipo, // 'aniversario' | 'evento' | 'tarefa'
    titulo: oc.item.tipo === 'aniversario' ? `Aniversário — ${oc.item.funcionarioNome}` : oc.titulo,
    hora: !oc.diaInteiro && oc.horaInicio ? oc.horaInicio.slice(0, 5) : null,
  }));
  return { itens, total: ordenadas.length, restantes: Math.max(0, ordenadas.length - itens.length) };
}
