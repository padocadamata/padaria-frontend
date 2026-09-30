// Regras de programação de Tarefas (migration 0061) em linguagem humana.
//
// Funções PURAS (sem React/Supabase) -- testadas em
// lib/tarefas/__tests__/regras.test.mjs. O banco guarda a regra
// estruturada (tipo + dias_semana ISO 1=seg..7=dom + semanas_do_mes); a
// interface nunca mostra "deslocamento" nem "k módulo 3": isso é detalhe
// interno do motor, escolhido pelo próprio banco.

export const TIPOS_REGRA = {
  DIARIA: 'diaria',
  DIAS_SEMANA: 'dias_semana',
  SEMANAS_DO_MES: 'semanas_do_mes',
  SEM_PROGRAMACAO: 'sem_programacao',
};

export const DIAS_SEMANA = [
  { valor: 1, curto: 'Seg', abrev: 'SEG', longo: 'segunda' },
  { valor: 2, curto: 'Ter', abrev: 'TER', longo: 'terça' },
  { valor: 3, curto: 'Qua', abrev: 'QUA', longo: 'quarta' },
  { valor: 4, curto: 'Qui', abrev: 'QUI', longo: 'quinta' },
  { valor: 5, curto: 'Sex', abrev: 'SEX', longo: 'sexta' },
  { valor: 6, curto: 'Sáb', abrev: 'SÁB', longo: 'sábado' },
  { valor: 7, curto: 'Dom', abrev: 'DOM', longo: 'domingo' },
];

export const SEMANAS_DO_MES = [1, 2, 3, 4, 5];

const DIA_POR_VALOR = new Map(DIAS_SEMANA.map((d) => [d.valor, d]));

function ordenados(lista) {
  return [...new Set((lista || []).map(Number))].filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
}

// ['Seg', 'Qua', 'Sex'] -> 'Seg, Qua e Sex'
export function juntarLista(itens) {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

function ordinal(n) {
  return `${n}ª`;
}

// Texto completo da regra, para cadastro/tooltip.
export function descreverRegra(regra) {
  if (!regra || regra.tipo === TIPOS_REGRA.SEM_PROGRAMACAO) return 'Sem programação automática';
  if (regra.tipo === TIPOS_REGRA.DIARIA) return 'Diária';

  const dias = ordenados(regra.dias_semana);
  if (regra.tipo === TIPOS_REGRA.DIAS_SEMANA) {
    if (dias.length === 7) return 'Todos os dias';
    if (dias.length === 2 && dias[0] === 6 && dias[1] === 7) return 'Sábado e domingo';
    if (dias.length === 1) return `Semanal — ${DIA_POR_VALOR.get(dias[0])?.longo ?? '?'}`;
    return `${dias.length}x por semana — ${juntarLista(dias.map((d) => DIA_POR_VALOR.get(d)?.curto ?? '?'))}`;
  }

  if (regra.tipo === TIPOS_REGRA.SEMANAS_DO_MES) {
    const semanas = ordenados(regra.semanas_do_mes);
    const nomeDias = juntarLista(dias.map((d) => DIA_POR_VALOR.get(d)?.longo ?? '?'));
    const texto = `${juntarLista(semanas.map(ordinal))} ${nomeDias} do mês`;
    if (dias.length === 1 && semanas.length === 2 && semanas[0] === 2 && semanas[1] === 4) {
      return `Quinzenal — ${texto}`;
    }
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  return 'Regra desconhecida';
}

// Rótulo curto para a coluna "Freq." da matriz (mesma ideia da planilha).
export function frequenciaCurta(regra) {
  if (!regra || regra.tipo === TIPOS_REGRA.SEM_PROGRAMACAO) return '—';
  if (regra.tipo === TIPOS_REGRA.DIARIA) return 'Diária';
  const dias = ordenados(regra.dias_semana);
  if (regra.tipo === TIPOS_REGRA.DIAS_SEMANA) {
    if (dias.length === 7) return 'Diária';
    if (dias.length === 2 && dias[0] === 6 && dias[1] === 7) return 'Sáb/Dom';
    return `${dias.length}x/sem`;
  }
  const semanas = ordenados(regra.semanas_do_mes);
  if (dias.length === 1 && semanas.length === 2 && semanas[0] === 2 && semanas[1] === 4) return 'Quinzenal';
  return `${semanas.length * dias.length}x/mês`;
}

// Frequência média em ocorrências por semana -- base da ordenação visual:
// menos frequente -> ... -> diária -> SEM PROGRAMAÇÃO (decisão de produto:
// tarefas sem programação automática ficam depois de todas as programadas,
// inclusive das diárias). Semanas do mês: 12 meses / 52 semanas.
export const PESO_SEM_PROGRAMACAO = 1000;

export function pesoFrequencia(regra) {
  if (!regra || regra.tipo === TIPOS_REGRA.SEM_PROGRAMACAO) return PESO_SEM_PROGRAMACAO;
  if (regra.tipo === TIPOS_REGRA.DIARIA) return 7;
  const dias = ordenados(regra.dias_semana).length;
  if (regra.tipo === TIPOS_REGRA.DIAS_SEMANA) return dias;
  return (dias * ordenados(regra.semanas_do_mes).length * 12) / 52;
}

// Comparador estável: frequência crescente; empate pela ordem cadastrada
// e depois pela descrição. Recebe { tarefa, regra }.
export function compararPorFrequencia(a, b) {
  return pesoFrequencia(a.regra) - pesoFrequencia(b.regra)
    || (a.tarefa.ordem ?? 0) - (b.tarefa.ordem ?? 0)
    || a.tarefa.descricao.localeCompare(b.tarefa.descricao, 'pt-BR');
}

// Estado do formulário <-> regra do banco. O formulário usa modos
// humanos: diária, dias da semana (1x/2x/3x... derivado da quantidade
// marcada), semanas do mês (quinzenal = 2ª e 4ª) e sem programação.
export function regraParaFormulario(regra) {
  return {
    tipo: regra?.tipo ?? TIPOS_REGRA.DIAS_SEMANA,
    dias: ordenados(regra?.dias_semana),
    semanas: ordenados(regra?.semanas_do_mes),
  };
}

export function formularioParaRegra(form) {
  const tipo = form.tipo;
  if (tipo === TIPOS_REGRA.DIARIA || tipo === TIPOS_REGRA.SEM_PROGRAMACAO) {
    return { tipo, dias_semana: null, semanas_do_mes: null };
  }
  if (tipo === TIPOS_REGRA.DIAS_SEMANA) {
    return { tipo, dias_semana: ordenados(form.dias), semanas_do_mes: null };
  }
  return { tipo, dias_semana: ordenados(form.dias), semanas_do_mes: ordenados(form.semanas) };
}

// Mensagem de erro de validação (ou null quando válido).
export function validarFormularioRegra(form) {
  if (!Object.values(TIPOS_REGRA).includes(form.tipo)) return 'Escolha a frequência.';
  if (form.tipo === TIPOS_REGRA.DIAS_SEMANA && ordenados(form.dias).length === 0) {
    return 'Marque ao menos um dia da semana.';
  }
  if (form.tipo === TIPOS_REGRA.SEMANAS_DO_MES) {
    if (ordenados(form.dias).length === 0) return 'Escolha o dia da semana.';
    if (ordenados(form.semanas).length === 0) return 'Marque ao menos uma semana do mês.';
  }
  return null;
}

// A regra do formulário é igual à regra vigente (tipo, dias, semanas e
// grupo)? Usado para decidir se o salvar pede "a partir de quando".
export function mesmaProgramacao(regraA, regraB) {
  if (!regraA || !regraB) return false;
  const a = formularioParaRegra(regraParaFormulario(regraA));
  const b = formularioParaRegra(regraParaFormulario(regraB));
  return (
    a.tipo === b.tipo
    && JSON.stringify(a.dias_semana) === JSON.stringify(b.dias_semana)
    && JSON.stringify(a.semanas_do_mes) === JSON.stringify(b.semanas_do_mes)
    && (regraA.grupo_id ?? null) === (regraB.grupo_id ?? null)
  );
}

// Regra vigente numa data: a de maior vigente_desde <= data.
export function regraVigente(regras, dataISO) {
  let melhor = null;
  for (const r of regras || []) {
    if (r.vigente_desde <= dataISO && (!melhor || r.vigente_desde > melhor.vigente_desde)) melhor = r;
  }
  return melhor;
}

// Próxima versão agendada (vigente_desde > data), se houver.
export function proximaVersao(regras, dataISO) {
  let proxima = null;
  for (const r of regras || []) {
    if (r.vigente_desde > dataISO && (!proxima || r.vigente_desde < proxima.vigente_desde)) proxima = r;
  }
  return proxima;
}

// Data em que a programação de referência de uma tarefa é lida: hoje, ou --
// se a tarefa ainda não começou (toda versão é futura, ex.: carga que vale
// a partir do 1º mês programado) -- a data da primeira versão. Sem isso a
// edição não enxerga regra nenhuma e trata uma simples correção de nome
// como mudança de programação.
export function dataReferenciaRegra(regras, hoje) {
  if (regraVigente(regras, hoje)) return hoje;
  return proximaVersao(regras, hoje)?.vigente_desde ?? hoje;
}

export function regraReferencia(regras, hoje) {
  return regraVigente(regras, dataReferenciaRegra(regras, hoje));
}

// Primeira data aceita pelo banco para uma nova versão (mudança de
// programação, inativação, reativação): >= hoje e >= a última versão já
// gravada (salvar_tarefa/inativar_tarefa recusam versão anterior a uma
// agendada).
export function primeiraDataAlteracao(regras, hoje) {
  let data = hoje;
  for (const r of regras || []) if (r.vigente_desde > data) data = r.vigente_desde;
  return data;
}
