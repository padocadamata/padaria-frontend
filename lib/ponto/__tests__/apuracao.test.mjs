// node --test lib/ponto/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apuracaoParaExibir, apurarCartao, divergenciasDoSnapshot } from '../apuracao.js';
import { duracao, formatarMinutos, lacunas, paraMinutos } from '../tempo.js';
import { CASOS, FOLGA, base, dia, lancamento, trabalho } from './casos.mjs';

function subconjunto(obtido, esperado, rotulo) {
  for (const [chave, valor] of Object.entries(esperado)) {
    assert.deepEqual(obtido[chave], valor, `${rotulo}: ${chave}`);
  }
}

for (const caso of CASOS) {
  test(`apuração: ${caso.nome}`, () => {
    const r = apurarCartao(caso.base);
    if (caso.dia) subconjunto(r.dias[0], caso.dia, caso.nome);
    for (const [data, esperado] of Object.entries(caso.dias || {})) {
      subconjunto(r.dias.find((d) => d.data === data), esperado, `${caso.nome} ${data}`);
    }
    if (caso.totais) subconjunto(r.totais, caso.totais, caso.nome);
    if (caso.encerrada !== undefined) assert.equal(r.competencia_encerrada, caso.encerrada);
  });
}

test('tempo: minutos, formatação e lacunas', () => {
  assert.equal(paraMinutos('06:30'), 390);
  assert.equal(paraMinutos('06:30:59'), 390);
  assert.equal(paraMinutos('x'), null);
  assert.equal(formatarMinutos(0), '00:00');
  assert.equal(formatarMinutos(1785), '29:45');
  assert.equal(formatarMinutos(null), '');
  assert.equal(duracao([{ inicio: '06:00', fim: '09:00' }, { inicio: '08:00', fim: '10:00' }]), 240, 'sobreposição conta uma vez');
  assert.equal(lacunas([{ inicio: '06:00', fim: '09:00' }, { inicio: '09:00', fim: '12:00' }]), 0, 'períodos encostados');
});

test('competência em andamento: dia do vínculo no futuro', () => {
  const r = apurarCartao(base([
    dia('2026-11-19', { escala: FOLGA }),
    dia('2026-11-21', { escala: trabalho(['06:00', '12:00']) }),
  ], { competencia: '2026-11-01' }));
  assert.equal(r.competencia_encerrada, false);
  assert.equal(r.totais.previsto_min, 0, 'dia futuro fora dos totais');
  assert.equal(r.totais.dias_pendentes, 0);
});

test('competência inteira fora do vínculo não está "encerrada" (nada a fechar)', () => {
  const r = apurarCartao(base([dia('2026-10-05', { vinculo: 'freelancer' })]));
  assert.equal(r.competencia_encerrada, false);
});

test('cartão fechado: exibe SÓ o snapshot, mesmo com a Escala atual diferente', () => {
  const original = base([dia('2026-10-05', { escala: trabalho(['06:00', '12:00']), lanc: lancamento({ periodos: [['06:00', '12:00']] }) })]);
  const snapshot = { base: original, apuracao: apurarCartao(original) };
  // Depois do fechamento a Escala do dia virou folga.
  const atual = { ...base([dia('2026-10-05', { escala: FOLGA, lanc: lancamento({ periodos: [['06:00', '12:00']] }) })]), cartao: { status: 'fechado', snapshot } };
  const exibido = apuracaoParaExibir(atual);
  assert.equal(exibido.origem, 'snapshot');
  assert.equal(exibido.apuracao.dias[0].previsto_min, 360);
  assert.deepEqual(exibido.apuracao.dias[0].pendencias, []);
  assert.deepEqual(divergenciasDoSnapshot(snapshot.base, atual), ['2026-10-05']);
  assert.deepEqual(divergenciasDoSnapshot(snapshot.base, original), []);

  const aberto = apuracaoParaExibir({ ...atual, cartao: { status: 'em_preenchimento' } });
  assert.equal(aberto.origem, 'atual');
  assert.deepEqual(aberto.apuracao.dias[0].pendencias, ['escala_incoerente']);
});

test('identidade do dia: previsto = no previsto + atestado + não coberto; trabalhado = no + fora do previsto', () => {
  for (const caso of CASOS) {
    for (const d of apurarCartao(caso.base).dias) {
      if (d.previsto_min === null || d.trabalhado_no_previsto_min === null) continue;
      assert.equal(d.previsto_min, d.trabalhado_no_previsto_min + d.atestado_min + d.previsto_nao_coberto_min, `${caso.nome} ${d.data}`);
      assert.equal(d.trabalhado_min, d.trabalhado_no_previsto_min + d.trabalhado_fora_previsto_min, `${caso.nome} ${d.data}`);
      assert.ok(d.extra_min === 0 || d.faltante_min === 0, 'extra e faltante nunca juntos no mesmo dia');
    }
  }
});

test('nenhum valor em R$: a apuração só tem minutos e contagens', () => {
  const r = apurarCartao(CASOS.at(-1).base);
  const chaves = [...Object.keys(r.totais), ...Object.keys(r.dias[0])];
  assert.ok(chaves.every((c) => !/valor|preco|r\$|desconto|salario/i.test(c)), chaves.join(','));
});
