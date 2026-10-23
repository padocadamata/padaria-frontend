// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/filtros/__tests__/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { camposParaSanear, criarPersistenciaFiltros } from '../persistenciaFiltros.js';
import {
  FILTROS_CATALOGO,
  FILTROS_ESCALA,
  FILTROS_PEDIDOS,
  filtrosEscalaMensal,
  filtrosEscalaPorHora,
  filtrosEscalaSemanal,
  queryComStatusPedidos,
  regrasSaneamentoCatalogo,
  regrasSaneamentoEscala,
  regrasSaneamentoPedidos,
  sincronizarStatusPedidos,
  statusDaUrlPedidos,
  statusExibidoPedidos,
} from '../telas.js';
import { inicioDaSemana } from '../../funcionarios/escala.js';

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

function sessao() {
  const storage = new StorageFalso();
  const p = criarPersistenciaFiltros({ obterStorage: () => storage });
  p.definirSessao(U1, S1);
  return { p, ns: p.obterNamespace(), storage };
}

function salvarBruto(ctx, tela, v, valores) {
  ctx.storage.setItem(`${ctx.ns}${tela}`, JSON.stringify({ v, valores }));
}

// --- Catálogo -------------------------------------------------------------

test('Catálogo: restaura Busca/Status/Seção/Categoria', () => {
  const ctx = sessao();
  const salvos = { busca: 'pão', status: 'todos', secaoId: 'sec-1', categoriaId: 'cat-2' };
  ctx.p.gravarTela(ctx.ns, 'catalogo', FILTROS_CATALOGO.versao, salvos);
  assert.deepEqual(ctx.p.lerTela(ctx.ns, 'catalogo', FILTROS_CATALOGO), { valores: salvos, precisaGravar: false });
});

test('Catálogo: restaura a ordenação (chave própria, separada dos filtros)', () => {
  const ctx = sessao();
  salvarBruto(ctx, 'ordenacao:catalogo', 1, { ordenacao: { chave: 'menorPreco', direcao: 'desc' } });
  const def = { versao: 1, padrao: { ordenacao: { chave: 'nome', direcao: 'asc' } }, validadores: { ordenacao: () => true } };
  assert.deepEqual(ctx.p.lerTela(ctx.ns, 'ordenacao:catalogo', def).valores.ordenacao, { chave: 'menorPreco', direcao: 'desc' });
});

test('Catálogo: página, modal, edição inline e seleção NUNCA são restaurados', () => {
  const ctx = sessao();
  salvarBruto(ctx, 'catalogo', 1, {
    busca: 'pão',
    status: 'ativos',
    secaoId: 'todas',
    categoriaId: 'todas',
    pagina: 4,
    modalClassificacoesAberto: true,
    edicoes: { p1: {} },
    produtoParaExcluir: { id: 'p1' },
  });
  const { valores } = ctx.p.lerTela(ctx.ns, 'catalogo', FILTROS_CATALOGO);
  assert.deepEqual(Object.keys(valores).sort(), ['busca', 'categoriaId', 'secaoId', 'status']);
  assert.equal(Object.keys(FILTROS_CATALOGO.padrao).includes('pagina'), false);
});

test('Catálogo: Status inválido volta a Ativos sem afetar os demais', () => {
  const ctx = sessao();
  salvarBruto(ctx, 'catalogo', 1, { busca: 'pão', status: 'excluidos', secaoId: 'sec-1', categoriaId: 'todas' });
  assert.deepEqual(ctx.p.lerTela(ctx.ns, 'catalogo', FILTROS_CATALOGO).valores, {
    busca: 'pão',
    status: 'ativos',
    secaoId: 'sec-1',
    categoriaId: 'todas',
  });
});

test('Catálogo: Seção/Categoria inexistentes só são saneadas depois das classificações carregarem', () => {
  const valores = { busca: '', status: 'ativos', secaoId: 'sec-removida', categoriaId: 'cat-1' };
  const mapas = { secoesPorId: new Map([['sec-1', {}]]), categoriasPorId: new Map([['cat-1', {}]]) };
  assert.equal(camposParaSanear(valores, regrasSaneamentoCatalogo({ ...mapas, classificacoesProntas: false }), FILTROS_CATALOGO.padrao), null);
  assert.deepEqual(
    camposParaSanear(valores, regrasSaneamentoCatalogo({ ...mapas, classificacoesProntas: true }), FILTROS_CATALOGO.padrao),
    { secaoId: 'todas' }
  );
});

// --- Escala ---------------------------------------------------------------

const FUNCIONARIOS = [
  { id: 'f1', cargo_id: 'c-forno' },
  { id: 'f2', cargo_id: 'c-balcao' },
];
const CARGOS = [{ id: 'c-forno' }, { id: 'c-balcao' }];

test('Escala: visão + Cargo + Funcionária restaurados; visão desconhecida volta a Semanal', () => {
  const ctx = sessao();
  ctx.p.gravarTela(ctx.ns, 'escala', 1, { visao: 'mensal', cargoId: 'c-forno', funcionarioId: 'f1' });
  assert.deepEqual(ctx.p.lerTela(ctx.ns, 'escala', FILTROS_ESCALA).valores, { visao: 'mensal', cargoId: 'c-forno', funcionarioId: 'f1' });
  salvarBruto(ctx, 'escala', 1, { visao: 'anual', cargoId: 'c-forno', funcionarioId: '' });
  assert.equal(ctx.p.lerTela(ctx.ns, 'escala', FILTROS_ESCALA).valores.visao, 'semanal');
});

test('Escala: Cargo/Funcionária -- espera o carregamento; depois saneia só o incompatível', () => {
  const regras = (pronto) => regrasSaneamentoEscala({ funcionariosProntos: pronto, funcionarios: FUNCIONARIOS, cargos: CARGOS });
  const padrao = FILTROS_ESCALA.padrao;
  // carregando: nada muda
  assert.equal(camposParaSanear({ visao: 'mensal', cargoId: 'c-x', funcionarioId: 'f9' }, regras(false), padrao), null);
  // válidos: nada muda
  assert.equal(camposParaSanear({ visao: 'mensal', cargoId: 'c-forno', funcionarioId: 'f1' }, regras(true), padrao), null);
  // funcionária de OUTRO cargo: só ela sai; cargo e visão ficam
  assert.deepEqual(camposParaSanear({ visao: 'mensal', cargoId: 'c-forno', funcionarioId: 'f2' }, regras(true), padrao), { funcionarioId: '' });
  // funcionária que não existe mais
  assert.deepEqual(camposParaSanear({ visao: 'semanal', cargoId: '', funcionarioId: 'f9' }, regras(true), padrao), { funcionarioId: '' });
  // cargo que não existe mais: volta a todos; a funcionária válida sem cargo fica
  assert.deepEqual(camposParaSanear({ visao: 'semanal', cargoId: 'c-x', funcionarioId: 'f2' }, regras(true), padrao), { cargoId: '' });
});

test('Escala: semana/mês/período salvos permanecem mesmo quando "hoje" muda (sem reset diário)', () => {
  const ctx = sessao();
  ctx.p.gravarTela(ctx.ns, 'escala.semanal', 1, { semanaInicio: '2026-10-05' });
  ctx.p.gravarTela(ctx.ns, 'escala.mensal', 1, { mesInicio: '2026-08-01' });
  ctx.p.gravarTela(ctx.ns, 'escala.cobertura', 1, { dataInicio: '2026-10-07', dataFim: '2026-10-09', diaEscolhido: '2026-10-08' });

  // dias depois: o "padrão de hoje" é outro, mas o salvo vence
  const semanal = filtrosEscalaSemanal({ semanaAtual: '2026-10-26', inicioDaSemana });
  const mensal = filtrosEscalaMensal({ mesAtual: '2026-11-01' });
  const porHora = filtrosEscalaPorHora({ semanaAtual: '2026-10-26' });
  assert.equal(ctx.p.lerTela(ctx.ns, 'escala.semanal', semanal).valores.semanaInicio, '2026-10-05');
  assert.equal(ctx.p.lerTela(ctx.ns, 'escala.mensal', mensal).valores.mesInicio, '2026-08-01');
  assert.deepEqual(ctx.p.lerTela(ctx.ns, 'escala.cobertura', porHora).valores, {
    dataInicio: '2026-10-07',
    dataFim: '2026-10-09',
    diaEscolhido: '2026-10-08',
  });
});

test('Escala: primeira abertura sem nada salvo usa a semana/mês corrente e pede para gravar', () => {
  const ctx = sessao();
  const semanal = filtrosEscalaSemanal({ semanaAtual: '2026-10-19', inicioDaSemana });
  assert.deepEqual(ctx.p.lerTela(ctx.ns, 'escala.semanal', semanal), { valores: { semanaInicio: '2026-10-19' }, precisaGravar: true });
  const porHora = filtrosEscalaPorHora({ semanaAtual: '2026-10-19' });
  assert.deepEqual(porHora.padrao, { dataInicio: '2026-10-19', dataFim: '2026-10-25', diaEscolhido: '' });
});

test('Escala: períodos incoerentes voltam ao padrão (semana fora da segunda, mês fora do dia 1, intervalo > 7 dias)', () => {
  const ctx = sessao();
  ctx.p.gravarTela(ctx.ns, 'escala.semanal', 1, { semanaInicio: inicioDaSemana('2026-10-08') === '2026-10-08' ? '2026-10-09' : '2026-10-08' });
  ctx.p.gravarTela(ctx.ns, 'escala.mensal', 1, { mesInicio: '2026-08-15' });
  ctx.p.gravarTela(ctx.ns, 'escala.cobertura', 1, { dataInicio: '2026-10-01', dataFim: '2026-10-20', diaEscolhido: 'ontem' });
  const semanal = filtrosEscalaSemanal({ semanaAtual: '2026-10-19', inicioDaSemana });
  assert.equal(ctx.p.lerTela(ctx.ns, 'escala.semanal', semanal).valores.semanaInicio, '2026-10-19');
  assert.equal(ctx.p.lerTela(ctx.ns, 'escala.mensal', filtrosEscalaMensal({ mesAtual: '2026-10-01' })).valores.mesInicio, '2026-10-01');
  assert.deepEqual(ctx.p.lerTela(ctx.ns, 'escala.cobertura', filtrosEscalaPorHora({ semanaAtual: '2026-10-19' })).valores, {
    dataInicio: '2026-10-19',
    dataFim: '2026-10-25',
    diaEscolhido: '',
  });
  // fim antes do início também
  ctx.p.gravarTela(ctx.ns, 'escala.cobertura', 1, { dataInicio: '2026-10-10', dataFim: '2026-10-09', diaEscolhido: '' });
  assert.equal(ctx.p.lerTela(ctx.ns, 'escala.cobertura', filtrosEscalaPorHora({ semanaAtual: '2026-10-19' })).valores.dataInicio, '2026-10-19');
});

test('Escala: modal, formulário, lote, confirmação e painel NÃO são persistidos', () => {
  const ctx = sessao();
  salvarBruto(ctx, 'escala', 1, {
    visao: 'semanal',
    cargoId: '',
    funcionarioId: '',
    modalDia: { funcionario: 'f1' },
    modalLoteAberto: true,
    selecionadas: ['f1', 'f2'],
    confirmarCopiaSemana: {},
    painelAberto: true,
  });
  assert.deepEqual(Object.keys(ctx.p.lerTela(ctx.ns, 'escala', FILTROS_ESCALA).valores).sort(), ['cargoId', 'funcionarioId', 'visao']);
});

// --- Pedidos --------------------------------------------------------------

test('Pedidos: estado salvo restaurado; fornecedor some só depois dos pedidos carregarem', () => {
  const ctx = sessao();
  const salvos = { status: 'recebido', fornecedorId: 'forn-1', modalidade: 'compra_presencial', periodoInicio: '2026-10-01', periodoFim: '2026-10-31' };
  ctx.p.gravarTela(ctx.ns, 'pedidos', 1, salvos);
  assert.deepEqual(ctx.p.lerTela(ctx.ns, 'pedidos', FILTROS_PEDIDOS).valores, salvos);

  const regras = (pronto) => regrasSaneamentoPedidos({ pedidosProntos: pronto, fornecedorIds: new Set(['forn-2']) });
  assert.equal(camposParaSanear(salvos, regras(false), FILTROS_PEDIDOS.padrao), null);
  assert.deepEqual(camposParaSanear(salvos, regras(true), FILTROS_PEDIDOS.padrao), { fornecedorId: 'todos' });
});

test('Pedidos: modalidade/datas inválidas voltam ao padrão campo a campo', () => {
  const ctx = sessao();
  salvarBruto(ctx, 'pedidos', 1, { status: 'xpto', fornecedorId: 'forn-1', modalidade: 'drone', periodoInicio: '2026-13-01', periodoFim: '' });
  assert.deepEqual(ctx.p.lerTela(ctx.ns, 'pedidos', FILTROS_PEDIDOS).valores, {
    status: 'todos',
    fornecedorId: 'forn-1',
    modalidade: 'todas',
    periodoInicio: '',
    periodoFim: '',
  });
});

test('Pedidos: ?filtro= válido vence o salvo (e passa a ser o salvo)', () => {
  assert.deepEqual(
    sincronizarStatusPedidos({ routerPronto: true, paramFiltro: 'atrasados', statusSalvo: 'recebido', inicializado: false }),
    { acao: 'persistir', status: 'atrasado' }
  );
  assert.equal(statusExibidoPedidos({ routerPronto: true, paramFiltro: 'atrasados', statusSalvo: 'recebido', inicializado: false }), 'atrasado');
});

test('Pedidos: entrar sem ?filtro= restaura o salvo (replace), exibindo o salvo desde o 1º quadro', () => {
  const entrada = { routerPronto: true, paramFiltro: undefined, statusSalvo: 'recebido', inicializado: false };
  assert.deepEqual(sincronizarStatusPedidos(entrada), { acao: 'restaurar', status: 'recebido' });
  assert.equal(statusExibidoPedidos(entrada), 'recebido');
  assert.deepEqual(queryComStatusPedidos({}, 'recebido'), { filtro: 'recebido' });
  // depois do replace, a URL traz o filtro: só persiste (sem novo replace)
  assert.deepEqual(
    sincronizarStatusPedidos({ routerPronto: true, paramFiltro: 'recebido', statusSalvo: 'recebido', inicializado: false }),
    { acao: 'persistir', status: 'recebido' }
  );
  // ?filtro= desconhecido conta como "sem filtro" -> restaura o salvo
  assert.deepEqual(
    sincronizarStatusPedidos({ routerPronto: true, paramFiltro: 'xyz', statusSalvo: 'cancelado', inicializado: false }),
    { acao: 'restaurar', status: 'cancelado' }
  );
  // salvo = todos: nada a restaurar
  assert.deepEqual(
    sincronizarStatusPedidos({ routerPronto: true, paramFiltro: undefined, statusSalvo: 'todos', inicializado: false }),
    { acao: 'persistir', status: 'todos' }
  );
  // router ainda não pronto (F5): espera
  assert.deepEqual(sincronizarStatusPedidos({ routerPronto: false, paramFiltro: undefined, statusSalvo: 'recebido', inicializado: false }), { acao: 'aguardar' });
});

test('Pedidos: voltar/avançar depois da entrada -- a URL só é persistida, nunca reescrita (sem loop)', () => {
  // histórico: /pedidos?filtro=aguardando -> ?filtro=recebido -> (Todos) /pedidos
  const salvo = { atual: 'aguardando_entrega' };
  const passos = ['recebido', undefined, 'recebido', 'aguardando']; // push, push, voltar, voltar
  for (const param of passos) {
    const decisao = sincronizarStatusPedidos({ routerPronto: true, paramFiltro: param, statusSalvo: salvo.atual, inicializado: true });
    assert.equal(decisao.acao, 'persistir');
    salvo.atual = decisao.status;
    assert.equal(statusExibidoPedidos({ routerPronto: true, paramFiltro: param, statusSalvo: salvo.atual, inicializado: true }), decisao.status);
  }
  assert.equal(salvo.atual, 'aguardando_entrega');
  // a parada "Todos" no histórico (sem ?filtro=) mostra Todos, não o salvo anterior
  assert.equal(statusExibidoPedidos({ routerPronto: true, paramFiltro: undefined, statusSalvo: 'recebido', inicializado: true }), 'todos');
});

test('Pedidos: ?id= nunca vira filtro -- preservado na URL, ausente do estado salvo', () => {
  assert.deepEqual(queryComStatusPedidos({ id: 'ped-1' }, 'recebido'), { id: 'ped-1', filtro: 'recebido' });
  assert.deepEqual(queryComStatusPedidos({ id: 'ped-1', filtro: 'recebido' }, 'todos'), { id: 'ped-1' });
  assert.equal(statusDaUrlPedidos(undefined), null);
  assert.equal(Object.keys(FILTROS_PEDIDOS.padrao).includes('id'), false);
  const ctx = sessao();
  salvarBruto(ctx, 'pedidos', 1, { status: 'recebido', id: 'ped-1', pagina: 3, pedidoDetalhe: { id: 'ped-1' } });
  assert.deepEqual(Object.keys(ctx.p.lerTela(ctx.ns, 'pedidos', FILTROS_PEDIDOS).valores).sort(), [
    'fornecedorId',
    'modalidade',
    'periodoFim',
    'periodoInicio',
    'status',
  ]);
});
