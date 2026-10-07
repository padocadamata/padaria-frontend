// node --test lib/pedidos/__tests__/*.test.mjs
// Somente mocks/harness em memória -- nenhuma chamada ao Supabase real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  podeSelecionarSolicitacao,
  idsSelecionaveis,
  estadoSelecaoTodos,
  alternarTodos,
  alternarUm,
  podarSelecao,
  motivoFalha,
  executarEmLote,
  resumirResultadoLote,
} from '../solicitacoesLote.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ler = (arq) => readFileSync(join(raiz, arq), 'utf8');

const sol = (id, status = 'pendente', extra = {}) => ({ id, status, descricao: `Item ${id}`, pedido_id: null, ...extra });
const lista = [sol('a'), sol('b'), sol('c', 'realizada', { pedido_id: 'p1' }), sol('d')];
const TODAS = { podeRealizar: true, podeExcluir: true };

// Harness: simula as RPCs individuais com as MESMAS regras/mensagens da
// migration 0043 sobre um "banco" em memória.
function bancoFalso(registros, { permissoes = TODAS, lancarEm = null } = {}) {
  const db = new Map(registros.map((r) => [r.id, { ...r }]));
  const chamadas = [];
  const erro = (message) => ({ error: { message } });
  return {
    db,
    chamadas,
    rpc(nome, args) {
      chamadas.push({ nome, args });
      if (lancarEm === args.p_id) throw new Error('falha de rede');
      const r = db.get(args.p_id);
      if (nome === 'marcar_solicitacao_realizada') {
        if (!permissoes.podeRealizar) return erro('marcar_solicitacao_realizada: requer a permissao pedidos_solicitacoes.realizar.');
        if (!r) return erro(`marcar_solicitacao_realizada: solicitacao ${args.p_id} nao encontrada.`);
        if (r.status !== 'pendente') return erro('marcar_solicitacao_realizada: esta solicitacao ja esta realizada.');
        r.status = 'realizada';
        r.observacao_realizacao = args.p_observacao_realizacao;
        return { error: null };
      }
      if (nome === 'excluir_solicitacao_pendente') {
        if (!permissoes.podeExcluir) return erro('excluir_solicitacao_pendente: requer a permissao pedidos_solicitacoes.excluir.');
        if (!r) return erro(`excluir_solicitacao_pendente: solicitacao ${args.p_id} nao encontrada.`);
        if (r.status !== 'pendente' || r.pedido_id) return erro('excluir_solicitacao_pendente: somente solicitacoes pendentes e sem pedido vinculado podem ser excluidas.');
        db.delete(args.p_id);
        return { error: null };
      }
      throw new Error(`RPC inesperada ${nome}`);
    },
  };
}

// ------------------------------------------------------------ SELEÇÃO
test('seleção: só pendentes com permissão de alguma ação em lote são selecionáveis', () => {
  assert.deepEqual(idsSelecionaveis(lista, TODAS), ['a', 'b', 'd']);
  assert.deepEqual(idsSelecionaveis(lista, { podeRealizar: true, podeExcluir: false }), ['a', 'b', 'd']);
  assert.deepEqual(idsSelecionaveis(lista, { podeRealizar: false, podeExcluir: true }), ['a', 'b', 'd']);
  assert.deepEqual(idsSelecionaveis(lista, { podeRealizar: false, podeExcluir: false }), []);
  assert.equal(podeSelecionarSolicitacao(sol('x', 'realizada'), TODAS), false);
});

test('seleção: individual por ID (nunca índice), liga e desliga', () => {
  let sel = new Set();
  sel = alternarUm('b', sel);
  assert.deepEqual([...sel], ['b']);
  const antes = sel;
  sel = alternarUm('b', sel);
  assert.deepEqual([...sel], []);
  assert.deepEqual([...antes], ['b'], 'imutável: Set anterior preservado');
});

test('seleção: cabeçalho seleciona/desmarca TODOS os VISÍVEIS, com estado parcial (indeterminate)', () => {
  const visiveis = idsSelecionaveis(lista, TODAS);
  assert.equal(estadoSelecaoTodos(visiveis, new Set()), 'nenhum');
  assert.equal(estadoSelecaoTodos(visiveis, new Set(['a'])), 'parcial');
  const todos = alternarTodos(visiveis, new Set(['a']));
  assert.deepEqual([...todos].sort(), ['a', 'b', 'd']);
  assert.equal(estadoSelecaoTodos(visiveis, todos), 'todos');
  assert.deepEqual([...alternarTodos(visiveis, todos)], []);
  assert.equal(estadoSelecaoTodos([], new Set()), 'nenhum');
});

test('seleção: "todos" nunca inclui itens fora do filtro/visíveis', () => {
  // filtro "só pendentes visíveis" = a, b ; d está fora (ex.: outra página/filtro)
  const visiveis = ['a', 'b'];
  assert.deepEqual([...alternarTodos(visiveis, new Set())].sort(), ['a', 'b']);
  // seleção com item fora do conjunto exibido -> poda remove
  assert.deepEqual([...podarSelecao(new Set(['a', 'd', 'zzz']), visiveis)], ['a']);
});

test('seleção: após recarga, itens excluídos/concluídos saem da seleção', () => {
  const sel = new Set(['a', 'b', 'd']);
  const depois = [sol('a', 'realizada'), sol('b')]; // a concluída, d excluída
  assert.deepEqual([...podarSelecao(sel, idsSelecionaveis(depois, TODAS))], ['b']);
});

// ------------------------------------------------------------ CONCLUIR EM LOTE
test('concluir em lote: todas com sucesso, mesma RPC/parâmetros da ação individual', async () => {
  const banco = bancoFalso(lista);
  const res = await executarEmLote(['a', 'b', 'd'], (id) => banco.rpc('marcar_solicitacao_realizada', { p_id: id, p_observacao_realizacao: 'comprado no mercado' }));
  assert.deepEqual(res.sucesso, ['a', 'b', 'd']);
  assert.deepEqual(res.falhas, []);
  assert.ok(banco.chamadas.every((c) => c.nome === 'marcar_solicitacao_realizada' && c.args.p_observacao_realizacao === 'comprado no mercado'));
  assert.equal(banco.db.get('a').status, 'realizada');
  const resumo = resumirResultadoLote(res, 'concluir');
  assert.equal(resumo.tom, 'success');
  assert.equal(resumo.titulo, '3 solicitações concluídas.');
});

test('concluir em lote: sucesso PARCIAL informa quantas e quais, sem forçar as que falharam', async () => {
  const banco = bancoFalso([sol('a'), sol('b', 'realizada'), sol('d')]); // b já realizada por outra pessoa
  const res = await executarEmLote(['a', 'b', 'd', 'sumiu'], (id) => banco.rpc('marcar_solicitacao_realizada', { p_id: id, p_observacao_realizacao: null }));
  assert.deepEqual(res.sucesso, ['a', 'd']);
  assert.deepEqual(res.falhas.map((f) => [f.id, f.motivo]), [
    ['b', 'já estava realizada'],
    ['sumiu', 'não encontrada (pode ter sido excluída por outra pessoa)'],
  ]);
  const resumo = resumirResultadoLote(res, 'concluir', { b: 'Farinha', sumiu: 'Ovos' });
  assert.equal(resumo.tom, 'warning');
  assert.equal(resumo.titulo, '2 de 4 solicitações concluídas. 2 não puderam ser concluídas.');
  assert.deepEqual(resumo.detalhes, ['Farinha: já estava realizada', 'Ovos: não encontrada (pode ter sido excluída por outra pessoa)']);
});

test('concluir em lote: sem permissão -> nenhuma concluída (servidor rejeita cada item)', async () => {
  const banco = bancoFalso(lista, { permissoes: { podeRealizar: false, podeExcluir: true } });
  const res = await executarEmLote(['a', 'b'], (id) => banco.rpc('marcar_solicitacao_realizada', { p_id: id, p_observacao_realizacao: null }));
  assert.deepEqual(res.sucesso, []);
  assert.ok(res.falhas.every((f) => f.motivo === 'sem permissão para esta ação'));
  assert.equal(banco.db.get('a').status, 'pendente');
  const resumo = resumirResultadoLote(res, 'concluir');
  assert.equal(resumo.tom, 'danger');
  assert.equal(resumo.titulo, 'Nenhuma solicitação foi concluída. 2 não puderam ser concluídas.');
});

test('lote: exceção (rede) num item não interrompe os demais e conta como falha', async () => {
  const banco = bancoFalso(lista, { lancarEm: 'b' });
  const progresso = [];
  const res = await executarEmLote(['a', 'b', 'd'], (id) => banco.rpc('marcar_solicitacao_realizada', { p_id: id, p_observacao_realizacao: null }), (f, t) => progresso.push(`${f}/${t}`));
  assert.deepEqual(res.sucesso, ['a', 'd']);
  assert.deepEqual(res.falhas.map((f) => [f.id, f.motivo]), [['b', 'erro inesperado ao processar']]);
  assert.deepEqual(progresso, ['1/3', '2/3', '3/3']);
});

test('lote: processa em SEQUÊNCIA, na ordem recebida (sem rajada concorrente)', async () => {
  const ordem = [];
  let emAndamento = 0;
  let maxConcorrente = 0;
  await executarEmLote(['x', 'y', 'z'], async (id) => {
    emAndamento += 1;
    maxConcorrente = Math.max(maxConcorrente, emAndamento);
    await new Promise((r) => setTimeout(r, 2));
    ordem.push(id);
    emAndamento -= 1;
    return { error: null };
  });
  assert.deepEqual(ordem, ['x', 'y', 'z']);
  assert.equal(maxConcorrente, 1);
});

// ------------------------------------------------------------ EXCLUIR EM LOTE
test('excluir em lote: todas com sucesso, mesma RPC da exclusão individual', async () => {
  const banco = bancoFalso(lista);
  const res = await executarEmLote(['a', 'b'], (id) => banco.rpc('excluir_solicitacao_pendente', { p_id: id }));
  assert.deepEqual(res.sucesso, ['a', 'b']);
  assert.equal(banco.db.has('a'), false);
  assert.deepEqual(banco.chamadas.map((c) => c.args), [{ p_id: 'a' }, { p_id: 'b' }]);
  assert.equal(resumirResultadoLote(res, 'excluir').titulo, '2 solicitações excluídas.');
  assert.equal(resumirResultadoLote({ sucesso: ['a'], falhas: [] }, 'excluir').titulo, '1 solicitação excluída.');
});

test('excluir em lote: não contorna a regra individual (realizada/vinculada é recusada)', async () => {
  const banco = bancoFalso(lista);
  const res = await executarEmLote(['a', 'c'], (id) => banco.rpc('excluir_solicitacao_pendente', { p_id: id }));
  assert.deepEqual(res.sucesso, ['a']);
  assert.deepEqual(res.falhas.map((f) => [f.id, f.motivo]), [['c', 'não está mais pendente ou já tem pedido vinculado']]);
  assert.equal(banco.db.has('c'), true, 'item protegido continua existindo');
  const resumo = resumirResultadoLote(res, 'excluir', { c: 'Açúcar' });
  assert.equal(resumo.titulo, '1 de 2 solicitações excluída. 1 não pôde ser excluída.');
  assert.deepEqual(resumo.detalhes, ['Açúcar: não está mais pendente ou já tem pedido vinculado']);
});

test('excluir em lote: sem permissão -> nada é excluído', async () => {
  const banco = bancoFalso(lista, { permissoes: { podeRealizar: true, podeExcluir: false } });
  const res = await executarEmLote(['a', 'b'], (id) => banco.rpc('excluir_solicitacao_pendente', { p_id: id }));
  assert.equal(res.sucesso.length, 0);
  assert.equal(banco.db.size, lista.length);
});

test('motivoFalha: mensagens desconhecidas viram texto genérico (nunca vaza erro técnico)', () => {
  assert.equal(motivoFalha({ message: 'JWT expired' }), 'erro inesperado ao processar');
  assert.equal(motivoFalha(null), 'erro inesperado ao processar');
});

// ------------------------------------------------------------ REGRESSÃO (estática)
test('regressão: página usa as MESMAS RPCs/parâmetros nas ações individuais e em lote', () => {
  const pagina = ler('pages/pedidos/solicitacoes.js');
  // individuais preservadas
  assert.match(pagina, /supabase\.rpc\('excluir_solicitacao_pendente', \{ p_id: confirmarExclusao\.id \}\)/);
  assert.match(pagina, /supabase\.rpc\('marcar_solicitacao_realizada', \{\s*p_id: confirmarRealizacao\.id,\s*p_observacao_realizacao: observacaoRealizacao\.trim\(\) \|\| null,\s*\}\)/);
  // lote reaproveita as mesmas
  assert.match(pagina, /supabase\.rpc\('marcar_solicitacao_realizada', \{ p_id: id, p_observacao_realizacao: observacao \}\)/);
  assert.match(pagina, /supabase\.rpc\('excluir_solicitacao_pendente', \{ p_id: id \}\)/);
  // nenhuma RPC/tabela nova
  const rpcs = new Set([...pagina.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...rpcs].sort(), [
    'concluir_solicitacao_com_pedido',
    'excluir_pedido_com_solicitacoes',
    'excluir_solicitacao_pendente',
    'marcar_solicitacao_realizada',
    'reabrir_recebimento_pedido',
  ]);
  // exclusão em lote sempre passa por confirmação explícita
  assert.match(pagina, /Esta ação não pode ser desfeita\./);
  assert.match(pagina, /confirmarLote === 'excluir'/);
});

test('regressão: ações individuais da lista continuam com as mesmas condições', () => {
  const listaSrc = ler('components/pedidos/SolicitacoesLista.js');
  assert.match(listaSrc, /pendente && podeExcluir && \{ chave: 'excluir'/);
  assert.match(listaSrc, /pendente && podeRealizar && \{ chave: 'realizada'/);
  assert.match(listaSrc, /selecao=\{selecao\}/);
});
