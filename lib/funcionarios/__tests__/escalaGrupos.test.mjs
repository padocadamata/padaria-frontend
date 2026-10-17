// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/funcionarios/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparPorCargo,
  ordenarDentroDosGrupos,
  funcionariasDosGrupos,
  rotuloQuantidadeFuncionarias,
  estadoSelecaoGrupo,
  alternarSelecaoGrupo,
  ROTULO_SEM_CARGO,
  ROTULO_CARGO_SEM_NOME,
} from '../escalaGrupos.js';
import { aplicarOrdenacao } from '../../ordenacao/tabela.js';

const func = (id, nome, cargoId, cargoNome) => ({
  id,
  nome,
  ativo: true,
  cargo_id: cargoId,
  funcionarios_cargos: cargoId ? (cargoNome === undefined ? null : { nome: cargoNome }) : null,
});

// Ordem recebida = a da página (order('nome') do banco).
const equipe = [
  func('f1', 'Ana', 'c-padeira', 'Padeira'),
  func('f2', 'Bia', null),
  func('f3', 'Carla', 'c-atendente', 'Atendente de Padaria'),
  func('f4', 'Dani', 'c-sem-nome', undefined),
  func('f5', 'Eva', 'c-padeira', 'Padeira'),
  func('f6', 'Fran', 'c-auxiliar', 'auxiliar de cozinha'),
  func('f7', 'Gabi', 'c-atendente', 'Atendente de Padaria'),
  func('f8', 'Helô', 'c-edicao', 'Édição'),
];

test('grupos: cada funcionária aparece exatamente uma vez', () => {
  const grupos = agruparPorCargo(equipe);
  const ids = funcionariasDosGrupos(grupos).map((f) => f.id);
  assert.equal(ids.length, equipe.length);
  assert.deepEqual([...ids].sort(), equipe.map((f) => f.id).sort());
});

test('grupos: alfabética pt-BR (sem diferenciar maiúsculas/acentos), sem nome, e "Sem cargo definido" por último', () => {
  const grupos = agruparPorCargo(equipe);
  assert.deepEqual(grupos.map((g) => g.nome), ['Atendente de Padaria', 'auxiliar de cozinha', 'Édição', 'Padeira', ROTULO_CARGO_SEM_NOME, ROTULO_SEM_CARGO]);
  assert.deepEqual(grupos.map((g) => g.cargoId), ['c-atendente', 'c-auxiliar', 'c-edicao', 'c-padeira', 'c-sem-nome', null]);
});

test('grupos: ordem recebida preservada dentro do grupo e nenhum grupo vazio', () => {
  const grupos = agruparPorCargo(equipe);
  assert.deepEqual(grupos.find((g) => g.cargoId === 'c-atendente').funcionarios.map((f) => f.nome), ['Carla', 'Gabi']);
  assert.deepEqual(grupos.find((g) => g.cargoId === 'c-padeira').funcionarios.map((f) => f.nome), ['Ana', 'Eva']);
  assert.ok(grupos.every((g) => g.funcionarios.length > 0));
  assert.deepEqual(agruparPorCargo([]), []);
  assert.deepEqual(agruparPorCargo(undefined), []);
});

test('grupos: cargo com nome indisponível não perde a funcionária', () => {
  const grupo = agruparPorCargo(equipe).find((g) => g.cargoId === 'c-sem-nome');
  assert.equal(grupo.nome, ROTULO_CARGO_SEM_NOME);
  assert.deepEqual(grupo.funcionarios.map((f) => f.id), ['f4']);
  // nome só com espaços também vale como indisponível
  assert.equal(agruparPorCargo([func('x', 'X', 'c9', '   ')])[0].nome, ROTULO_CARGO_SEM_NOME);
});

test('grupos: dois cargos com o mesmo nome continuam separados, em ordem determinística por cargo_id', () => {
  const grupos = agruparPorCargo([func('a', 'A', 'c-2', 'Caixa'), func('b', 'B', 'c-1', 'Caixa')]);
  assert.deepEqual(grupos.map((g) => g.cargoId), ['c-1', 'c-2']);
  const invertido = agruparPorCargo([func('b', 'B', 'c-1', 'Caixa'), func('a', 'A', 'c-2', 'Caixa')]);
  assert.deepEqual(invertido.map((g) => g.cargoId), ['c-1', 'c-2']);
});

test('grupos: só sem cargo -> um único grupo "Sem cargo definido"', () => {
  const grupos = agruparPorCargo([func('a', 'A', null), func('b', 'B', null)]);
  assert.deepEqual(grupos.map((g) => [g.nome, g.funcionarios.length]), [[ROTULO_SEM_CARGO, 2]]);
});

test('ordenação do usuário vale dentro de TODOS os grupos e não muda a ordem dos cargos', () => {
  const grupos = agruparPorCargo(equipe);
  const colunas = [{ chave: 'nome', rotulo: 'Funcionário', ordenavel: true }];
  const desc = ordenarDentroDosGrupos(grupos, (lista) => aplicarOrdenacao(lista, colunas, { chave: 'nome', direcao: 'desc' }));
  assert.deepEqual(desc.map((g) => g.nome), grupos.map((g) => g.nome));
  assert.deepEqual(desc.find((g) => g.cargoId === 'c-atendente').funcionarios.map((f) => f.nome), ['Gabi', 'Carla']);
  assert.deepEqual(desc.find((g) => g.cargoId === 'c-padeira').funcionarios.map((f) => f.nome), ['Eva', 'Ana']);
  // grupos originais intocados
  assert.deepEqual(grupos.find((g) => g.cargoId === 'c-padeira').funcionarios.map((f) => f.nome), ['Ana', 'Eva']);
  // sem ordenação escolhida: ordem recebida
  const padrao = ordenarDentroDosGrupos(grupos, (lista) => aplicarOrdenacao(lista, colunas, null));
  assert.deepEqual(funcionariasDosGrupos(padrao).map((f) => f.id), funcionariasDosGrupos(grupos).map((f) => f.id));
});

test('rótulo de quantidade', () => {
  assert.equal(rotuloQuantidadeFuncionarias(1), '1 funcionária');
  assert.equal(rotuloQuantidadeFuncionarias(6), '6 funcionárias');
});

test('atalho do cargo: marca as que faltam, desmarca quando todas já estão, sem mexer nos outros grupos', () => {
  const doGrupo = ['f3', 'f7'];
  assert.equal(estadoSelecaoGrupo(doGrupo, []), 'nenhuma');
  assert.equal(estadoSelecaoGrupo(doGrupo, ['f7']), 'parcial');
  assert.equal(estadoSelecaoGrupo(doGrupo, ['f1', 'f3', 'f7']), 'todas');
  assert.equal(estadoSelecaoGrupo([], ['f1']), 'nenhuma');

  assert.deepEqual(alternarSelecaoGrupo(doGrupo, ['f1']), ['f1', 'f3', 'f7']);
  assert.deepEqual(alternarSelecaoGrupo(doGrupo, ['f7', 'f1']), ['f7', 'f1', 'f3']); // sem duplicar
  assert.deepEqual(alternarSelecaoGrupo(doGrupo, ['f1', 'f3', 'f7']), ['f1']); // desmarca só o grupo
});
