// Cálculo de aniversário de Funcionários, derivado sempre de
// funcionarios.data_nascimento -- NUNCA persistido em nenhum lugar (nem
// idade, nem "próxima ocorrência"). Usado por
// components/dashboard/AniversariantesFuncionarios.js e preparado para
// uso futuro em Agenda (ver relatório da Fase 1 -- fundação pronta, ainda
// não conectada visualmente ao calendário para preservar a Agenda
// existente intacta nesta rodada).
//
// Toda aritmética é feita sobre strings YYYY-MM-DD puras (nunca sobre
// Date do fuso do dispositivo) -- mesmo princípio de lib/data/dataLocal.js.
import { dataLocalHoje } from '../data/dataLocal';

function diaValidoNoAno(ano, mes, dia) {
  // 29/02 em ano não-bissexto cai em 28/02 -- mesma convenção adotada
  // pela maioria dos sistemas de RH/calendário.
  if (mes === 2 && dia === 29) {
    const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
    return bissexto ? 29 : 28;
  }
  return dia;
}

function montarData(ano, mes, dia) {
  const diaAjustado = diaValidoNoAno(ano, mes, dia);
  return `${ano}-${String(mes).padStart(2, '0')}-${String(diaAjustado).padStart(2, '0')}`;
}

// Próxima ocorrência (YYYY-MM-DD) do aniversário a partir de hojeISO --
// se já passou este ano, calcula para o ano seguinte. Se cair hoje,
// retorna hoje (>=, não >).
export function proximoAniversario(dataNascimentoISO, hojeISO = dataLocalHoje()) {
  const [, mesStr, diaStr] = dataNascimentoISO.split('-');
  const mes = Number(mesStr);
  const dia = Number(diaStr);
  const anoHoje = Number(hojeISO.split('-')[0]);

  const esteAno = montarData(anoHoje, mes, dia);
  return esteAno >= hojeISO ? esteAno : montarData(anoHoje + 1, mes, dia);
}

export function diasAteAniversario(dataNascimentoISO, hojeISO = dataLocalHoje()) {
  const proxima = proximoAniversario(dataNascimentoISO, hojeISO);
  const msPorDia = 24 * 60 * 60 * 1000;
  const diff = new Date(`${proxima}T12:00:00`) - new Date(`${hojeISO}T12:00:00`);
  return Math.round(diff / msPorDia);
}

// Idade atual (anos completos) -- só para exibição, nunca armazenada.
export function calcularIdade(dataNascimentoISO, hojeISO = dataLocalHoje()) {
  const [anoNasc, mesNasc, diaNasc] = dataNascimentoISO.split('-').map(Number);
  const [anoHoje, mesHoje, diaHoje] = hojeISO.split('-').map(Number);
  let idade = anoHoje - anoNasc;
  if (mesHoje < mesNasc || (mesHoje === mesNasc && diaHoje < diaNasc)) {
    idade -= 1;
  }
  return idade;
}

// Idade que a pessoa fará no próximo aniversário calculado acima.
export function idadeNoProximoAniversario(dataNascimentoISO, hojeISO = dataLocalHoje()) {
  const anoNasc = Number(dataNascimentoISO.split('-')[0]);
  const anoProximo = Number(proximoAniversario(dataNascimentoISO, hojeISO).split('-')[0]);
  return anoProximo - anoNasc;
}

// Lista de funcionários ativos com aniversário dentro dos próximos N
// dias (padrão 30), ordenada por proximidade. Recebe a lista já
// carregada do banco (id, nome, data_nascimento) -- esta função não faz
// nenhuma consulta, só a projeção/ordenação, para poder ser testada e
// reaproveitada (Dashboard hoje, Agenda no futuro) sem duplicar a
// query em cada lugar que a usa.
export function proximosAniversariantes(funcionarios, { dentroDeDias = 30, hojeISO = dataLocalHoje() } = {}) {
  return funcionarios
    .filter((f) => f.data_nascimento)
    .map((f) => ({
      ...f,
      proximaData: proximoAniversario(f.data_nascimento, hojeISO),
      diasRestantes: diasAteAniversario(f.data_nascimento, hojeISO),
      idadeNoAniversario: idadeNoProximoAniversario(f.data_nascimento, hojeISO),
    }))
    .filter((f) => f.diasRestantes <= dentroDeDias)
    .sort((a, b) => a.diasRestantes - b.diasRestantes);
}

// Integração com a Agenda (pages/agenda.js) -- monta um item no MESMO
// formato de public.agenda_itens (tipo/categoria/tipo_recorrencia/etc.),
// só em memória, para ser expandido pela função JÁ existente
// lib/agenda/expandirRecorrencia.js (tipo_recorrencia:'anual' já cobre
// exatamente "todo dia X de mês Y, todo ano" -- reaproveitada 1:1, sem
// nenhuma lógica de recorrência nova). NUNCA persistido em
// agenda_itens -- gerado a cada carregamento da tela a partir da lista
// de funcionários ATIVOS com data_nascimento (já filtrada por quem
// chama, ver pages/agenda.js), então um funcionário inativado some daqui
// automaticamente na consulta seguinte, sem nenhuma limpeza manual.
// `id` sintético (nunca colide com uuid real de agenda_itens) garante
// que exceções de outras séries (agenda_ocorrencias, indexadas por
// agenda_item_id real) nunca são aplicadas por engano a um aniversário.
export function itemAgendaAniversario(funcionario) {
  return {
    id: `aniversario-funcionario-${funcionario.id}`,
    tipo: 'aniversario',
    titulo: `🎂 Aniversário — ${funcionario.nome}`,
    descricao: null,
    categoria: 'ANIVERSARIO',
    data_inicio: funcionario.data_nascimento,
    data_fim: null,
    hora_inicio: null,
    hora_fim: null,
    dia_inteiro: true,
    tipo_recorrencia: 'anual',
    recorrencia_intervalo: 1,
    recorrencia_dias_semana: null,
    recorrencia_data_fim: null,
    concluido_em: null,
    concluido_por: null,
    observacao_conclusao: null,
    funcionarioId: funcionario.id,
    funcionarioNome: funcionario.nome,
  };
}
