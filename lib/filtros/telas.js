import { dataIso, dataIsoOuVazio, textoQualquer, umDe } from './persistenciaFiltros';
import { somarDias } from '../data/dataLocal';
import { OPCOES_VINCULO } from '../funcionarios/vinculo';
import { FORMAS_PAGAMENTO, GRUPOS_A_PAGAR } from '../financeiro/contasPagarRegras';
import { PERIODOS as PERIODOS_ENCOMENDAS } from '../encomendas/regras';
import { FILTROS_HOJE_PADRAO, SITUACOES_TURNO } from '../producao/linhasHoje';
import { TIPO_MOVIMENTO_LABEL } from '../producao/mensagensSacos';
import { FILTROS_PADRAO as FILTROS_PADRAO_TAREFAS, SITUACOES as SITUACOES_TAREFAS } from '../tarefas/calendario';

// Definições (schema + versão + padrão) das telas que persistem filtros
// durante a sessão de login -- etapa 1 (pilotos Catálogo, Escala e
// Pedidos) e etapa 2 (demais telas, em "Demais telas" abaixo).
// Só FILTROS/VISÃO entram aqui: página, modais, formulários, edição inline,
// seleção em lote, confirmações e mensagens nunca são persistidos.
// Mudou a estrutura de uma tela? Aumente a `versao` dela (invalida só ela).

// --- Catálogo -------------------------------------------------------------

export const FILTROS_CATALOGO = {
  versao: 1,
  padrao: { busca: '', status: 'ativos', secaoId: 'todas', categoriaId: 'todas' },
  validadores: {
    busca: textoQualquer,
    status: umDe(['ativos', 'inativos', 'todos']),
    secaoId: textoQualquer,
    categoriaId: textoQualquer,
  },
};

// Seção/Categoria salvas que deixaram de existir voltam a "todas" -- só
// depois que as classificações carregaram SEM erro.
export function regrasSaneamentoCatalogo({ classificacoesProntas, secoesPorId, categoriasPorId }) {
  return {
    secaoId: { pronto: classificacoesProntas, valido: (id) => secoesPorId.has(id) },
    categoriaId: { pronto: classificacoesProntas, valido: (id) => categoriasPorId.has(id) },
  };
}

// --- Escala ---------------------------------------------------------------

export const VISOES_ESCALA = ['semanal', 'mensal', 'cobertura'];

// Visão + filtro de análise Cargo/Funcionária (compartilhado pelas três
// visões, ver lib/funcionarios/escalaFiltro.js).
export const FILTROS_ESCALA = {
  versao: 1,
  padrao: { visao: 'semanal', cargoId: '', funcionarioId: '' },
  validadores: {
    visao: umDe(VISOES_ESCALA),
    cargoId: textoQualquer,
    funcionarioId: textoQualquer,
  },
};

// Cargo salvo que não existe mais (nenhuma funcionária ativa com ele) volta
// a "todos"; funcionária salva que não existe mais OU não pertence ao cargo
// (já saneado) volta a "todas". Só depois que as funcionárias carregaram
// sem erro; os demais filtros válidos são preservados.
export function regrasSaneamentoEscala({ funcionariosProntos, funcionarios, cargos }) {
  return {
    cargoId: { pronto: funcionariosProntos, valido: (id) => cargos.some((c) => c.id === id) },
    funcionarioId: {
      pronto: funcionariosProntos,
      valido: (id, valores) =>
        funcionarios.some((f) => f.id === id && (!valores.cargoId || f.cargo_id === valores.cargoId)),
    },
  };
}

// Períodos: o padrão é calculado UMA vez, ao abrir a visão sem nada salvo
// (semana/mês/período corrente) e então gravado -- a partir daí o período
// fica exatamente como o usuário deixou até um novo login, mesmo que vire
// o dia (decisão de negócio desta frente).
export function filtrosEscalaSemanal({ semanaAtual, inicioDaSemana }) {
  return {
    versao: 1,
    padrao: { semanaInicio: semanaAtual },
    validadores: { semanaInicio: (v) => dataIso(v) && inicioDaSemana(v) === v },
  };
}

export function filtrosEscalaMensal({ mesAtual }) {
  return {
    versao: 1,
    padrao: { mesInicio: mesAtual },
    validadores: { mesInicio: (v) => dataIso(v) && v.endsWith('-01') },
  };
}

export const MAX_DIAS_POR_HORA = 7;

function diasEntre(inicio, fim) {
  const [a1, m1, d1] = inicio.split('-').map(Number);
  const [a2, m2, d2] = fim.split('-').map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}

// Cobertura (Por Hora): período de até 7 dias + dia escolhido no celular.
// Intervalo salvo incoerente (fim antes do início, mais de 7 dias) volta
// inteiro ao padrão -- nunca uma metade do par.
export function filtrosEscalaPorHora({ semanaAtual }) {
  return {
    versao: 1,
    padrao: { dataInicio: semanaAtual, dataFim: somarDias(semanaAtual, MAX_DIAS_POR_HORA - 1), diaEscolhido: '' },
    validadores: { dataInicio: dataIso, dataFim: dataIso, diaEscolhido: dataIsoOuVazio },
    normalizar: (valores, padrao) => {
      const span = diasEntre(valores.dataInicio, valores.dataFim);
      if (span < 0 || span > MAX_DIAS_POR_HORA - 1) {
        return { ...valores, dataInicio: padrao.dataInicio, dataFim: padrao.dataFim };
      }
      return valores;
    },
  };
}

// --- Pedidos --------------------------------------------------------------

// Chave pública de ?filtro= (também usada pelos cards de
// pages/pedidos/resumo.js) <-> valor interno do Status. "todos" nunca vai
// para a URL: ausência de ?filtro= significa "todos".
export const FILTRO_URL_PARA_STATUS = {
  aguardando: 'aguardando_entrega',
  atrasados: 'atrasado',
  previstos_hoje: 'previsto_hoje',
  recebido: 'recebido',
  recebidos_recentemente: 'recebidos_recente',
  cancelado: 'cancelado',
};
export const FILTRO_STATUS_PARA_URL = {
  aguardando_entrega: 'aguardando',
  atrasado: 'atrasados',
  previsto_hoje: 'previstos_hoje',
  recebido: 'recebido',
  recebidos_recente: 'recebidos_recentemente',
  cancelado: 'cancelado',
};

export const STATUS_FILTRO_PEDIDOS = ['todos', ...Object.keys(FILTRO_STATUS_PARA_URL)];

export const FILTROS_PEDIDOS = {
  versao: 1,
  padrao: { status: 'todos', fornecedorId: 'todos', modalidade: 'todas', periodoInicio: '', periodoFim: '' },
  validadores: {
    status: umDe(STATUS_FILTRO_PEDIDOS),
    fornecedorId: textoQualquer,
    modalidade: umDe(['todas', 'pedido_com_entrega', 'compra_presencial']),
    periodoInicio: dataIsoOuVazio,
    periodoFim: dataIsoOuVazio,
  },
};

// Fornecedor salvo que não aparece mais em nenhum pedido volta a "todos" --
// só depois que os pedidos carregaram sem erro.
export function regrasSaneamentoPedidos({ pedidosProntos, fornecedorIds }) {
  return {
    fornecedorId: { pronto: pedidosProntos, valido: (id) => fornecedorIds.has(id) },
  };
}

// Status vindo de ?filtro=: o valor interno, ou null quando ausente/
// desconhecido (desconhecido = sem filtro explícito).
export function statusDaUrlPedidos(paramFiltro) {
  if (typeof paramFiltro !== 'string') return null;
  return FILTRO_URL_PARA_STATUS[paramFiltro] || null;
}

// Query de /pedidos para um Status, preservando os demais parâmetros
// (?id= de abertura de pedido continua lá -- e nunca vira filtro).
export function queryComStatusPedidos(query, status) {
  const nova = { ...query };
  const chaveUrl = FILTRO_STATUS_PARA_URL[status];
  if (chaveUrl) nova.filtro = chaveUrl;
  else delete nova.filtro;
  return nova;
}

// Sincronização URL <-> Status persistido (efeito de pages/pedidos.js):
//  - 1ª vez que a tela vê a URL pronta (entrada na tela):
//      ?filtro= válido   -> a URL vence e vira o estado salvo ('persistir');
//      sem ?filtro= (ou inválido) e Status salvo != todos -> 'restaurar'
//        (router.replace com o salvo -- sem nova parada no histórico);
//      senão -> 'persistir' todos.
//  - depois disso (escolha no select = router.push, voltar/avançar do
//    navegador, link interno): a URL é a verdade e só é persistida --
//    nunca reescrita, então voltar/avançar não entra em loop.
export function sincronizarStatusPedidos({ routerPronto, paramFiltro, statusSalvo, inicializado }) {
  if (!routerPronto) return { acao: 'aguardar' };
  const daUrl = statusDaUrlPedidos(paramFiltro);
  if (!inicializado && !daUrl && statusSalvo && statusSalvo !== 'todos') {
    return { acao: 'restaurar', status: statusSalvo };
  }
  return { acao: 'persistir', status: daUrl || 'todos' };
}

// Status exibido: o da URL; enquanto a entrada na tela ainda não
// sincronizou, o salvo (evita um quadro com "Todos" antes do replace).
export function statusExibidoPedidos({ routerPronto, paramFiltro, statusSalvo, inicializado }) {
  const daUrl = routerPronto ? statusDaUrlPedidos(paramFiltro) : null;
  if (daUrl) return daUrl;
  if (!inicializado) return statusSalvo || 'todos';
  return 'todos';
}

// ==========================================================================
// Demais telas (etapa 2)
// ==========================================================================

// Saneamento (regra da etapa 2): um valor salvo só volta ao padrão quando
// há evidência CONFIÁVEL de que a opção deixou de existir no cadastro/
// domínio completo daquele filtro (tabela de cadastro, lista completa de
// opções carregada sem erro). Opção que só não aparece no período/resultado
// carregado NÃO é saneada: o filtro continua selecionado e a lista pode
// ficar vazia (a tela mantém a opção visível no select).

// --- Datas com padrão dinâmico ---------------------------------------------
//
// Campo de data cujo padrão depende de HOJE (início do mês, hoje, domingo
// da semana...): guardado como null enquanto o usuário não escolher -- a
// tela resolve null para o padrão dinâmico DAQUELE momento (`?? hoje`),
// então nada congela porque virou o dia. Escolhida explicitamente, a data
// fica como o usuário deixou até um novo login. '' continua significando
// "campo apagado pelo usuário" (mesmo comportamento de antes).
export function dataOuAutomatica(valor) {
  return valor === null || dataIsoOuVazio(valor);
}

// Navegação por mês com botão "Hoje": voltar ao mês corrente (navegando ou
// pelo botão) grava null = segue o mês corrente dinâmico.
export function mesOuAutomatico(mes, mesCorrente) {
  return mes === mesCorrente ? null : mes;
}

function mesIsoOuAutomatico(valor) {
  return valor === null || (dataIso(valor) && valor.endsWith('-01'));
}

// --- Fornecedores ---------------------------------------------------------

export const FILTROS_FORNECEDORES = {
  versao: 1,
  padrao: { busca: '', status: 'ativos', modalidade: 'todas' },
  validadores: {
    busca: textoQualquer,
    status: umDe(['ativos', 'inativos', 'todos']),
    modalidade: umDe(['todas', 'pedido_com_entrega', 'compra_presencial']),
  },
};

// --- Clientes / Encomendas ------------------------------------------------

export const FILTROS_CLIENTES = {
  versao: 1,
  padrao: { busca: '', produto: '', status: 'ativos' },
  validadores: {
    busca: textoQualquer,
    produto: textoQualquer,
    status: umDe(['ativos', 'inativos', 'todos']),
  },
};

// Produto de interesse: SEM saneamento -- as opções vêm dos clientes
// carregados, não de um cadastro independente.

export const FILTROS_ENCOMENDAS = {
  versao: 1,
  padrao: { periodo: 'proximos', periodoInicio: null, periodoFim: null, busca: '', status: 'pendente', produto: '' },
  validadores: {
    periodo: umDe(Object.keys(PERIODOS_ENCOMENDAS)),
    periodoInicio: dataOuAutomatica,
    periodoFim: dataOuAutomatica,
    busca: textoQualquer,
    status: umDe(['pendente', 'concluida', 'cancelada', 'todos']),
    produto: textoQualquer,
  },
};

// Produto: SEM saneamento -- as opções vêm das encomendas do período.

// --- Funcionários (Cadastro) ----------------------------------------------

export const FILTROS_FUNCIONARIOS = {
  versao: 1,
  padrao: { busca: '', status: 'ativos', vinculo: '' },
  validadores: {
    busca: textoQualquer,
    status: umDe(['ativos', 'inativos', 'todos']),
    vinculo: umDe(['', ...OPCOES_VINCULO.map((o) => o.valor)]),
  },
};

// --- Folha > Pagamentos ---------------------------------------------------

export const FILTROS_PAGAMENTOS = {
  versao: 1,
  padrao: { visao: 'a_pagar' },
  validadores: { visao: umDe(['a_pagar', 'pagos', 'configuracoes']) },
};

// Competência do Mensal (A Pagar): null = mês corrente dinâmico.
export const FILTROS_PAGAMENTOS_A_PAGAR = {
  versao: 1,
  padrao: { competencia: null },
  validadores: { competencia: mesIsoOuAutomatico },
};

export const FILTROS_PAGAMENTOS_PAGOS = {
  versao: 1,
  padrao: { funcionarioId: '', status: '', tipoVinculo: '', natureza: '', dataInicio: '', dataFim: '' },
  validadores: {
    funcionarioId: textoQualquer,
    status: umDe(['', 'confirmado', 'cancelado']),
    tipoVinculo: umDe(['', ...OPCOES_VINCULO.map((o) => o.valor)]),
    natureza: umDe(['', 'por_hora', 'mensal', 'regularizacao_historica']),
    dataInicio: dataIsoOuVazio,
    dataFim: dataIsoOuVazio,
  },
};

export function regrasSaneamentoPagamentosPagos({ funcionariosProntos, funcionarios }) {
  return {
    funcionarioId: { pronto: funcionariosProntos, valido: (id) => funcionarios.some((f) => f.id === id) },
  };
}

// --- Folha > Tarefas ------------------------------------------------------

// Mês do calendário (null = mês corrente dinâmico) + dia exibido no
// celular (null = hoje, ou o 1º dia do mês quando hoje não é do mês) +
// filtros visuais.
export const FILTROS_TAREFAS = {
  versao: 1,
  padrao: { mes: null, diaMobile: null, ...FILTROS_PADRAO_TAREFAS },
  validadores: {
    mes: mesIsoOuAutomatico,
    diaMobile: (v) => v === null || dataIso(v),
    responsavel: textoQualquer,
    situacao: umDe(Object.values(SITUACOES_TAREFAS)),
    categoria: textoQualquer,
  },
};

// Dia exibido no celular: o salvo, se for do mês exibido; senão o padrão
// dinâmico (hoje, quando hoje é do mês; senão o dia 1 do mês).
export function diaMobileTarefas({ diaSalvo, mes, hoje }) {
  const prefixo = mes.slice(0, 7);
  if (diaSalvo && diaSalvo.startsWith(prefixo)) return diaSalvo;
  return hoje.startsWith(prefixo) ? hoje : mes;
}

// Só a Categoria é saneada (cadastro carregado sem erro). O Responsável
// não: as opções dependem das ocorrências do MÊS exibido.
export function regrasSaneamentoTarefas({ cadastroPronto, categorias }) {
  return {
    categoria: { pronto: cadastroPronto, valido: (valor) => categorias.some((c) => c.valor === valor) },
  };
}

export const FILTROS_TAREFAS_CADASTRO = {
  versao: 1,
  padrao: { mostrarInativas: false },
};

// --- Financeiro > Contas a Pagar ------------------------------------------

// Visão + filtros da barra (limpos ao trocar de visão, como antes) +
// período de Pagas (null = início do mês / hoje dinâmicos).
export const FILTROS_CONTAS_PAGAR = {
  versao: 1,
  padrao: {
    visao: 'a_pagar',
    credor: '',
    origem: '',
    forma: '',
    grupo: '',
    categoria: '',
    de: '',
    ate: '',
    pagoDe: null,
    pagoAte: null,
  },
  validadores: {
    visao: umDe(['a_pagar', 'pagas', 'sem_lancamento']),
    credor: textoQualquer,
    origem: umDe(['', 'compra', 'manual']),
    forma: umDe(['', ...FORMAS_PAGAMENTO.map((f) => f.valor)]),
    grupo: umDe(['', ...GRUPOS_A_PAGAR.map((g) => g.chave)]),
    categoria: textoQualquer,
    de: dataIsoOuVazio,
    ate: dataIsoOuVazio,
    pagoDe: dataOuAutomatica,
    pagoAte: dataOuAutomatica,
  },
};

// Só a Categoria (cadastro contas_pagar_categorias). O Credor NÃO: as
// opções vêm das linhas da visão/período carregados.
export function regrasSaneamentoContasPagar({ categoriasProntas, categorias }) {
  return {
    categoria: { pronto: categoriasProntas, valido: (id) => categorias.some((c) => c.id === id) },
  };
}

// --- Produção -------------------------------------------------------------

// Hoje: só os filtros -- a data da tela é SEMPRE o hoje automático.
export const FILTROS_PRODUCAO_HOJE = {
  versao: 1,
  padrao: { ...FILTROS_HOJE_PADRAO },
  validadores: {
    tipo: textoQualquer,
    situacao: umDe(['', ...SITUACOES_TURNO.map((s) => s.valor)]),
    turno: umDe(['', 'manha', 'tarde']),
  },
};

// Tipo: SEM saneamento -- as opções vêm só das linhas de hoje.

export const FILTROS_PRODUCAO_PRODUTOS = {
  versao: 1,
  padrao: { busca: '', status: 'ativos', telaHoje: 'todas', tipo: 'todos', grupo: 'todos' },
  validadores: {
    busca: textoQualquer,
    status: umDe(['ativos', 'inativos', 'todos']),
    telaHoje: umDe(['todas', 'na_tela_hoje', 'fora_tela_hoje']),
    tipo: textoQualquer,
    grupo: textoQualquer,
  },
};

// Tipo/Grupo contra o CADASTRO de classificações (producao_tipos /
// producao_grupos, ativas e inativas), nunca contra as receitas listadas.
export function regrasSaneamentoProducaoProdutos({ classificacoesProntas, tiposProducao, gruposProducao }) {
  return {
    tipo: { pronto: classificacoesProntas, valido: (tipo) => tiposProducao.some((t) => t.valor === tipo) },
    grupo: { pronto: classificacoesProntas, valido: (grupo) => gruposProducao.some((g) => g.valor === grupo) },
  };
}

// Planejamento: datas null = padrão dinâmico (hoje até o domingo).
export const FILTROS_PLANEJAMENTO = {
  versao: 1,
  padrao: { dataInicial: null, dataFinal: null, grupo: 'todos', produto: 'todos', turno: 'todos' },
  validadores: {
    dataInicial: dataOuAutomatica,
    dataFinal: dataOuAutomatica,
    grupo: textoQualquer,
    produto: textoQualquer,
    turno: umDe(['todos', 'manha', 'tarde']),
  },
};

// Produto: contra a lista COMPLETA de produtos controlados ativos (o
// domínio inteiro do select, independente do período). Grupo: SEM
// saneamento -- as opções são só os grupos desses produtos.
export function regrasSaneamentoPlanejamento({ produtosProntos, produtos }) {
  return {
    produto: { pronto: produtosProntos, valido: (id) => produtos.some((p) => p.id === id) },
  };
}

export const FILTROS_HISTORICO = {
  versao: 1,
  padrao: { periodoInicio: '', periodoFim: '', produto: 'todos', turno: 'todos', status: 'todos', diaSemana: 'todos' },
  validadores: {
    periodoInicio: dataIsoOuVazio,
    periodoFim: dataIsoOuVazio,
    produto: textoQualquer,
    turno: umDe(['todos', 'manha', 'tarde']),
    status: umDe(['todos', 'aberto', 'fechado', 'reaberto']),
    diaSemana: umDe(['todos', '0', '1', '2', '3', '4', '5', '6']),
  },
};

export function regrasSaneamentoHistorico({ baseCarregada, receitaIdsComRegistro }) {
  return {
    produto: { pronto: baseCarregada, valido: (id) => receitaIdsComRegistro.includes(id) },
  };
}

// Sacos: filtros de Movimentações + busca do Saldo (independente).
export const FILTROS_SACOS = {
  versao: 1,
  padrao: { busca: '', tipo: 'todos', de: '', ate: '', buscaSaldo: '' },
  validadores: {
    busca: textoQualquer,
    tipo: umDe(['todos', ...Object.keys(TIPO_MOVIMENTO_LABEL)]),
    de: dataIsoOuVazio,
    ate: dataIsoOuVazio,
    buscaSaldo: textoQualquer,
  },
};

export const FILTROS_EXPOSITORES = {
  versao: 1,
  padrao: { inicio: '', fim: '', produtoId: 'todos', situacao: 'todos' },
  validadores: {
    inicio: dataIsoOuVazio,
    fim: dataIsoOuVazio,
    produtoId: textoQualquer,
    situacao: umDe(['todos', 'atrasado', 'retirar_hoje', 'retirar_amanha', 'no_expositor', 'concluido']),
  },
};

export function regrasSaneamentoExpositores({ produtosProntos, produtosControlados }) {
  return {
    produtoId: { pronto: produtosProntos, valido: (id) => produtosControlados.some((p) => p.id === id) },
  };
}

// --- Agenda ---------------------------------------------------------------

export const VISOES_AGENDA = ['dayGridMonth', 'timeGridWeek', 'timeGridDay'];

// Visão + data de referência do período navegado (null = período que
// contém hoje, segue o hoje dinâmico) + filtros.
export const FILTROS_AGENDA = {
  versao: 1,
  padrao: { visao: 'dayGridMonth', dataReferencia: null, categoria: 'todas', tipo: 'todos', status: 'todos' },
  validadores: {
    visao: umDe(VISOES_AGENDA),
    dataReferencia: (v) => v === null || dataIso(v),
    categoria: textoQualquer,
    tipo: umDe(['todos', 'evento', 'tarefa', 'aniversario', 'encomenda']),
    status: umDe(['todos', 'pendente', 'concluida']),
  },
};

// Período visível [inicioPeriodo, fimPeriodo) contém hoje -> null (o
// calendário volta a abrir no hoje daquele momento); senão, a data atual
// do calendário (o período navegado fica até um novo login).
export function dataReferenciaAgenda({ dataAtual, inicioPeriodo, fimPeriodo, hoje }) {
  if (hoje >= inicioPeriodo && hoje < fimPeriodo) return null;
  return dataAtual;
}

export function regrasSaneamentoAgenda({ categoriasProntas, categorias }) {
  return {
    categoria: { pronto: categoriasProntas, valido: (valor) => categorias.some((c) => c.valor === valor) },
  };
}

// --- Pedidos > Solicitações -----------------------------------------------

export const FILTROS_SOLICITACOES = {
  versao: 1,
  padrao: { mostrarRealizadas: false },
};
