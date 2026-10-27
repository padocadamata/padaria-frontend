// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/filtros/__tests__/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { camposParaSanear, criarPersistenciaFiltros } from '../persistenciaFiltros.js';
import {
  FILTROS_AGENDA,
  FILTROS_CLIENTES,
  FILTROS_CONTAS_PAGAR,
  FILTROS_DOCUMENTOS,
  FILTROS_ENCOMENDAS,
  FILTROS_EXPOSITORES,
  FILTROS_FORNECEDORES,
  FILTROS_FUNCIONARIOS,
  FILTROS_HISTORICO,
  FILTROS_PAGAMENTOS,
  FILTROS_PAGAMENTOS_A_PAGAR,
  FILTROS_PAGAMENTOS_PAGOS,
  FILTROS_PLANEJAMENTO,
  FILTROS_PRODUCAO_HOJE,
  FILTROS_PRODUCAO_PRODUTOS,
  FILTROS_SACOS,
  FILTROS_SOLICITACOES,
  FILTROS_TAREFAS,
  FILTROS_TAREFAS_CADASTRO,
  dataOuAutomatica,
  dataReferenciaAgenda,
  mesOuAutomatico,
  diaMobileTarefas,
  regrasSaneamentoAgenda,
  regrasSaneamentoContasPagar,
  regrasSaneamentoExpositores,
  regrasSaneamentoHistorico,
  regrasSaneamentoPagamentosPagos,
  regrasSaneamentoPlanejamento,
  regrasSaneamentoProducaoProdutos,
  regrasSaneamentoTarefas,
} from '../telas.js';
import * as telas from '../telas.js';
import { FILTROS_HOJE_PADRAO } from '../../producao/linhasHoje.js';
import { FILTROS_PADRAO as FILTROS_PADRAO_TAREFAS } from '../../tarefas/calendario.js';
import { janelaDoPeriodo } from '../../encomendas/regras.js';

class StorageFalso {
  constructor() {
    this.dados = new Map();
  }
  get length() {
    return this.dados.size;
  }
  key(i) {
    return Array.from(this.dados.keys())[i] ?? null;
  }
  getItem(k) {
    return this.dados.has(k) ? this.dados.get(k) : null;
  }
  setItem(k, v) {
    this.dados.set(k, String(v));
  }
  removeItem(k) {
    this.dados.delete(k);
  }
}

const U1 = '11111111-1111-4111-8111-111111111111';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function sessao() {
  const storage = new StorageFalso();
  const p = criarPersistenciaFiltros({ obterStorage: () => storage });
  p.definirSessao(U1, S1);
  return { p, ns: p.obterNamespace(), storage };
}

// Grava pelo caminho real (gravarTela) e relê -- o mesmo ciclo da tela.
function ciclo(ctx, tela, definicao, valores) {
  ctx.p.gravarTela(ctx.ns, tela, definicao.versao, valores);
  return ctx.p.lerTela(ctx.ns, tela, definicao).valores;
}

function salvarBruto(ctx, tela, v, valores) {
  ctx.storage.setItem(`${ctx.ns}${tela}`, JSON.stringify({ v, valores }));
}

// Todas as definições novas: padrão completo volta igual e campos
// temporários (página, modal, seleção, formulário...) nunca entram.
const DEFINICOES = {
  fornecedores: FILTROS_FORNECEDORES,
  clientes: FILTROS_CLIENTES,
  encomendas: FILTROS_ENCOMENDAS,
  funcionarios: FILTROS_FUNCIONARIOS,
  pagamentos: FILTROS_PAGAMENTOS,
  'pagamentos.a-pagar': FILTROS_PAGAMENTOS_A_PAGAR,
  'pagamentos.pagos': FILTROS_PAGAMENTOS_PAGOS,
  tarefas: FILTROS_TAREFAS,
  'tarefas.cadastro': FILTROS_TAREFAS_CADASTRO,
  'contas-pagar': FILTROS_CONTAS_PAGAR,
  'producao.hoje': FILTROS_PRODUCAO_HOJE,
  'producao.produtos': FILTROS_PRODUCAO_PRODUTOS,
  'producao.planejamento': FILTROS_PLANEJAMENTO,
  'producao.historico': FILTROS_HISTORICO,
  'producao.sacos': FILTROS_SACOS,
  'producao.expositores': FILTROS_EXPOSITORES,
  agenda: FILTROS_AGENDA,
  'pedidos.solicitacoes': FILTROS_SOLICITACOES,
  'comunicacao.documentos': FILTROS_DOCUMENTOS,
};

const TEMPORARIOS = ['pagina', 'modal', 'modalAberto', 'selecionados', 'selecao', 'edicoes', 'formulario', 'id', 'mensagem', 'erro', 'carregando', 'expandido', 'diaAberto', 'ocorrenciaAberta'];

test('etapa 2: toda definição tem versão, padrão válido e nenhum estado temporário', () => {
  for (const [tela, def] of Object.entries(DEFINICOES)) {
    assert.equal(def.versao, 1, tela);
    for (const campo of TEMPORARIOS) {
      assert.ok(!(campo in def.padrao), `${tela} não pode persistir ${campo}`);
    }
    const ctx = sessao();
    // Primeira visita: padrão, e o padrão passa no próprio validador.
    assert.deepEqual(ctx.p.lerTela(ctx.ns, tela, def).valores, def.padrao, tela);
    assert.deepEqual(ciclo(ctx, tela, def, { ...def.padrao }), def.padrao, tela);
  }
});

test('etapa 2: campos desconhecidos e estados temporários salvos são descartados', () => {
  const ctx = sessao();
  salvarBruto(ctx, 'fornecedores', 1, { busca: 'trigo', status: 'todos', pagina: 4, modalAberto: true, id: 'x' });
  assert.deepEqual(ctx.p.lerTela(ctx.ns, 'fornecedores', FILTROS_FORNECEDORES).valores, {
    busca: 'trigo',
    status: 'todos',
    modalidade: 'todas',
  });
});

test('etapa 2: nova sessão de login começa no padrão em todas as telas', () => {
  const ctx = sessao();
  ciclo(ctx, 'clientes', FILTROS_CLIENTES, { busca: 'ana', produto: 'p1', status: 'todos' });
  ciclo(ctx, 'tarefas', FILTROS_TAREFAS, { ...FILTROS_TAREFAS.padrao, mes: '2026-03-01' });
  ctx.p.definirSessao(U1, S2);
  const ns2 = ctx.p.obterNamespace();
  assert.deepEqual(ctx.p.lerTela(ns2, 'clientes', FILTROS_CLIENTES).valores, FILTROS_CLIENTES.padrao);
  assert.deepEqual(ctx.p.lerTela(ns2, 'tarefas', FILTROS_TAREFAS).valores, FILTROS_TAREFAS.padrao);
});

// --- Listas simples (busca + selects) --------------------------------------

test('Fornecedores/Funcionários/Clientes: restaura busca e selects; opção inválida volta ao padrão só no campo', () => {
  const ctx = sessao();
  assert.deepEqual(ciclo(ctx, 'fornecedores', FILTROS_FORNECEDORES, { busca: 'moinho', status: 'inativos', modalidade: 'compra_presencial' }), {
    busca: 'moinho',
    status: 'inativos',
    modalidade: 'compra_presencial',
  });
  salvarBruto(ctx, 'funcionarios', 1, { busca: 'Bia', status: 'qualquer', vinculo: 'pj' });
  assert.deepEqual(ctx.p.lerTela(ctx.ns, 'funcionarios', FILTROS_FUNCIONARIOS).valores, { busca: 'Bia', status: 'ativos', vinculo: 'pj' });
  salvarBruto(ctx, 'funcionarios', 1, { busca: 5, status: 'todos', vinculo: 'estagiario' });
  assert.deepEqual(ctx.p.lerTela(ctx.ns, 'funcionarios', FILTROS_FUNCIONARIOS).valores, { busca: '', status: 'todos', vinculo: '' });
});

test('A) Clientes/Encomendas/Produção Hoje: opção sem registros NÃO tem regra de saneamento', () => {
  // As opções dessas telas vêm só dos dados carregados (clientes, período,
  // linhas de hoje) -- não há cadastro independente que prove a invalidade.
  for (const nome of ['regrasSaneamentoClientes', 'regrasSaneamentoEncomendas', 'regrasSaneamentoProducaoHoje']) {
    assert.equal(nome in telas, false, nome);
  }
  // Produto escolhido sem nenhuma encomenda no período continua salvo.
  const ctx = sessao();
  const enc = { ...FILTROS_ENCOMENDAS.padrao, periodo: 'hoje', produto: 'p9', busca: 'bolo' };
  assert.deepEqual(ciclo(ctx, 'encomendas', FILTROS_ENCOMENDAS, enc), enc);
  const tipoSemProducaoHoje = { tipo: 'DOCES', situacao: '', turno: '' };
  assert.deepEqual(ciclo(ctx, 'producao.hoje', FILTROS_PRODUCAO_HOJE, tipoSemProducaoHoje), tipoSemProducaoHoje);
});

test('B) mudar o período não apaga Credor/Produto: só o próprio campo de período muda', () => {
  const ctx = sessao();
  const cp = ciclo(ctx, 'contas-pagar', FILTROS_CONTAS_PAGAR, { ...FILTROS_CONTAS_PAGAR.padrao, visao: 'pagas', credor: 'Moinho X', pagoDe: '2026-08-01' });
  // Período novo em que "Moinho X" não tem contas: credores carregados = só Y.
  const novo = ciclo(ctx, 'contas-pagar', FILTROS_CONTAS_PAGAR, { ...cp, pagoDe: '2026-01-01', pagoAte: '2026-01-31' });
  const regras = regrasSaneamentoContasPagar({ categoriasProntas: true, categorias: [] });
  assert.equal('credor' in regras, false);
  assert.equal(camposParaSanear(novo, regras, FILTROS_CONTAS_PAGAR.padrao), null);
  assert.equal(ctx.p.lerTela(ctx.ns, 'contas-pagar', FILTROS_CONTAS_PAGAR).valores.credor, 'Moinho X');

  const enc = ciclo(ctx, 'encomendas', FILTROS_ENCOMENDAS, { ...FILTROS_ENCOMENDAS.padrao, produto: 'p1' });
  const encNovo = ciclo(ctx, 'encomendas', FILTROS_ENCOMENDAS, { ...enc, periodo: 'passados' });
  assert.equal(encNovo.produto, 'p1');
});

// --- Datas com padrão dinâmico --------------------------------------------

test('dataOuAutomatica: null (automática), vazio (apagada) ou data real', () => {
  assert.equal(dataOuAutomatica(null), true);
  assert.equal(dataOuAutomatica(''), true);
  assert.equal(dataOuAutomatica('2026-10-23'), true);
  assert.equal(dataOuAutomatica('2026-02-30'), false);
  assert.equal(dataOuAutomatica(undefined), false);
  assert.equal(dataOuAutomatica(20261023), false);
});

test('Encomendas: preset relativo a hoje nunca congela; De/Até escolhidos ficam', () => {
  const ctx = sessao();
  // Sem escolha: De/Até null -> a tela resolve para o hoje DAQUELE dia.
  const salvo = ciclo(ctx, 'encomendas', FILTROS_ENCOMENDAS, { ...FILTROS_ENCOMENDAS.padrao, periodo: 'proximos' });
  assert.equal(salvo.periodoInicio, null);
  const amanha = '2026-10-24';
  assert.deepEqual(janelaDoPeriodo(salvo.periodo, amanha), { inicio: amanha, fim: '2026-11-23' });
  assert.equal(salvo.periodoInicio ?? amanha, amanha);
  // Escolhido explicitamente: permanece mesmo que vire o dia.
  const pers = ciclo(ctx, 'encomendas', FILTROS_ENCOMENDAS, { ...salvo, periodo: 'personalizado', periodoInicio: '2026-09-01', periodoFim: '2026-09-30' });
  assert.equal(pers.periodoInicio ?? amanha, '2026-09-01');
  assert.equal(pers.periodoFim ?? amanha, '2026-09-30');
  // Data apagada pelo usuário continua apagada (mesma validação de antes).
  const apagada = ciclo(ctx, 'encomendas', FILTROS_ENCOMENDAS, { ...pers, periodoFim: '' });
  assert.deepEqual(janelaDoPeriodo('personalizado', amanha, { inicio: apagada.periodoInicio, fim: apagada.periodoFim }), {
    erro: 'Informe as duas datas do período.',
  });
  // Preset inválido salvo -> padrão.
  salvarBruto(ctx, 'encomendas', 1, { ...FILTROS_ENCOMENDAS.padrao, periodo: 'ontem' });
  assert.equal(ctx.p.lerTela(ctx.ns, 'encomendas', FILTROS_ENCOMENDAS).valores.periodo, 'proximos');
});

test('Planejamento: datas null seguem hoje/domingo; escolhidas permanecem; Grupo/Produto saneados', () => {
  const ctx = sessao();
  const v = ciclo(ctx, 'producao.planejamento', FILTROS_PLANEJAMENTO, { ...FILTROS_PLANEJAMENTO.padrao });
  assert.equal(v.dataInicial, null);
  assert.equal(v.dataFinal, null);
  const escolhido = ciclo(ctx, 'producao.planejamento', FILTROS_PLANEJAMENTO, { ...v, dataInicial: '2026-10-01', dataFinal: '2026-10-05' });
  assert.equal(escolhido.dataInicial, '2026-10-01');
  assert.equal(escolhido.dataFinal, '2026-10-05');
  salvarBruto(ctx, 'producao.planejamento', 1, { ...v, dataInicial: 'ontem', turno: 'noite' });
  const saneado = ctx.p.lerTela(ctx.ns, 'producao.planejamento', FILTROS_PLANEJAMENTO).valores;
  assert.equal(saneado.dataInicial, null);
  assert.equal(saneado.turno, 'todos');

  // Produto: domínio completo (produtos controlados ativos). Grupo: nunca saneado.
  const produtos = [{ id: 'r1', grupo: 'PÃES' }, { id: 'r2', grupo: 'DOCES' }];
  const regras = (prontos) => regrasSaneamentoPlanejamento({ produtosProntos: prontos, produtos });
  const salvo = { ...FILTROS_PLANEJAMENTO.padrao, grupo: 'SALGADOS', produto: 'r1', turno: 'manha' };
  assert.equal(camposParaSanear(salvo, regras(false), FILTROS_PLANEJAMENTO.padrao), null);
  assert.equal(camposParaSanear(salvo, regras(true), FILTROS_PLANEJAMENTO.padrao), null);
  assert.deepEqual(camposParaSanear({ ...salvo, produto: 'r9' }, regras(true), FILTROS_PLANEJAMENTO.padrao), { produto: 'todos' });
});

test('Contas a Pagar: Pago de/até null = início do mês/hoje dinâmicos; filtros e visão restaurados', () => {
  const ctx = sessao();
  const v = ciclo(ctx, 'contas-pagar', FILTROS_CONTAS_PAGAR, { ...FILTROS_CONTAS_PAGAR.padrao, visao: 'pagas', forma: 'pix', origem: 'manual' });
  assert.equal(v.visao, 'pagas');
  assert.equal(v.forma, 'pix');
  assert.equal(v.pagoDe, null);
  assert.equal(v.pagoAte, null);
  const escolhido = ciclo(ctx, 'contas-pagar', FILTROS_CONTAS_PAGAR, { ...v, pagoDe: '2026-08-01', pagoAte: '2026-08-31' });
  assert.equal(escolhido.pagoDe, '2026-08-01');
  salvarBruto(ctx, 'contas-pagar', 1, { ...v, visao: 'outra', forma: 'cheque', grupo: 'vencida', de: '2026-13-01' });
  const saneado = ctx.p.lerTela(ctx.ns, 'contas-pagar', FILTROS_CONTAS_PAGAR).valores;
  assert.equal(saneado.visao, 'a_pagar');
  assert.equal(saneado.forma, '');
  assert.equal(saneado.grupo, 'vencida');
  assert.equal(saneado.de, '');
});

test('Contas a Pagar: só a categoria inexistente no cadastro é saneada; credor nunca', () => {
  const p = FILTROS_CONTAS_PAGAR.padrao;
  const valores = { ...p, credor: 'Moinho X', categoria: 'c9', forma: 'pix' };
  const regras = (categoriasProntas) => regrasSaneamentoContasPagar({ categoriasProntas, categorias: [{ id: 'c1' }] });
  assert.equal(camposParaSanear(valores, regras(false), p), null);
  assert.deepEqual(camposParaSanear(valores, regras(true), p), { categoria: '' });
  assert.equal(camposParaSanear({ ...valores, categoria: 'c1' }, regras(true), p), null);
});

test('Pagamentos: visão, competência (null = mês corrente) e filtros de Pagos', () => {
  const ctx = sessao();
  assert.equal(ciclo(ctx, 'pagamentos', FILTROS_PAGAMENTOS, { visao: 'pagos' }).visao, 'pagos');
  salvarBruto(ctx, 'pagamentos', 1, { visao: 'extrato' });
  assert.equal(ctx.p.lerTela(ctx.ns, 'pagamentos', FILTROS_PAGAMENTOS).valores.visao, 'a_pagar');

  assert.equal(ciclo(ctx, 'pagamentos.a-pagar', FILTROS_PAGAMENTOS_A_PAGAR, { competencia: null }).competencia, null);
  assert.equal(ciclo(ctx, 'pagamentos.a-pagar', FILTROS_PAGAMENTOS_A_PAGAR, { competencia: '2026-07-01' }).competencia, '2026-07-01');
  salvarBruto(ctx, 'pagamentos.a-pagar', 1, { competencia: '2026-07-15' });
  assert.equal(ctx.p.lerTela(ctx.ns, 'pagamentos.a-pagar', FILTROS_PAGAMENTOS_A_PAGAR).valores.competencia, null);

  const pagos = { ...FILTROS_PAGAMENTOS_PAGOS.padrao, funcionarioId: 'f9', natureza: 'mensal', dataInicio: '2026-01-01' };
  assert.deepEqual(ciclo(ctx, 'pagamentos.pagos', FILTROS_PAGAMENTOS_PAGOS, pagos), pagos);
  const regras = (prontos) => regrasSaneamentoPagamentosPagos({ funcionariosProntos: prontos, funcionarios: [{ id: 'f1' }] });
  assert.equal(camposParaSanear(pagos, regras(false), FILTROS_PAGAMENTOS_PAGOS.padrao), null);
  assert.deepEqual(camposParaSanear(pagos, regras(true), FILTROS_PAGAMENTOS_PAGOS.padrao), { funcionarioId: '' });
});

test('C/D) Tarefas: dia do celular persistido; dia padrão grava null; nova sessão volta ao padrão', () => {
  const hoje = '2026-10-23';
  // Padrão dinâmico: hoje no mês corrente, dia 1 em outro mês.
  assert.equal(diaMobileTarefas({ diaSalvo: null, mes: '2026-10-01', hoje }), hoje);
  assert.equal(diaMobileTarefas({ diaSalvo: null, mes: '2026-11-01', hoje }), '2026-11-01');
  // Dia escolhido: restaurado (F5/navegação) enquanto for do mês exibido.
  assert.equal(diaMobileTarefas({ diaSalvo: '2026-10-05', mes: '2026-10-01', hoje }), '2026-10-05');
  assert.equal(diaMobileTarefas({ diaSalvo: '2026-10-05', mes: '2026-11-01', hoje }), '2026-11-01');
  const ctx = sessao();
  const v = ciclo(ctx, 'tarefas', FILTROS_TAREFAS, { ...FILTROS_TAREFAS.padrao, diaMobile: '2026-10-05' });
  assert.equal(v.diaMobile, '2026-10-05');
  salvarBruto(ctx, 'tarefas', 1, { ...v, diaMobile: '05/10/2026' });
  assert.equal(ctx.p.lerTela(ctx.ns, 'tarefas', FILTROS_TAREFAS).valores.diaMobile, null);
  // Registro antigo (sem diaMobile) continua válido: só esse campo cai no padrão.
  salvarBruto(ctx, 'tarefas', 1, { mes: '2026-11-01', responsavel: '', situacao: 'todas', categoria: '' });
  const antigo = ctx.p.lerTela(ctx.ns, 'tarefas', FILTROS_TAREFAS).valores;
  assert.equal(antigo.mes, '2026-11-01');
  assert.equal(antigo.diaMobile, null);
  // Nova sessão de login: padrão (dia dinâmico).
  ciclo(ctx, 'tarefas', FILTROS_TAREFAS, { ...FILTROS_TAREFAS.padrao, diaMobile: '2026-10-05' });
  ctx.p.definirSessao(U1, S2);
  assert.equal(ctx.p.lerTela(ctx.p.obterNamespace(), 'tarefas', FILTROS_TAREFAS).valores.diaMobile, null);
});

test('Tarefas: mês corrente grava null (segue o hoje); outro mês permanece; filtros e categoria', () => {
  assert.equal(mesOuAutomatico('2026-10-01', '2026-10-01'), null);
  assert.equal(mesOuAutomatico('2026-11-01', '2026-10-01'), '2026-11-01');
  const ctx = sessao();
  const v = ciclo(ctx, 'tarefas', FILTROS_TAREFAS, { mes: '2026-11-01', diaMobile: null, ...FILTROS_PADRAO_TAREFAS, situacao: 'pendentes', responsavel: 'posicao:2' });
  assert.equal(v.mes, '2026-11-01');
  assert.equal(v.situacao, 'pendentes');
  assert.equal(v.responsavel, 'posicao:2');
  salvarBruto(ctx, 'tarefas', 1, { ...v, mes: '2026-11-15', situacao: 'atrasadas' });
  const saneado = ctx.p.lerTela(ctx.ns, 'tarefas', FILTROS_TAREFAS).valores;
  assert.equal(saneado.mes, null);
  assert.equal(saneado.situacao, 'todas');
  // Responsável NUNCA é saneado (depende do mês); categoria sim.
  const regras = regrasSaneamentoTarefas({ cadastroPronto: true, categorias: [{ valor: 'LIMPEZA' }] });
  assert.equal('responsavel' in regras, false);
  assert.deepEqual(camposParaSanear({ ...v, categoria: 'COZINHA' }, regras, FILTROS_TAREFAS.padrao), { categoria: '' });
  assert.equal(camposParaSanear({ ...v, categoria: 'COZINHA' }, regrasSaneamentoTarefas({ cadastroPronto: false, categorias: [] }), FILTROS_TAREFAS.padrao), null);
  // Cadastro: booleano.
  assert.equal(ciclo(ctx, 'tarefas.cadastro', FILTROS_TAREFAS_CADASTRO, { mostrarInativas: true }).mostrarInativas, true);
  salvarBruto(ctx, 'tarefas.cadastro', 1, { mostrarInativas: 'sim' });
  assert.equal(ctx.p.lerTela(ctx.ns, 'tarefas.cadastro', FILTROS_TAREFAS_CADASTRO).valores.mostrarInativas, false);
});

// --- Produção ---------------------------------------------------------------

test('Produção Hoje: só filtros -- nenhuma data entra no schema (o hoje continua automático)', () => {
  assert.deepEqual(Object.keys(FILTROS_PRODUCAO_HOJE.padrao).sort(), Object.keys(FILTROS_HOJE_PADRAO).sort());
  for (const campo of Object.keys(FILTROS_PRODUCAO_HOJE.padrao)) assert.ok(!/data|dia|hoje/i.test(campo), campo);
  const ctx = sessao();
  assert.deepEqual(ciclo(ctx, 'producao.hoje', FILTROS_PRODUCAO_HOJE, { tipo: 'PÃES', situacao: 'aberto', turno: 'tarde', data: '2026-10-20' }), {
    tipo: 'PÃES',
    situacao: 'aberto',
    turno: 'tarde',
  });
});

test('Produtos de Produção: Tipo/Grupo saneados só contra o CADASTRO de classificações', () => {
  const p = FILTROS_PRODUCAO_PRODUTOS.padrao;
  const cadastro = { tiposProducao: [{ valor: 'PÃO' }, { valor: 'BOLO' }], gruposProducao: [{ valor: 'FORNO' }] };
  const regras = regrasSaneamentoProducaoProdutos({ classificacoesProntas: true, ...cadastro });
  // BOLO existe no cadastro mesmo sem nenhuma receita usando -> mantido.
  assert.equal(camposParaSanear({ ...p, tipo: 'BOLO', grupo: 'FORNO' }, regras, p), null);
  assert.deepEqual(camposParaSanear({ ...p, tipo: 'PÃO', grupo: 'GELADEIRA', busca: 'x' }, regras, p), { grupo: 'todos' });
  assert.deepEqual(camposParaSanear({ ...p, tipo: 'TORTA', grupo: 'FORNO' }, regras, p), { tipo: 'todos' });
  // Cadastro carregando ou com erro: nada é tocado.
  assert.equal(camposParaSanear({ ...p, tipo: 'TORTA' }, regrasSaneamentoProducaoProdutos({ classificacoesProntas: false, tiposProducao: [], gruposProducao: [] }), p), null);
});

test('Histórico: filtros da consulta paginada restaurados; produto sem registro saneado após a carga base', () => {
  const ctx = sessao();
  const v = { periodoInicio: '2026-09-01', periodoFim: '', produto: 'r1', turno: 'manha', status: 'fechado', diaSemana: '6' };
  assert.deepEqual(ciclo(ctx, 'producao.historico', FILTROS_HISTORICO, v), v);
  salvarBruto(ctx, 'producao.historico', 1, { ...v, diaSemana: '7', status: 'cancelado' });
  const s = ctx.p.lerTela(ctx.ns, 'producao.historico', FILTROS_HISTORICO).valores;
  assert.equal(s.diaSemana, 'todos');
  assert.equal(s.status, 'todos');
  assert.equal(s.produto, 'r1');
  assert.equal(camposParaSanear(v, regrasSaneamentoHistorico({ baseCarregada: false, receitaIdsComRegistro: [] }), FILTROS_HISTORICO.padrao), null);
  assert.deepEqual(camposParaSanear(v, regrasSaneamentoHistorico({ baseCarregada: true, receitaIdsComRegistro: ['r2'] }), FILTROS_HISTORICO.padrao), {
    produto: 'todos',
  });
});

test('Sacos e Expositores: filtros restaurados; tipo/situação inválidos e produto não controlado', () => {
  const ctx = sessao();
  const sacos = { busca: 'farinha', tipo: 'abertura', de: '2026-10-01', ate: '', buscaSaldo: 'moinho' };
  assert.deepEqual(ciclo(ctx, 'producao.sacos', FILTROS_SACOS, sacos), sacos);
  salvarBruto(ctx, 'producao.sacos', 1, { ...sacos, tipo: 'retirada' });
  assert.equal(ctx.p.lerTela(ctx.ns, 'producao.sacos', FILTROS_SACOS).valores.tipo, 'todos');

  const expo = { inicio: '', fim: '2026-10-10', produtoId: 'r3', situacao: 'atrasado' };
  assert.deepEqual(ciclo(ctx, 'producao.expositores', FILTROS_EXPOSITORES, expo), expo);
  const regras = (prontos) => regrasSaneamentoExpositores({ produtosProntos: prontos, produtosControlados: [{ id: 'r1' }] });
  assert.equal(camposParaSanear(expo, regras(false), FILTROS_EXPOSITORES.padrao), null);
  assert.deepEqual(camposParaSanear(expo, regras(true), FILTROS_EXPOSITORES.padrao), { produtoId: 'todos' });
});

// --- Agenda -----------------------------------------------------------------

test('Agenda: período que contém hoje grava null (segue o hoje); período navegado permanece', () => {
  // Mês de outubro (grade começa antes; o período "atual" é 01/10 a 01/11 exclusivo).
  assert.equal(dataReferenciaAgenda({ dataAtual: '2026-10-23', inicioPeriodo: '2026-10-01', fimPeriodo: '2026-11-01', hoje: '2026-10-23' }), null);
  assert.equal(
    dataReferenciaAgenda({ dataAtual: '2026-12-23', inicioPeriodo: '2026-12-01', fimPeriodo: '2027-01-01', hoje: '2026-10-23' }),
    '2026-12-23'
  );
  // Fim exclusivo: o primeiro dia do próximo período não conta como "contém hoje".
  assert.equal(
    dataReferenciaAgenda({ dataAtual: '2026-10-25', inicioPeriodo: '2026-10-25', fimPeriodo: '2026-10-26', hoje: '2026-10-26' }),
    '2026-10-25'
  );
  const ctx = sessao();
  const v = { visao: 'timeGridWeek', dataReferencia: '2026-12-23', categoria: 'COMPRAS', tipo: 'tarefa', status: 'pendente' };
  assert.deepEqual(ciclo(ctx, 'agenda', FILTROS_AGENDA, v), v);
  salvarBruto(ctx, 'agenda', 1, { ...v, visao: 'listWeek', dataReferencia: '23/12/2026' });
  const s = ctx.p.lerTela(ctx.ns, 'agenda', FILTROS_AGENDA).valores;
  assert.equal(s.visao, 'dayGridMonth');
  assert.equal(s.dataReferencia, null);
  assert.equal(s.categoria, 'COMPRAS');
  const regras = (prontas) => regrasSaneamentoAgenda({ categoriasProntas: prontas, categorias: [{ valor: 'OUTROS' }] });
  assert.equal(camposParaSanear(v, regras(false), FILTROS_AGENDA.padrao), null);
  assert.deepEqual(camposParaSanear(v, regras(true), FILTROS_AGENDA.padrao), { categoria: 'todas' });
});

test('Solicitações: Mostrar realizadas (booleano) restaurado; tipo errado volta ao padrão', () => {
  const ctx = sessao();
  assert.equal(ciclo(ctx, 'pedidos.solicitacoes', FILTROS_SOLICITACOES, { mostrarRealizadas: true }).mostrarRealizadas, true);
  salvarBruto(ctx, 'pedidos.solicitacoes', 1, { mostrarRealizadas: 1 });
  assert.equal(ctx.p.lerTela(ctx.ns, 'pedidos.solicitacoes', FILTROS_SOLICITACOES).valores.mostrarRealizadas, false);
});

test('ordenações e filtros de telas diferentes nunca se misturam (uma chave por tela)', () => {
  const ctx = sessao();
  ciclo(ctx, 'fornecedores', FILTROS_FORNECEDORES, { busca: 'a', status: 'todos', modalidade: 'todas' });
  ciclo(ctx, 'clientes', FILTROS_CLIENTES, { busca: 'b', produto: '', status: 'inativos' });
  ctx.p.gravarTela(ctx.ns, 'ordenacao:fornecedores', 1, { ordenacao: { chave: 'nome', direcao: 'desc' } });
  ctx.p.gravarTela(ctx.ns, 'ordenacao:contas-pagar.pagas', 1, { ordenacao: { chave: 'pago', direcao: 'asc' } });
  assert.equal(ctx.p.lerTela(ctx.ns, 'fornecedores', FILTROS_FORNECEDORES).valores.busca, 'a');
  assert.equal(ctx.p.lerTela(ctx.ns, 'clientes', FILTROS_CLIENTES).valores.busca, 'b');
  const chaves = Array.from(ctx.storage.dados.keys()).sort();
  assert.deepEqual(chaves, [
    `${ctx.ns}clientes`,
    `${ctx.ns}fornecedores`,
    `${ctx.ns}ordenacao:contas-pagar.pagas`,
    `${ctx.ns}ordenacao:fornecedores`,
  ]);
});
