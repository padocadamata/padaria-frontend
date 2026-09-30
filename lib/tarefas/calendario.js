// Montagem da matriz mensal, filtros e resumo do dia de Tarefas (0061).
//
// Funções PURAS -- testadas em lib/tarefas/__tests__/calendario.test.mjs.
// Trabalham SOMENTE sobre ocorrências já materializadas (a fotografia do
// banco): nada aqui calcula posição, recorrência ou rotação -- isso é do
// motor SQL (public.tarefas_posicao_calculada). Filtros são visuais:
// nunca alteram dado.

import { compararPorFrequencia, regraVigente } from './regras.js';

export const SITUACOES = {
  TODAS: 'todas',
  PENDENTES: 'pendentes',
  CONCLUIDAS: 'concluidas',
};

export const FILTROS_PADRAO = { responsavel: '', situacao: SITUACOES.TODAS, categoria: '' };

const ABREV_DIA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

// Datas de calendário sempre com meio-dia local (nunca meia-noite UTC).
function paraData(dataISO) {
  return new Date(`${dataISO}T12:00:00`);
}

export function diasDoMes(mesISO) {
  const [ano, mes] = mesISO.split('-').map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, '0');
  return Array.from({ length: ultimo }, (_, i) => `${ano}-${mm}-${String(i + 1).padStart(2, '0')}`);
}

export function inicioDoMes(dataISO) {
  return `${dataISO.slice(0, 7)}-01`;
}

export function somarMeses(mesISO, delta) {
  const [ano, mes] = mesISO.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function abrevDiaSemana(dataISO) {
  return ABREV_DIA[paraData(dataISO).getDay()];
}

export function ehFimDeSemana(dataISO) {
  const d = paraData(dataISO).getDay();
  return d === 0 || d === 6;
}

// dd/mm
export function dataCurta(dataISO) {
  const [, m, d] = dataISO.split('-');
  return `${d}/${m}`;
}

// "Quarta-feira, 07/10"
export function dataExtensa(dataISO) {
  const texto = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(paraData(dataISO));
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}, ${dataCurta(dataISO)}`;
}

// ---------------------------------------------------------------------------
// Responsável
// ---------------------------------------------------------------------------

// Nome exibido: avulso > nome materializado da posição > F1/F2/F3.
export function rotuloResponsavel(ocorrencia) {
  return ocorrencia.responsavel_avulso || ocorrencia.responsavel_nome || `F${ocorrencia.posicao}`;
}

// Versão curta para a célula da matriz (primeiro nome).
export function rotuloCelula(ocorrencia) {
  const rotulo = rotuloResponsavel(ocorrencia);
  return /^F[123]$/.test(rotulo) ? rotulo : rotulo.split(' ')[0];
}

function normalizarNome(nome) {
  return nome.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

// Nome vigente de uma posição numa data, a partir das vigências de
// tarefas_posicoes_nomes (só para OFERECER opções na tela -- o que vale
// para a ocorrência é o nome já materializado nela).
export function nomeVigente(nomes, posicao, dataISO) {
  let melhor = null;
  for (const n of nomes || []) {
    if (n.posicao === posicao && n.vigente_desde <= dataISO && (!melhor || n.vigente_desde > melhor.vigente_desde)) melhor = n;
  }
  return melhor?.nome ?? null;
}

export function ehAjustada(ocorrencia) {
  return Boolean(ocorrencia.ajustado_em);
}

// Opções do filtro "Responsável": F1/F2/F3 + todos os nomes (materializados
// ou avulsos) que aparecem nas ocorrências carregadas, sem duplicar
// maiúsculas/minúsculas.
export function opcoesResponsavel(ocorrencias) {
  const nomes = new Map();
  for (const o of ocorrencias) {
    for (const [nome, avulso] of [[o.responsavel_nome, false], [o.responsavel_avulso, true]]) {
      if (!nome) continue;
      const chave = normalizarNome(nome);
      const atual = nomes.get(chave);
      if (!atual) nomes.set(chave, { nome: nome.trim(), avulso });
      else if (!avulso) atual.avulso = false;
    }
  }
  const lista = [...nomes.entries()]
    .sort((a, b) => a[1].nome.localeCompare(b[1].nome, 'pt-BR'))
    .map(([chave, info]) => ({ valor: `nome:${chave}`, rotulo: info.avulso ? `${info.nome} (avulso)` : info.nome }));
  return [
    { valor: 'posicao:1', rotulo: 'F1' },
    { valor: 'posicao:2', rotulo: 'F2' },
    { valor: 'posicao:3', rotulo: 'F3' },
    ...lista,
  ];
}

// "posicao:N" = posição EFETIVA N (todas as ocorrências dessa posição,
// com ou sem nome). "nome:x" = somente ocorrências cujo responsável
// EXIBIDO é x (o nome materializado naquela data ou o avulso).
export function correspondeResponsavel(ocorrencia, filtro) {
  if (!filtro) return true;
  if (filtro.startsWith('posicao:')) return ocorrencia.posicao === Number(filtro.slice(8));
  if (filtro.startsWith('nome:')) return normalizarNome(rotuloResponsavel(ocorrencia)) === filtro.slice(5);
  return true;
}

export function correspondeSituacao(ocorrencia, situacao) {
  if (!situacao || situacao === SITUACOES.TODAS) return true;
  if (situacao === SITUACOES.CONCLUIDAS) return ocorrencia.concluida;
  if (situacao === SITUACOES.PENDENTES) return !ocorrencia.concluida && !ocorrencia.cancelada;
  return true;
}

export function ocorrenciaVisivel(ocorrencia, filtros) {
  return correspondeResponsavel(ocorrencia, filtros.responsavel) && correspondeSituacao(ocorrencia, filtros.situacao);
}

export function contarFiltrosAtivos(filtros) {
  return [filtros.responsavel, filtros.situacao !== SITUACOES.TODAS, filtros.categoria].filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Matriz
// ---------------------------------------------------------------------------

// Seções (categorias) -> linhas (tarefas) -> ocorrência por data.
// Linhas exibidas: tarefas ativas OU com ocorrência no mês (uma tarefa
// inativada continua visível nos meses em que teve ocorrência). Com filtro
// de responsável/situação ativo, linhas sem nenhuma ocorrência visível
// saem da matriz. Ordem dentro da categoria: MENOS frequente primeiro,
// diárias por último (compararPorFrequencia). Grupos de distribuição são
// detalhe interno do motor e não entram na matriz.
export function montarMatriz({ categorias, tarefas, regrasPorTarefa, ocorrencias, filtros = FILTROS_PADRAO, dataReferencia }) {
  const porTarefa = new Map();
  for (const o of ocorrencias) {
    if (!porTarefa.has(o.tarefa_id)) porTarefa.set(o.tarefa_id, new Map());
    porTarefa.get(o.tarefa_id).set(o.data, o);
  }
  const filtrando = Boolean(filtros.responsavel) || (filtros.situacao && filtros.situacao !== SITUACOES.TODAS);

  const secoes = [];
  for (const categoria of [...categorias].sort((a, b) => a.ordem - b.ordem)) {
    if (filtros.categoria && filtros.categoria !== categoria.valor) continue;
    const linhas = [];
    const candidatas = tarefas
      .filter((t) => t.categoria === categoria.valor)
      .map((tarefa) => ({ tarefa, regra: regraVigente(regrasPorTarefa?.get(tarefa.id), dataReferencia) }))
      .sort(compararPorFrequencia);
    for (const { tarefa, regra } of candidatas) {
      const doMes = porTarefa.get(tarefa.id) || new Map();
      if (!tarefa.ativo && doMes.size === 0) continue;
      const visiveis = new Map();
      for (const [data, o] of doMes) {
        if (ocorrenciaVisivel(o, filtros)) visiveis.set(data, o);
      }
      if (filtrando && visiveis.size === 0) continue;
      linhas.push({ tarefa, regra, ocorrencias: visiveis, todasOcorrencias: doMes });
    }
    if (linhas.length > 0) secoes.push({ categoria, linhas });
  }
  return secoes;
}

// ---------------------------------------------------------------------------
// Execuções reais (migration 0062) -- até 2 por ocorrência, nome livre.
// Status: 0 execuções = Pendente; >= 1 = Concluída. O nome da execução é
// QUEM REALIZOU; responsavel_nome/F1-F3 da ocorrência é a PROGRAMAÇÃO.
// ---------------------------------------------------------------------------

export const MAX_EXECUCOES = 2;
export const MAX_NOME_EXECUCAO = 60;

// Marcador SISTÊMICO das conclusões legadas (antes da 0062 não se
// registrava quem executou). Nunca usado para execuções novas.
export const NOME_EXECUCAO_LEGADO = 'NÃO INFORMADO';

// Nome de execução nova/renomeada: obrigatório (mesma regra do banco --
// trim, espaços internos colapsados, 1..60). Devolve mensagem ou null.
export function validarNomeExecucao(nome) {
  const limpo = String(nome ?? '').trim().replace(/\s+/g, ' ');
  if (!limpo) return 'Informe o nome de quem executou.';
  if (limpo.length > MAX_NOME_EXECUCAO) return `O nome pode ter no máximo ${MAX_NOME_EXECUCAO} caracteres.`;
  return null;
}

export function agruparExecucoes(execucoes) {
  const mapa = new Map();
  for (const e of execucoes) {
    if (!mapa.has(e.ocorrencia_id)) mapa.set(e.ocorrencia_id, []);
    mapa.get(e.ocorrencia_id).push(e);
  }
  for (const lista of mapa.values()) {
    lista.sort((a, b) => String(a.concluido_em).localeCompare(String(b.concluido_em)) || a.ordem - b.ordem);
  }
  return mapa;
}

export function nomeExecucao(execucao) {
  return execucao.responsavel_nome || 'nome não informado';
}

// "Concluída — Laura e Sabrina" / "Concluída" / "Pendente" / "Cancelada — motivo"
export function descreverSituacao(ocorrencia, execucoes = []) {
  if (ocorrencia.cancelada) return `Cancelada — ${ocorrencia.cancelado_motivo}`;
  if (!ocorrencia.concluida && execucoes.length === 0) return 'Pendente';
  const nomes = execucoes.map((e) => e.responsavel_nome).filter(Boolean);
  if (nomes.length === 0) return 'Concluída';
  return `Concluída — ${nomes.length === 2 ? `${nomes[0]} e ${nomes[1]}` : nomes[0]}`;
}

// Progresso de um dia a partir das ocorrências (canceladas não contam).
export function progresso(ocorrencias) {
  const validas = ocorrencias.filter((o) => !o.cancelada);
  const concluidas = validas.filter((o) => o.concluida).length;
  return { total: validas.length, concluidas, canceladas: ocorrencias.length - validas.length };
}

// Resumo do dia agrupado por responsável exibido (F1 -> F2 -> F3; nomes
// seguem a posição efetiva). Dentro do grupo, ordem de categoria/tarefa.
export function resumoDoDia({ ocorrencias, data, tarefasPorId, categorias }) {
  const ordemCategoria = new Map((categorias || []).map((c) => [c.valor, c.ordem]));
  const doDia = ocorrencias.filter((o) => o.data === data);
  const grupos = new Map();
  for (const o of doDia) {
    const rotulo = rotuloResponsavel(o);
    const chave = `${o.posicao}|${normalizarNome(rotulo)}`;
    if (!grupos.has(chave)) grupos.set(chave, { chave, rotulo, posicao: o.posicao, itens: [] });
    grupos.get(chave).itens.push(o);
  }
  const ordenarItens = (a, b) => {
    const ta = tarefasPorId.get(a.tarefa_id);
    const tb = tarefasPorId.get(b.tarefa_id);
    return (ordemCategoria.get(ta?.categoria) ?? 99) - (ordemCategoria.get(tb?.categoria) ?? 99)
      || (ta?.ordem ?? 0) - (tb?.ordem ?? 0);
  };
  const lista = [...grupos.values()]
    .map((g) => ({ ...g, itens: g.itens.sort(ordenarItens), progresso: progresso(g.itens) }))
    .sort((a, b) => a.posicao - b.posicao || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  return { data, grupos: lista, progresso: progresso(doDia) };
}

// Frase da prévia de programação/sincronização (resultado jsonb das RPCs).
export function descreverSincronizacao(resultado) {
  if (!resultado) return [];
  const linhas = [];
  const n = (k) => Number(resultado[k] || 0);
  const plural = (q, s, p) => `${q} ${q === 1 ? s : p}`;
  linhas.push(`${plural(n('criadas'), 'ocorrência será criada', 'ocorrências serão criadas')}`);
  if (n('removidas')) linhas.push(`${plural(n('removidas'), 'ocorrência futura ainda não tocada será removida', 'ocorrências futuras ainda não tocadas serão removidas')}`);
  if (n('nomes_atualizados')) linhas.push(`${plural(n('nomes_atualizados'), 'ocorrência futura terá o nome atualizado', 'ocorrências futuras terão o nome atualizado')}`);
  if (n('preservadas')) linhas.push(`${plural(n('preservadas'), 'ocorrência concluída, ajustada, cancelada ou avulsa será preservada', 'ocorrências concluídas, ajustadas, canceladas ou avulsas serão preservadas')}`);
  return linhas;
}
