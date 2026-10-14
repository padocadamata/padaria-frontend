// node --test --import ./lib/funcionarios/__tests__/resolverImports.mjs lib/producao/__tests__/linhasHoje.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarLinhasHoje, filtrarLinhasHoje, tiposDasLinhas, contarFiltrosHojeAtivos, SITUACOES_TURNO, FILTROS_HOJE_PADRAO } from '../linhasHoje.js';

const TURNOS = [
  { chave: 'manha', label: 'Manhã' },
  { chave: 'tarde', label: 'Tarde' },
];
// Ordem dos blocos = ordem da tela (Francês primeiro, já resolvido por quem monta).
const blocos = [
  { receitaId: 'fr', receitaNome: 'Francês' },
  { receitaId: 'cr', receitaNome: 'Croissant' },
  { receitaId: 'bo', receitaNome: 'Bolo de Cenoura' },
];
const registros = {
  'fr:manha': { id: 1, status: 'fechado' },
  'fr:tarde': { id: 2, status: 'aberto' },
  'cr:manha': { id: 3, status: 'reaberto' },
  'bo:tarde': { id: 4, status: 'aberto' },
};
const linhas = montarLinhasHoje({
  blocos,
  turnos: TURNOS,
  registroDoBloco: (r, t) => registros[`${r}:${t}`],
  tipoPorReceita: { fr: 'Pães', cr: 'Pães', bo: 'Bolos' },
});
const resumo = (ls) => ls.map((l) => `${l.receitaId}:${l.turno}:${l.situacao}${l.primeiraDoProduto ? '*' : ''}`);

test('uma linha por Produto × Turno, na ordem da tela (Francês primeiro; Manhã antes de Tarde)', () => {
  assert.deepEqual(resumo(linhas), [
    'fr:manha:fechado*', 'fr:tarde:aberto',
    'cr:manha:reaberto*', 'cr:tarde:sem_producao',
    'bo:manha:sem_producao*', 'bo:tarde:aberto',
  ]);
  assert.equal(linhas[0].chave, 'fr:manha');
  assert.equal(linhas[3].registro, null);
});

test('filtros padrão (Todos/Todos/Todos) não escondem nada', () => {
  assert.deepEqual(resumo(filtrarLinhasHoje(linhas, FILTROS_HOJE_PADRAO)), resumo(linhas));
  assert.equal(contarFiltrosHojeAtivos(FILTROS_HOJE_PADRAO), 0);
});

test('filtro de Turno: só as linhas daquele turno; a 1ª visível de cada produto mostra o nome', () => {
  assert.deepEqual(resumo(filtrarLinhasHoje(linhas, { turno: 'tarde' })), ['fr:tarde:aberto*', 'cr:tarde:sem_producao*', 'bo:tarde:aberto*']);
});

test('filtro de Situação usa os estados reais (inclui "sem produção")', () => {
  assert.deepEqual(resumo(filtrarLinhasHoje(linhas, { situacao: 'aberto' })), ['fr:tarde:aberto*', 'bo:tarde:aberto*']);
  assert.deepEqual(resumo(filtrarLinhasHoje(linhas, { situacao: 'sem_producao' })), ['cr:tarde:sem_producao*', 'bo:manha:sem_producao*']);
  assert.deepEqual(SITUACOES_TURNO.map((s) => s.valor), ['sem_producao', 'aberto', 'fechado', 'reaberto']);
});

test('filtro de Tipo e combinação dos três (E lógico); Francês continua primeiro', () => {
  assert.deepEqual(resumo(filtrarLinhasHoje(linhas, { tipo: 'Pães' })), ['fr:manha:fechado*', 'fr:tarde:aberto', 'cr:manha:reaberto*', 'cr:tarde:sem_producao']);
  const combinado = { tipo: 'Pães', situacao: 'aberto', turno: 'tarde' };
  assert.deepEqual(resumo(filtrarLinhasHoje(linhas, combinado)), ['fr:tarde:aberto*']);
  assert.equal(contarFiltrosHojeAtivos(combinado), 3);
  assert.deepEqual(filtrarLinhasHoje(linhas, { tipo: 'Bolos', turno: 'manha', situacao: 'fechado' }), []);
});

test('opções de Tipo: tipos reais presentes, sem vazios, em ordem alfabética pt-BR', () => {
  const comVazio = [...linhas, { tipo: null }, { tipo: 'éclairs' }, { tipo: 'Doces' }];
  assert.deepEqual(tiposDasLinhas(comVazio), ['Bolos', 'Doces', 'éclairs', 'Pães']);
});
