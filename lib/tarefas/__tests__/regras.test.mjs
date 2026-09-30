// node --test lib/tarefas/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIPOS_REGRA,
  dataReferenciaRegra,
  descreverRegra,
  formularioParaRegra,
  frequenciaCurta,
  mesmaProgramacao,
  pesoFrequencia,
  primeiraDataAlteracao,
  proximaVersao,
  regraParaFormulario,
  regraReferencia,
  regraVigente,
  validarFormularioRegra,
} from '../regras.js';

const r = (tipo, dias = null, semanas = null, extra = {}) => ({ tipo, dias_semana: dias, semanas_do_mes: semanas, ...extra });

test('descreverRegra usa linguagem humana (nunca deslocamento)', () => {
  assert.equal(descreverRegra(r('diaria')), 'Diária');
  assert.equal(descreverRegra(r('sem_programacao')), 'Sem programação automática');
  assert.equal(descreverRegra(null), 'Sem programação automática');
  assert.equal(descreverRegra(r('dias_semana', [3])), 'Semanal — quarta');
  assert.equal(descreverRegra(r('dias_semana', [5, 2])), '2x por semana — Ter e Sex');
  assert.equal(descreverRegra(r('dias_semana', [1, 3, 5])), '3x por semana — Seg, Qua e Sex');
  assert.equal(descreverRegra(r('dias_semana', [6, 7])), 'Sábado e domingo');
  assert.equal(descreverRegra(r('dias_semana', [1, 2, 3, 4, 5, 6, 7])), 'Todos os dias');
  assert.equal(descreverRegra(r('semanas_do_mes', [3], [2, 4])), 'Quinzenal — 2ª e 4ª quarta do mês');
  assert.equal(descreverRegra(r('semanas_do_mes', [1], [1])), '1ª segunda do mês');
});

test('frequenciaCurta para a coluna da matriz', () => {
  assert.equal(frequenciaCurta(r('diaria')), 'Diária');
  assert.equal(frequenciaCurta(r('dias_semana', [2])), '1x/sem');
  assert.equal(frequenciaCurta(r('dias_semana', [1, 5])), '2x/sem');
  assert.equal(frequenciaCurta(r('dias_semana', [6, 7])), 'Sáb/Dom');
  assert.equal(frequenciaCurta(r('semanas_do_mes', [3], [2, 4])), 'Quinzenal');
  assert.equal(frequenciaCurta(r('sem_programacao')), '—');
});

test('formulario <-> regra normaliza e valida', () => {
  assert.deepEqual(formularioParaRegra({ tipo: 'dias_semana', dias: [5, 2, 2], semanas: [1] }), { tipo: 'dias_semana', dias_semana: [2, 5], semanas_do_mes: null });
  assert.deepEqual(formularioParaRegra({ tipo: 'diaria', dias: [1], semanas: [2] }), { tipo: 'diaria', dias_semana: null, semanas_do_mes: null });
  assert.deepEqual(regraParaFormulario(r('semanas_do_mes', [3], [4, 2])), { tipo: 'semanas_do_mes', dias: [3], semanas: [2, 4] });
  assert.equal(validarFormularioRegra({ tipo: 'dias_semana', dias: [], semanas: [] }), 'Marque ao menos um dia da semana.');
  assert.equal(validarFormularioRegra({ tipo: 'semanas_do_mes', dias: [3], semanas: [] }), 'Marque ao menos uma semana do mês.');
  assert.equal(validarFormularioRegra({ tipo: 'diaria', dias: [], semanas: [] }), null);
  assert.equal(validarFormularioRegra({ tipo: 'x', dias: [], semanas: [] }), 'Escolha a frequência.');
});

test('mesmaProgramacao compara tipo, dias, semanas e grupo', () => {
  assert.equal(mesmaProgramacao(r('dias_semana', [2, 5]), r('dias_semana', [5, 2])), true);
  assert.equal(mesmaProgramacao(r('dias_semana', [2, 5]), r('dias_semana', [2])), false);
  assert.equal(mesmaProgramacao(r('diaria', null, null, { grupo_id: 'g1' }), r('diaria', null, null, { grupo_id: 'g1' })), true);
  assert.equal(mesmaProgramacao(r('diaria', null, null, { grupo_id: 'g1' }), r('diaria')), false);
  assert.equal(mesmaProgramacao(null, r('diaria')), false);
});

test('regraVigente e proximaVersao por data', () => {
  const regras = [
    { id: 'a', vigente_desde: '2026-10-01', tipo: TIPOS_REGRA.DIAS_SEMANA, dias_semana: [3] },
    { id: 'b', vigente_desde: '2026-10-15', tipo: TIPOS_REGRA.DIAS_SEMANA, dias_semana: [2, 5] },
  ];
  assert.equal(regraVigente(regras, '2026-09-30'), null);
  assert.equal(regraVigente(regras, '2026-10-14').id, 'a');
  assert.equal(regraVigente(regras, '2026-10-15').id, 'b');
  assert.equal(proximaVersao(regras, '2026-10-10').id, 'b');
  assert.equal(proximaVersao(regras, '2026-10-15'), null);
});

test('pesoFrequencia: ocorrencias por semana', () => {
  assert.equal(pesoFrequencia(r('diaria')), 7);
  assert.ok(pesoFrequencia(r('sem_programacao')) > pesoFrequencia(r('diaria')), 'sem programacao depois das diarias');
  assert.equal(pesoFrequencia(null), pesoFrequencia(r('sem_programacao')));
  assert.equal(pesoFrequencia(r('dias_semana', [1, 3, 5])), 3);
  assert.equal(pesoFrequencia(r('dias_semana', [6, 7])), 2);
  assert.ok(pesoFrequencia(r('semanas_do_mes', [3], [2, 4])) < pesoFrequencia(r('dias_semana', [3])));
});

test('tarefa que ainda nao comecou: referencia = 1a versao (rename nao vira mudanca de programacao)', () => {
  // Carga da 0061: regra so a partir de 01/10; hoje = 30/09.
  const diaria = { id: 'r1', vigente_desde: '2026-10-01', tipo: 'diaria', dias_semana: null, semanas_do_mes: null, grupo_id: null };
  assert.equal(regraVigente([diaria], '2026-09-30'), null, 'era isso que o modal usava: nenhuma regra');
  assert.equal(dataReferenciaRegra([diaria], '2026-09-30'), '2026-10-01');
  assert.equal(regraReferencia([diaria], '2026-09-30'), diaria);
  assert.equal(mesmaProgramacao(regraReferencia([diaria], '2026-09-30'), { tipo: 'diaria', dias_semana: null, semanas_do_mes: null, grupo_id: null }), true);
  // Ja vigente: referencia continua sendo hoje.
  assert.equal(dataReferenciaRegra([diaria], '2026-10-05'), '2026-10-05');
  assert.equal(dataReferenciaRegra([], '2026-09-30'), '2026-09-30');
  assert.equal(regraReferencia([], '2026-09-30'), null);
});

test('primeira data aceita para nova versao: >= hoje e >= ultima versao gravada', () => {
  const v = (vigente_desde, tipo = 'diaria') => ({ vigente_desde, tipo, dias_semana: null, semanas_do_mes: null, grupo_id: null });
  assert.equal(primeiraDataAlteracao([v('2026-10-01')], '2026-09-30'), '2026-10-01', 'inativar/reativar em 30/09 seria recusado');
  assert.equal(primeiraDataAlteracao([v('2026-10-01')], '2026-10-10'), '2026-10-10');
  assert.equal(primeiraDataAlteracao([v('2026-10-01'), v('2026-11-01', 'sem_programacao')], '2026-10-10'), '2026-11-01');
  assert.equal(primeiraDataAlteracao([], '2026-09-30'), '2026-09-30');
});
