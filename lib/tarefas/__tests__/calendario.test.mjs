// node --test lib/tarefas/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FILTROS_PADRAO,
  MAX_EXECUCOES,
  NOME_EXECUCAO_LEGADO,
  SITUACOES,
  validarNomeExecucao,
  abrevDiaSemana,
  agruparExecucoes,
  descreverSituacao,
  nomeExecucao,
  contarFiltrosAtivos,
  descreverSincronizacao,
  diasDoMes,
  montarMatriz,
  nomeVigente,
  ocorrenciaVisivel,
  opcoesResponsavel,
  progresso,
  resumoDoDia,
  rotuloCelula,
  rotuloResponsavel,
  somarMeses,
} from '../calendario.js';

let seq = 0;
const occ = (parcial) => ({
  id: `o${++seq}`,
  tarefa_id: 't1',
  data: '2026-10-05',
  origem: 'programada',
  posicao: 1,
  posicao_programada: 1,
  responsavel_nome: null,
  responsavel_avulso: null,
  ajustado_em: null,
  concluida: false,
  cancelada: false,
  ...parcial,
});

test('datas: 31 dias, virada de ano e dia da semana', () => {
  assert.equal(diasDoMes('2026-10-01').length, 31);
  assert.equal(diasDoMes('2026-10-01')[30], '2026-10-31');
  assert.equal(diasDoMes('2027-02-01').length, 28);
  assert.equal(diasDoMes('2028-02-01').length, 29);
  assert.equal(somarMeses('2026-12-01', 1), '2027-01-01');
  assert.equal(somarMeses('2026-01-01', -1), '2025-12-01');
  assert.equal(abrevDiaSemana('2026-10-31'), 'SÁB');
  assert.equal(abrevDiaSemana('2026-11-01'), 'DOM');
});

test('responsavel: avulso > nome materializado > F1/F2/F3', () => {
  assert.equal(rotuloResponsavel(occ({ posicao: 2 })), 'F2');
  assert.equal(rotuloResponsavel(occ({ responsavel_nome: 'Laura Souza' })), 'Laura Souza');
  assert.equal(rotuloResponsavel(occ({ responsavel_nome: 'Laura', responsavel_avulso: 'Joana' })), 'Joana');
  assert.equal(rotuloCelula(occ({ responsavel_nome: 'Laura Souza' })), 'Laura');
  assert.equal(rotuloCelula(occ({ posicao: 3 })), 'F3');
});

test('nomeVigente respeita vigencia por data', () => {
  const nomes = [
    { posicao: 1, vigente_desde: '2026-10-01', nome: 'Laura' },
    { posicao: 1, vigente_desde: '2026-10-15', nome: 'Maria' },
    { posicao: 2, vigente_desde: '2026-10-01', nome: null },
  ];
  assert.equal(nomeVigente(nomes, 1, '2026-09-30'), null);
  assert.equal(nomeVigente(nomes, 1, '2026-10-14'), 'Laura');
  assert.equal(nomeVigente(nomes, 1, '2026-10-15'), 'Maria');
  assert.equal(nomeVigente(nomes, 2, '2026-10-20'), null);
});

test('filtro por nome localiza so as ocorrencias daquele nome; por posicao, todas da posicao', () => {
  const lista = [
    occ({ data: '2026-10-10', responsavel_nome: 'Laura' }),
    occ({ data: '2026-10-20', responsavel_nome: 'Maria' }),
    occ({ data: '2026-10-21', posicao: 1, responsavel_avulso: 'Joana' }),
    occ({ data: '2026-10-22', posicao: 2 }),
  ];
  const opcoes = opcoesResponsavel(lista);
  assert.deepEqual(opcoes.map((o) => o.rotulo), ['F1', 'F2', 'F3', 'Joana (avulso)', 'Laura', 'Maria']);
  const f = (responsavel) => lista.filter((o) => ocorrenciaVisivel(o, { ...FILTROS_PADRAO, responsavel })).map((o) => o.data);
  assert.deepEqual(f('nome:laura'), ['2026-10-10']);
  assert.deepEqual(f('nome:joana'), ['2026-10-21']);
  assert.deepEqual(f('posicao:1'), ['2026-10-10', '2026-10-20', '2026-10-21']);
  assert.deepEqual(f('posicao:2'), ['2026-10-22']);
});

test('filtro de situacao: pendentes exclui canceladas', () => {
  const a = occ({ concluida: true });
  const b = occ({});
  const c = occ({ cancelada: true });
  const vis = (situacao) => [a, b, c].filter((o) => ocorrenciaVisivel(o, { ...FILTROS_PADRAO, situacao })).map((o) => o.id);
  assert.deepEqual(vis(SITUACOES.TODAS), [a.id, b.id, c.id]);
  assert.deepEqual(vis(SITUACOES.PENDENTES), [b.id]);
  assert.deepEqual(vis(SITUACOES.CONCLUIDAS), [a.id]);
  assert.equal(contarFiltrosAtivos(FILTROS_PADRAO), 0);
  assert.equal(contarFiltrosAtivos({ responsavel: 'posicao:1', situacao: SITUACOES.PENDENTES, categoria: 'LIMPEZA' }), 3);
});

test('montarMatriz: secoes, inativas com historico e filtros', () => {
  const categorias = [{ valor: 'FECHAMENTO', ordem: 3 }, { valor: 'LIMPEZA', ordem: 1 }];
  const tarefas = [
    { id: 't1', descricao: 'Coifa', categoria: 'LIMPEZA', ordem: 1, ativo: true },
    { id: 't2', descricao: 'Antiga', categoria: 'LIMPEZA', ordem: 2, ativo: false },
    { id: 't3', descricao: 'Inativa sem uso', categoria: 'LIMPEZA', ordem: 3, ativo: false },
    { id: 't4', descricao: 'Louça', categoria: 'FECHAMENTO', ordem: 1, ativo: true },
  ];
  const regrasPorTarefa = new Map([['t4', [{ vigente_desde: '2026-10-01', tipo: 'diaria', grupo_id: 'g1' }]]]);
  const ocorrencias = [
    occ({ tarefa_id: 't1', data: '2026-10-14', posicao: 1, concluida: true }),
    occ({ tarefa_id: 't2', data: '2026-10-02', posicao: 2 }),
    occ({ tarefa_id: 't4', data: '2026-10-02', posicao: 3 }),
  ];
  const base = { categorias, tarefas, regrasPorTarefa, ocorrencias, dataReferencia: '2026-10-10' };

  const todas = montarMatriz(base);
  assert.deepEqual(todas.map((s) => s.categoria.valor), ['LIMPEZA', 'FECHAMENTO']);
  assert.deepEqual(todas[0].linhas.map((l) => l.tarefa.id), ['t1', 't2']);
  assert.equal('grupo' in todas[1].linhas[0], false, 'grupo de distribuicao nao vai para a matriz');
  assert.equal(todas[1].linhas[0].regra.tipo, 'diaria');

  const pendentes = montarMatriz({ ...base, filtros: { ...FILTROS_PADRAO, situacao: SITUACOES.PENDENTES } });
  assert.deepEqual(pendentes.flatMap((s) => s.linhas.map((l) => l.tarefa.id)), ['t2', 't4']);
  const linhaT2 = pendentes[0].linhas[0];
  assert.equal(linhaT2.ocorrencias.size, 1);
  assert.equal(linhaT2.todasOcorrencias.size, 1);

  const categoria = montarMatriz({ ...base, filtros: { ...FILTROS_PADRAO, categoria: 'FECHAMENTO' } });
  assert.deepEqual(categoria.map((s) => s.categoria.valor), ['FECHAMENTO']);
});

test('resumoDoDia agrupa por responsavel na ordem F1, F2, F3 e calcula progresso', () => {
  const tarefasPorId = new Map([
    ['a', { id: 'a', categoria: 'LIMPEZA', ordem: 1 }],
    ['b', { id: 'b', categoria: 'FECHAMENTO', ordem: 1 }],
    ['c', { id: 'c', categoria: 'LIMPEZA', ordem: 2 }],
  ]);
  const categorias = [{ valor: 'LIMPEZA', ordem: 1 }, { valor: 'FECHAMENTO', ordem: 3 }];
  const dia = '2026-10-07';
  const lista = [
    occ({ tarefa_id: 'b', data: dia, posicao: 3, concluida: true }),
    occ({ tarefa_id: 'c', data: dia, posicao: 1, responsavel_nome: 'Laura' }),
    occ({ tarefa_id: 'a', data: dia, posicao: 1, responsavel_nome: 'Laura', concluida: true }),
    occ({ tarefa_id: 'a', data: '2026-10-08', posicao: 2 }),
    occ({ tarefa_id: 'c', data: dia, posicao: 2, cancelada: true, tarefa: 'x' }),
  ];
  const r = resumoDoDia({ ocorrencias: lista, data: dia, tarefasPorId, categorias });
  assert.deepEqual(r.grupos.map((g) => g.rotulo), ['Laura', 'F2', 'F3']);
  assert.deepEqual(r.grupos[0].itens.map((o) => o.tarefa_id), ['a', 'c']);
  assert.deepEqual(r.progresso, { total: 3, concluidas: 2, canceladas: 1 });
  assert.deepEqual(progresso([]), { total: 0, concluidas: 0, canceladas: 0 });
});

test('descreverSincronizacao resume a previa', () => {
  const linhas = descreverSincronizacao({ criadas: 1, removidas: 2, nomes_atualizados: 0, preservadas: 3 });
  assert.equal(linhas[0], '1 ocorrência será criada');
  assert.equal(linhas[1], '2 ocorrências futuras ainda não tocadas serão removidas');
  assert.equal(linhas.length, 3);
});

test('ordem por frequencia: menos frequente -> diarias -> sem programacao, estavel no empate', () => {
  const categorias = [{ valor: 'LIMPEZA', ordem: 1 }];
  const t = (id, ordem, descricao) => ({ id, descricao, categoria: 'LIMPEZA', ordem, ativo: true });
  const tarefas = [
    t('diaria', 1, 'Vidros externos'),
    t('tres', 2, 'Tres por semana'),
    t('semanalB', 5, 'Semanal B'),
    t('quinzenal', 9, 'Coifa'),
    t('duas', 3, 'Duas por semana'),
    t('semanalA', 4, 'Semanal A'),
    t('sem', 6, 'Sem programacao'),
    t('fds', 7, 'Suco'),
  ];
  const r = (tipo, dias = null, semanas = null) => [{ vigente_desde: '2026-10-01', tipo, dias_semana: dias, semanas_do_mes: semanas }];
  const regrasPorTarefa = new Map([
    ['diaria', r('diaria')], ['tres', r('dias_semana', [1, 3, 5])], ['semanalB', r('dias_semana', [2])],
    ['quinzenal', r('semanas_do_mes', [3], [2, 4])], ['duas', r('dias_semana', [2, 5])], ['semanalA', r('dias_semana', [1])],
    ['sem', r('sem_programacao')], ['fds', r('dias_semana', [6, 7])],
  ]);
  const secoes = montarMatriz({ categorias, tarefas, regrasPorTarefa, ocorrencias: [], dataReferencia: '2026-10-10' });
  assert.deepEqual(secoes[0].linhas.map((l) => l.tarefa.id), ['quinzenal', 'semanalA', 'semanalB', 'duas', 'fds', 'tres', 'diaria', 'sem']);
});

test('execucoes: status 0 = Pendente, >=1 = Concluida, maximo 2, nomes livres', () => {
  const o = occ({ concluida: false });
  assert.equal(MAX_EXECUCOES, 2);
  assert.equal(descreverSituacao(o, []), 'Pendente');
  const e1 = { id: 'e1', ocorrencia_id: o.id, ordem: 2, responsavel_nome: 'Sabrina', concluido_em: '2026-10-06T18:00:00+00:00' };
  const e2 = { id: 'e2', ocorrencia_id: o.id, ordem: 1, responsavel_nome: 'Laura', concluido_em: '2026-10-06T11:00:00+00:00' };
  const mapa = agruparExecucoes([e1, e2]);
  assert.deepEqual(mapa.get(o.id).map((e) => e.responsavel_nome), ['Laura', 'Sabrina']);
  assert.equal(descreverSituacao({ ...o, concluida: true }, mapa.get(o.id)), 'Concluída — Laura e Sabrina');
  assert.equal(descreverSituacao({ ...o, concluida: true }, [e1]), 'Concluída — Sabrina');
  assert.equal(descreverSituacao({ ...o, concluida: true }, [{ ...e1, responsavel_nome: null }]), 'Concluída');
  assert.equal(nomeExecucao({ responsavel_nome: null }), 'nome não informado');
  assert.equal(descreverSituacao(occ({ cancelada: true, cancelado_motivo: 'Loja fechada' }), []), 'Cancelada — Loja fechada');
});

test('frontend nao bloqueia conclusao futura e nao exibe grupos no calendario', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const ler = (arq) => readFileSync(join(raiz, arq), 'utf8');
  for (const arq of ['components/tarefas/TarefasMatriz.js', 'components/tarefas/ResumoDia.js', 'components/tarefas/OcorrenciaModal.js', 'pages/funcionarios/tarefas/index.js']) {
    const fonte = ler(arq);
    assert.equal(/<= hoje/.test(fonte), false, `${arq} ainda compara data com hoje para concluir`);
    assert.equal(/só podem ser concluídas no dia/.test(fonte), false, arq);
  }
  for (const arq of ['components/tarefas/TarefasMatriz.js', 'components/tarefas/ResumoDia.js', 'pages/funcionarios/tarefas/cadastro.js']) {
    assert.equal(/grupo\.nome|seloGrupo|grupoPorId/.test(ler(arq)), false, `${arq} exibe grupo`);
  }
});

test('nome de execucao obrigatorio (mesma regra do banco) e marcador legado', () => {
  assert.equal(validarNomeExecucao(''), 'Informe o nome de quem executou.');
  assert.equal(validarNomeExecucao('    '), 'Informe o nome de quem executou.');
  assert.equal(validarNomeExecucao(null), 'Informe o nome de quem executou.');
  assert.equal(validarNomeExecucao(undefined), 'Informe o nome de quem executou.');
  assert.equal(validarNomeExecucao('x'.repeat(61)), 'O nome pode ter no máximo 60 caracteres.');
  assert.equal(validarNomeExecucao('x'.repeat(60)), null);
  assert.equal(validarNomeExecucao('  Laura  '), null);
  assert.equal(NOME_EXECUCAO_LEGADO, 'NÃO INFORMADO');
});

test('frontend exige nome antes de registrar/adicionar/renomear e nunca registra sem nome', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const modal = readFileSync(join(raiz, 'components/tarefas/OcorrenciaModal.js'), 'utf8');
  assert.match(modal, /disabled=\{salvando \|\| Boolean\(validarNomeExecucao\(nomeExecutor\)\)\}/, 'Registrar/Adicionar 2a execucao');
  assert.match(modal, /disabled=\{salvando \|\| Boolean\(validarNomeExecucao\(editando\.nome\)\)\}/, 'Salvar novo nome');
  const pagina = readFileSync(join(raiz, 'pages/funcionarios/tarefas/index.js'), 'utf8');
  assert.equal(/registrarExecucao\(/.test(pagina), false, 'checkbox nao registra sem nome: abre o detalhe');
});
