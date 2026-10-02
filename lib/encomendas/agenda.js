import { somarDias } from '../data/dataLocal';
import { formatarHora, resumoItens } from './regras';

// Encomendas na Agenda e no Dashboard (migration 0071) -- PROJEÇÃO, mesmo
// padrão dos aniversários (lib/funcionarios/aniversarios.js): monta itens
// no MESMO formato de public.agenda_itens, só em memória, a partir do que
// listar_encomendas devolveu. NUNCA gravado em agenda_itens: a encomenda é a
// única fonte de verdade, então não existe evento órfão, duplicado ou com
// data/hora diferente da encomenda -- mudou a encomenda, mudou a Agenda.
//
// Regras:
//   * Agenda: pendente e concluída aparecem na data/hora da retirada
//     (concluída riscada, como tarefa concluída); cancelada não aparece.
//   * Lembrete PADRÃO (regra do módulo, sem configuração): no DIA ANTERIOR
//     à retirada, toda encomenda PENDENTE aparece no card "Agenda de hoje"
//     do Dashboard. Concluída/cancelada não lembram; mudar a data move o
//     lembrete; encomenda para hoje não ganha lembrete retroativo (o dia
//     anterior já passou) -- ela aparece como compromisso de hoje.
//     A regra é por DIA (não por 24h): encomenda feita hoje para amanhã
//     já lembra hoje, mesmo faltando menos de 24h.

export const CATEGORIA_AGENDA_ENCOMENDA = 'ENCOMENDA';

function itemBase(encomenda) {
  return {
    descricao: resumoItens(encomenda.itens, 99),
    categoria: CATEGORIA_AGENDA_ENCOMENDA,
    data_fim: null,
    hora_fim: null,
    tipo_recorrencia: 'nenhuma',
    recorrencia_intervalo: null,
    recorrencia_dias_semana: null,
    recorrencia_data_fim: null,
    concluido_por: null,
    observacao_conclusao: null,
    encomenda,
  };
}

// Compromisso na data/hora da retirada (null para cancelada).
export function itemAgendaEncomenda(encomenda) {
  if (encomenda.status === 'cancelada') return null;
  return {
    ...itemBase(encomenda),
    id: `encomenda-${encomenda.id}`,
    tipo: 'encomenda',
    titulo: `Encomenda — ${encomenda.cliente_nome}`,
    data_inicio: encomenda.data_retirada,
    hora_inicio: encomenda.hora_retirada,
    dia_inteiro: false,
    // concluída aparece riscada (mesmo mecanismo de tarefa avulsa concluída)
    concluido_em: encomenda.status === 'concluida' ? encomenda.atualizado_em || encomenda.criado_em : null,
  };
}

export function dataLembreteEncomenda(encomenda) {
  return somarDias(encomenda.data_retirada, -1);
}

// Lembrete do dia anterior (null quando não se aplica).
export function itemAgendaLembreteEncomenda(encomenda) {
  if (encomenda.status !== 'pendente') return null;
  return {
    ...itemBase(encomenda),
    id: `lembrete-encomenda-${encomenda.id}`,
    tipo: 'lembrete_encomenda',
    titulo: `Amanhã: encomenda de ${encomenda.cliente_nome} às ${formatarHora(encomenda.hora_retirada)}`,
    data_inicio: dataLembreteEncomenda(encomenda),
    hora_inicio: null,
    dia_inteiro: true,
    concluido_em: null,
  };
}

// Itens para a grade da Agenda (só compromissos; o lembrete é do Dashboard).
export function itensAgendaEncomendas(encomendas) {
  return (encomendas || []).map(itemAgendaEncomenda).filter(Boolean);
}

// Itens para o card "Agenda de hoje": compromissos de HOJE + lembretes das
// pendentes com retirada AMANHÃ. `encomendas` = janela [hoje, amanhã].
export function itensDashboardEncomendas(encomendas, hoje) {
  const lista = encomendas || [];
  const compromissos = lista.filter((e) => e.data_retirada === hoje).map(itemAgendaEncomenda).filter(Boolean);
  const lembretes = lista
    .map(itemAgendaLembreteEncomenda)
    .filter((item) => item && item.data_inicio === hoje);
  return [...compromissos, ...lembretes];
}
