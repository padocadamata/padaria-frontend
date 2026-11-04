import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alertaAtestado, codigoDoErro, colunasPrincipais, igualAoPrevisto, itemVazio, periodosDasColunas, proximoPendente, repetirHorarios, validarAtestado, validarItemDia,
} from '../lancamento.js';
import { apurarCartao } from '../apuracao.js';
import { CASOS_ATESTADO, CASOS_VALIDACAO, FOLGA, FUNCIONARIA, HOJE, base, comOcorrencia, dia, lancamento, trabalho } from './casos.mjs';

const SEIS = trabalho(['06:00', '12:00']);
const ctx = (d, atestados = []) => ({ dia: d, funcionario: FUNCIONARIA, hoje: HOJE, atestados });

for (const caso of CASOS_VALIDACAO) {
  test(`validação do dia: ${caso.nome}`, () => {
    assert.equal(validarItemDia(caso.item, ctx(caso.d, caso.atestados)).erro?.codigo, caso.codigo);
  });
}

for (const caso of CASOS_ATESTADO) {
  test(`validação do atestado: ${caso.nome}`, () => {
    assert.equal(validarAtestado(caso.atestado, { outros: caso.outros || [] }).erro?.codigo ?? null, caso.codigo);
  });
}

test('validação: competência passada antiga é aceita (sem limite de antiguidade)', () => {
  const r = validarItemDia({ data: '2025-02-03', periodos: [{ entrada: '06:00', saida: '12:00' }] }, ctx(dia('2025-02-03', { escala: SEIS })));
  assert.equal(r.erro, undefined);
});

test('validação: situação igual à da Escala vira null (segue a Escala), sem exigir motivo', () => {
  const r = validarItemDia({ data: '2026-10-05', situacao: 'falta' }, ctx(dia('2026-10-05', { escala: comOcorrencia(SEIS, 'falta') })));
  assert.equal(r.item.situacao, null);
  assert.equal(r.item.motivo, null);
  assert.ok(itemVazio(r.item));
});

test('validação: dia sem Escala só vira folga por ajuste explícito com motivo', () => {
  assert.equal(validarItemDia({ data: '2026-10-05', situacao: 'folga' }, ctx(dia('2026-10-05'))).erro?.codigo, 'motivo_obrigatorio');
  const ok = validarItemDia({ data: '2026-10-05', situacao: 'folga', motivo: 'Folga combinada' }, ctx(dia('2026-10-05')));
  assert.equal(ok.item.situacao, 'folga');
});

test('validação: trabalho em folga com motivo + horários, ordenados por entrada', () => {
  const r = validarItemDia({
    data: '2026-10-05', situacao: 'trabalho', motivo: ' Cobriu colega ',
    periodos: [{ entrada: '13:00', saida: '15:00' }, { entrada: '08:00', saida: '12:00' }],
  }, ctx(dia('2026-10-05', { escala: FOLGA })));
  assert.equal(r.item.motivo, 'Cobriu colega');
  assert.deepEqual(r.item.periodos.map((p) => p.entrada), ['08:00', '13:00']);
});

test('atestado: parcial guarda horas; integral descarta horas enviadas', () => {
  const parcial = validarAtestado({ tipo: 'comparecimento', abrangencia: 'parcial', data_inicio: '2026-10-10', data_fim: '2026-10-10', hora_inicio: '08:00', hora_fim: '10:00', descricao: ' Consulta ' });
  assert.deepEqual(parcial.atestado, { tipo: 'comparecimento', abrangencia: 'parcial', data_inicio: '2026-10-10', data_fim: '2026-10-10', hora_inicio: '08:00', hora_fim: '10:00', descricao: 'Consulta' });
  const integral = validarAtestado({ tipo: 'atestado_medico', abrangencia: 'integral', data_inicio: '2026-10-10', data_fim: '2026-10-12', hora_inicio: '08:00', hora_fim: '10:00', descricao: 'x' });
  assert.equal(integral.atestado.hora_inicio, null);
  assert.equal(validarAtestado({ tipo: 'atestado_medico', abrangencia: 'integral', data_inicio: '2026-06-01', data_fim: '2026-08-29', descricao: 'x' }).erro, undefined, '90 dias exatos');
});

test('atestado longo: alerta de confirmação na tela, nunca bloqueio', () => {
  const at = (data_inicio, data_fim) => ({ tipo: 'atestado_medico', abrangencia: 'integral', data_inicio, data_fim });
  assert.equal(alertaAtestado(at('2026-11-19', '2027-03-19'), { hoje: HOJE }), null, 'afastamento de 4 meses: sem alerta');
  assert.equal(alertaAtestado(at('2026-01-01', '2026-12-31'), { hoje: HOJE }), null, '365 dias: sem alerta');
  const digitacao = alertaAtestado(at('2026-11-19', '2206-11-19'), { hoje: HOJE });
  assert.deepEqual(digitacao.motivos, ['fim_distante', 'duracao_longa']);
  assert.match(digitacao.mensagem, /19\/11\/2206/);
  assert.deepEqual(alertaAtestado(at('2016-11-19', '2026-11-19'), { hoje: HOJE }).motivos, ['duracao_longa'], 'início digitado errado');
  assert.equal(alertaAtestado(at('2026-11-19', '2026-11-10'), { hoje: HOJE }), null, 'período inválido fica com validarAtestado');
  // O alerta não muda a validação: o mesmo atestado é válido.
  assert.equal(validarAtestado(at('2026-11-19', '2206-11-19')).erro, undefined);
});

test('colunas: 4 campos <-> períodos (1, 2 e 3 períodos)', () => {
  const dois = [{ entrada: '06:00', saida: '09:00' }, { entrada: '09:15', saida: '12:00' }];
  assert.deepEqual(colunasPrincipais(dois), { entrada: '06:00', saida_intervalo: '09:00', retorno_intervalo: '09:15', saida: '12:00', extras: [] });
  assert.deepEqual(periodosDasColunas(colunasPrincipais(dois)), dois);
  const um = [{ entrada: '06:00', saida: '12:00' }];
  assert.deepEqual(colunasPrincipais(um).saida, '12:00');
  assert.deepEqual(periodosDasColunas(colunasPrincipais(um)), um);
  const tres = [...dois, { entrada: '15:00', saida: '17:00' }];
  assert.equal(colunasPrincipais(tres).extras.length, 1);
  assert.deepEqual(periodosDasColunas(colunasPrincipais(tres)), tres);
});

test('Igual ao previsto e Repetir horários', () => {
  assert.deepEqual(igualAoPrevisto(trabalho(['06:00', '09:00'], ['09:15', '12:00'])), [
    { entrada: '06:00', saida: '09:00' }, { entrada: '09:15', saida: '12:00' },
  ]);
  assert.deepEqual(igualAoPrevisto(FOLGA), []);
  const dias = [dia('2026-10-05', { escala: SEIS, lanc: lancamento({ observacao: 'manter' }) }), dia('2026-10-06', { escala: SEIS })];
  const lote = repetirHorarios(dias, ['2026-10-05', '2026-10-06'], [{ entrada: '06:00', saida: '12:00' }]);
  assert.equal(lote.length, 2);
  assert.equal(lote[0].observacao, 'manter');
  assert.deepEqual(lote[1].periodos, [{ entrada: '06:00', saida: '12:00' }]);
});

test('próximo pendente e código de erro da RPC', () => {
  const ap = apurarCartao(base([
    dia('2026-10-05', { escala: SEIS, lanc: lancamento({ periodos: [['06:00', '12:00']] }) }),
    dia('2026-10-06', { escala: FOLGA }),
    dia('2026-10-07', { escala: SEIS }),
  ]));
  assert.equal(proximoPendente(ap, '2026-10-05'), '2026-10-07');
  assert.equal(proximoPendente(ap, '2026-10-07'), null);
  assert.equal(codigoDoErro('folha_ponto: [cartao_alterado] o cartao foi alterado'), 'cartao_alterado');
  assert.equal(codigoDoErro('outra coisa'), null);
});
