// Cartão-Ponto, Etapa 2: apresentação (estado do cartão, rascunho/lote,
// prévias, avisos, erros) e isolamento da interface (só RPCs da 0078,
// nada de Pagamentos).
//   node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/ponto/__tests__/apresentacao.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  STATUS_CARTAO, acoesDoCartao, avisosDoCartao, baseComRascunhos, cardsDeTotais, desviosDoDia, diaEditavel, diasAlterados, ehConflito,
  impactoDoAtestado, itemDoRascunho, leituraDoCartao, mensagemErroPonto, mesValido, montarLote, nomeArquivoCartao, rascunhoDoDia,
  rascunhoIgualAoPrevisto, resumoDaBase, rotuloAtestado, rotuloCompetencia, saldoDoDia, seloSituacao, somarMeses, statusDoCartao,
  statusDoResumo, textoPrevisto, leituraDoSaldo, resumoDoCartao,
} from '../apresentacao.js';
import { apurarCartao } from '../apuracao.js';
import { FOLGA, atestado, base, comOcorrencia, dia, lancamento, trabalho } from './casos.mjs';

const SEIS = trabalho(['06:00', '12:00']);
const comPeriodos = (...p) => lancamento({ periodos: p });

test('competência: navegação entre anos, rótulo, validação da URL', () => {
  assert.equal(somarMeses('2026-01', -1), '2025-12');
  assert.equal(somarMeses('2026-12', 1), '2027-01');
  assert.equal(somarMeses('2026-11', -25), '2024-10');
  assert.equal(rotuloCompetencia('2026-11-01'), 'Novembro/2026');
  assert.equal(mesValido('2026-11'), true);
  for (const ruim of ['2026-13', '2026-1', '', undefined, ['2026-11']]) assert.equal(mesValido(ruim), false, String(ruim));
});

test('saldo do dia: zero com desvios visíveis (06:30–12:30), extra e faltante líquidos', () => {
  const ap = apurarCartao(base([
    dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:30', '12:30']) }),
    dia('2026-10-06', { escala: SEIS, lanc: comPeriodos(['07:00', '13:30']) }),
    dia('2026-10-07', { escala: SEIS, lanc: comPeriodos(['05:00', '10:00']) }),
  ]));
  assert.deepEqual(saldoDoDia(ap.dias[0]), { minutos: 0, texto: '00:00', tom: 'neutral' });
  assert.equal(desviosDoDia(ap.dias[0]), 'fora do previsto 00:30 · não coberto 00:30');
  assert.equal(saldoDoDia(ap.dias[1]).texto, '+00:30');
  assert.equal(saldoDoDia(ap.dias[2]).texto, '−01:00');
  assert.equal(saldoDoDia({ extra_min: null, faltante_min: null }).texto, '—');
});

test('textos: previsto, situação considerada x Escala, atestado', () => {
  assert.equal(textoPrevisto(null), 'Não definido');
  assert.equal(textoPrevisto(FOLGA), 'Folga');
  assert.equal(textoPrevisto(trabalho(['06:00', '09:00'], ['09:15', '12:00'])), '06:00–09:00 · 09:15–12:00');
  assert.equal(textoPrevisto(comOcorrencia(SEIS, 'falta')), '06:00–12:00 · Falta');
  const ap = apurarCartao(base([dia('2026-10-05', { escala: comOcorrencia(SEIS, 'falta') })], { atestados: [atestado('2026-10-05')] }));
  assert.deepEqual(seloSituacao(ap.dias[0]), { rotulo: 'Atestado', tom: 'warning', origem: 'Escala: Falta', ajustado: false });
  assert.equal(rotuloAtestado(atestado('2026-10-05', '2026-10-09')), 'Atestado médico · 05/10/2026 a 09/10/2026 (5 dias)');
  assert.equal(rotuloAtestado(atestado('2026-10-05', '2026-10-05', { horas: ['08:00', '10:00'], tipo: 'comparecimento' })), 'Comparecimento · 05/10/2026 08:00–10:00');
});

test('status do cartão: não aberto, em preenchimento, conferido, desatualizado, fechado', () => {
  assert.equal(statusDoCartao(null), 'nao_aberto');
  assert.equal(statusDoCartao({ status: 'em_preenchimento', conferido_em: null }), 'em_preenchimento');
  assert.equal(statusDoCartao({ status: 'em_preenchimento', conferido_em: 'x', conferencia_atual: true }), 'conferido');
  assert.equal(statusDoCartao({ status: 'em_preenchimento', conferido_em: 'x', conferencia_atual: false }), 'conferencia_desatualizada');
  assert.equal(statusDoCartao({ status: 'fechado' }), 'fechado');
  assert.equal(statusDoResumo({ cartao_id: null }), 'nao_aberto');
  assert.equal(statusDoResumo({ cartao_id: 'c', status: 'em_preenchimento', conferido: true }), 'conferido');
  for (const s of Object.keys(STATUS_CARTAO)) assert.ok(STATUS_CARTAO[s].rotulo);
});

test('ações: conferir só encerrada e sem pendência; fechar só conferido; reabrir só fechado; abrir explícito', () => {
  const pode = { lancar: true, fechar: true, reabrir: true };
  const pend = { competencia_encerrada: true, totais: { dias_pendentes: 2 } };
  const ok = { competencia_encerrada: true, totais: { dias_pendentes: 0 } };
  const andamento = { competencia_encerrada: false, totais: { dias_pendentes: 0 } };
  assert.deepEqual(acoesDoCartao({ status: 'em_preenchimento', apuracao: pend, pode }).conferir, { visivel: true, habilitado: false, motivo: 'Há 2 dia(s) pendente(s).' });
  assert.equal(acoesDoCartao({ status: 'em_preenchimento', apuracao: andamento, pode }).conferir.motivo, 'A competência ainda não terminou.');
  assert.equal(acoesDoCartao({ status: 'em_preenchimento', apuracao: ok, pode }).conferir.habilitado, true);
  assert.equal(acoesDoCartao({ status: 'em_preenchimento', apuracao: ok, pode }).fechar.habilitado, false);
  assert.equal(acoesDoCartao({ status: 'conferido', apuracao: ok, pode }).fechar.habilitado, true);
  assert.equal(acoesDoCartao({ status: 'conferencia_desatualizada', apuracao: ok, pode }).fechar.motivo, 'Confira de novo antes de fechar.');
  assert.equal(acoesDoCartao({ status: 'fechado', apuracao: ok, pode }).reabrir.visivel, true);
  assert.equal(acoesDoCartao({ status: 'fechado', apuracao: ok, pode: { ...pode, reabrir: false } }).reabrir.visivel, false);
  assert.equal(acoesDoCartao({ status: 'fechado', apuracao: ok, pode }).lancar.visivel, false);
  assert.equal(acoesDoCartao({ status: 'nao_aberto', apuracao: ok, pode }).abrir.visivel, true);
  assert.equal(acoesDoCartao({ status: 'nao_aberto', apuracao: ok, pode: { ...pode, lancar: false } }).abrir.visivel, false);
  assert.equal(acoesDoCartao({ status: 'nao_aberto', apuracao: ok, pode, competenciaFutura: true }).abrir.habilitado, false);
  assert.equal(acoesDoCartao({ status: 'em_preenchimento', apuracao: ok, pode: { lancar: true, fechar: false } }).conferir.visivel, false);
});

test('rascunho: ida e volta sem alteração; mudança detectada; lote com a MESMA validação do banco', () => {
  const b = base([
    dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:00', '09:00'], ['09:15', '12:00']) }),
    dia('2026-10-06', { escala: SEIS }),
    dia('2026-10-07', { escala: comOcorrencia(SEIS, 'falta') }),
  ]);
  const r5 = rascunhoDoDia(b.dias[0]);
  assert.deepEqual(r5, { situacao: null, motivo: '', observacao: '', entrada: '06:00', saida_intervalo: '09:00', retorno_intervalo: '09:15', saida: '12:00', extras: [] });
  assert.deepEqual(itemDoRascunho('2026-10-05', r5).periodos, b.dias[0].lancamento.periodos);
  assert.deepEqual(diasAlterados(b, { '2026-10-05': r5 }), [], 'mesmo conteúdo não é alteração');

  const rascunhos = {
    '2026-10-06': { ...rascunhoDoDia(b.dias[1]), entrada: '06:00', saida: '12:30' },
    '2026-10-07': { ...rascunhoDoDia(b.dias[2]), situacao: 'falta', motivo: '' }, // igual à Escala -> segue a Escala
  };
  assert.deepEqual(diasAlterados(b, rascunhos), ['2026-10-06', '2026-10-07']);
  const lote = montarLote(b, rascunhos);
  assert.deepEqual(lote.erros, {});
  assert.deepEqual(lote.itens.find((i) => i.data === '2026-10-07').situacao, null, 'situação igual à da Escala vira null');

  const ruim = montarLote(b, { '2026-10-06': { ...rascunhoDoDia(b.dias[1]), entrada: '06:00' } });
  assert.equal(ruim.erros['2026-10-06'].codigo, 'hora_invalida', 'entrada sem saída');
  const ajusteSemMotivo = montarLote(b, { '2026-10-06': { ...rascunhoDoDia(b.dias[1]), situacao: 'folga' } });
  assert.equal(ajusteSemMotivo.erros['2026-10-06'].codigo, 'motivo_obrigatorio');
  const futuro = base([dia('2026-11-25', { escala: SEIS })], { competencia: '2026-11-01' });
  assert.equal(montarLote(futuro, { '2026-11-25': { ...rascunhoDoDia(futuro.dias[0]), entrada: '06:00', saida: '12:00' } }).erros['2026-11-25'].codigo, 'data_futura');
});

test('prévia na grade: rascunho recalcula a apuração ANTES de salvar (base não muda)', () => {
  const b = base([dia('2026-10-06', { escala: SEIS })]);
  assert.deepEqual(apurarCartao(b).dias[0].pendencias, ['sem_lancamento']);
  const r = rascunhoIgualAoPrevisto(b.dias[0], rascunhoDoDia(b.dias[0]));
  const previa = baseComRascunhos(b, { '2026-10-06': r });
  const d = apurarCartao(previa).dias[0];
  assert.deepEqual([d.trabalhado_min, d.pendencias], [360, []]);
  assert.equal(b.dias[0].lancamento, null, 'a base original não é tocada');
  assert.equal(baseComRascunhos(b, {}), b);
});

test('dia editável: só cartão aberto, passado, no vínculo e sem atestado integral', () => {
  const b = base([dia('2026-10-05', { escala: SEIS }), dia('2026-11-25', { escala: SEIS })], { atestados: [atestado('2026-10-05')] });
  const ap = apurarCartao(b);
  assert.deepEqual(diaEditavel(ap.dias[0], { aberto: true, atestados: b.atestados }), { horarios: false, ajuste: true });
  assert.deepEqual(diaEditavel(ap.dias[1], { aberto: true, atestados: b.atestados }), { horarios: false, ajuste: false }, 'futuro');
  assert.deepEqual(diaEditavel(ap.dias[0], { aberto: false, atestados: [] }), { horarios: false, ajuste: false }, 'fechado/não aberto');
});

test('impacto do atestado: falta coberta, folga continua folga, só os dias que mudam', () => {
  const b = base([
    dia('2026-10-05', { escala: comOcorrencia(SEIS, 'falta') }),
    dia('2026-10-06', { escala: FOLGA }),
    dia('2026-10-07', { escala: SEIS, lanc: comPeriodos(['06:00', '12:00']) }),
  ]);
  const novo = { tipo: 'atestado_medico', abrangencia: 'integral', data_inicio: '2026-10-05', data_fim: '2026-10-06', hora_inicio: null, hora_fim: null, descricao: null };
  const i = impactoDoAtestado(b, novo);
  assert.deepEqual(i.mudancas.map((m) => [m.data, m.de, m.para, m.falta_coberta]), [
    ['2026-10-05', 'Falta', 'Atestado', true],
    ['2026-10-06', 'Folga', 'Folga', false], // cobertura muda, situação não
  ]);
  assert.deepEqual([i.totais.faltas_antes, i.totais.faltas_depois, i.totais.atestado_depois], [1, 0, 360]);
  // Alterar: o próprio atestado sai antes da versão nova entrar.
  const comAtual = { ...b, atestados: [{ ...novo, id: 'a1' }] };
  assert.deepEqual(impactoDoAtestado(comAtual, { ...novo, data_fim: '2026-10-05' }, 'a1').mudancas.map((m) => m.data), ['2026-10-06']);
});

test('leitura: cartão FECHADO usa só o snapshot, mesmo que a Escala de hoje seja outra', () => {
  const congelada = base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:00', '12:00']) })]);
  const snapshot = { base: congelada, apuracao: apurarCartao(congelada) };
  const hoje = { ...base([dia('2026-10-05', { escala: FOLGA, lanc: comPeriodos(['06:00', '12:00']) })]), cartao: { status: 'fechado', snapshot } };
  const l = leituraDoCartao(hoje);
  assert.equal(l.origem, 'snapshot');
  assert.equal(l.apuracao.dias[0].situacao, 'trabalho');
  assert.deepEqual(resumoDaBase(hoje), { status: 'fechado', pendentes: 0, encerrada: true });
  const aberta = { ...congelada, cartao: null };
  assert.equal(leituraDoCartao(aberta).origem, 'atual');
});

test('avisos: prévia sem gravação, conferência desatualizada, pendentes, fechado com Escala alterada', () => {
  const ap = { competencia_encerrada: false, totais: { dias_pendentes: 3 } };
  const previa = avisosDoCartao({ status: 'nao_aberto', apuracao: ap, cartao: null, competencia: '2026-11-01' });
  assert.match(previa[0].texto, /Nada foi gravado/);
  assert.ok(previa.some((a) => a.pendentes && /3 dia/.test(a.texto)));
  assert.ok(previa.some((a) => /em andamento/.test(a.texto)));
  assert.match(avisosDoCartao({ status: 'conferencia_desatualizada', apuracao: { ...ap, competencia_encerrada: true }, cartao: {}, competencia: '2026-10-01' })[0].texto, /Confira de novo/);
  const fechado = avisosDoCartao({ status: 'fechado', apuracao: ap, cartao: { fechado_em: '2026-11-02T12:00:00Z', fechado_por_nome: 'Admin' }, divergencias: ['2026-10-05'], competencia: '2026-10-01' });
  assert.equal(fechado.length, 2);
  assert.match(fechado[1].texto, /mudou depois do fechamento.*05\/10\/2026/);
});

test('totais: extra/faltante como soma dos saldos, desvios ao lado', () => {
  const cards = cardsDeTotais(apurarCartao(base([dia('2026-10-05', { escala: SEIS, lanc: comPeriodos(['06:30', '12:30']) })])).totais);
  const v = Object.fromEntries(cards.map((c) => [c.chave, c.valor]));
  assert.deepEqual([v.fora, v.nao_coberto, v.extra, v.faltante], ['00:30', '00:30', '00:00', '00:00']);
});

test('erros: código do banco -> mensagem; permissão; rede; conflito de versão', () => {
  assert.equal(mensagemErroPonto({ message: 'folha_ponto: [pendencias] 2 dia(s) pendente(s).' }), 'Ainda há dias pendentes no cartão.');
  assert.match(mensagemErroPonto({ code: '42501', message: 'x' }), /permissão/);
  assert.match(mensagemErroPonto({ message: 'TypeError: Failed to fetch' }), /conexão/);
  assert.match(mensagemErroPonto({ message: 'qualquer coisa' }), /Não foi possível/);
  assert.equal(ehConflito({ message: 'folha_ponto: [cartao_alterado] ...' }), true);
  assert.equal(ehConflito({ message: 'folha_ponto: [atestado_alterado] ...' }), true);
  assert.equal(ehConflito({ message: 'folha_ponto: [pendencias] ...' }), false);
});

test('nome de arquivo sem acentos nem espaços', () => {
  assert.equal(nomeArquivoCartao('Ana Lúcia Conceição', '2026-11-01'), 'Cartao-Ponto_2026-11_Ana-Lucia-Conceicao');
});

// --- Isolamento da interface -------------------------------------------------------

function arquivos(dir, ext = /\.(js|mjs)$/) {
  return readdirSync(new URL(dir, import.meta.url)).filter((f) => ext.test(f)).map((f) => [f, readFileSync(new URL(`${dir}${f}`, import.meta.url), 'utf8')]);
}

test('interface: nada de Pagamentos, nenhum valor em R$, nenhum acesso direto ao Supabase fora de consultas.js', () => {
  const novosDaLib = ['apresentacao.js', 'exportacao.js', 'pdf.js', 'exportarCartao.js'];
  const todos = [
    ...arquivos('../../../components/ponto/'),
    ...arquivos('../../../pages/funcionarios/ponto/'),
    ...arquivos('../').filter(([f]) => novosDaLib.includes(f)),
  ];
  assert.ok(todos.length >= 17, `arquivos analisados: ${todos.length}`);
  for (const [nome, fonte] of todos) {
    assert.doesNotMatch(fonte, /from '[^']*(pagamentos|lancamentosCalculo|supabase)[^']*'/i, `${nome}: importa Pagamentos/Supabase`);
    assert.doesNotMatch(fonte, /folha_pagamentos|folha_lancamentos|folha_calcular/, `${nome}: cita Pagamentos`);
    assert.doesNotMatch(fonte, /R\$/, `${nome}: valor em R$`);
    assert.doesNotMatch(fonte, /\.rpc\(|createClient/, `${nome}: acesso direto ao banco`);
  }
});

test('revisão: competência sem vínculo (desligada antes do mês) não oferece abrir e explica', () => {
  const pode = { lancar: true, fechar: true, reabrir: true };
  const ap = { competencia_encerrada: false, totais: { dias_pendentes: 0 } };
  const abrir = acoesDoCartao({ status: 'nao_aberto', apuracao: ap, pode, semVinculo: true }).abrir;
  assert.deepEqual([abrir.habilitado, abrir.motivo], [false, 'Sem vínculo CLT nesta competência.']);
  const avisos = avisosDoCartao({ status: 'nao_aberto', apuracao: ap, cartao: null, competencia: '2026-12-01', semVinculo: true });
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].texto, /Sem vínculo CLT em nenhum dia de Dezembro\/2026/);
});

test('revisão: prévia do atestado aponta dia trabalhado (mesma regra do banco) só para integral', () => {
  const b = base([
    dia('2026-10-13', { escala: comOcorrencia(SEIS, 'falta') }),
    dia('2026-10-14', { escala: SEIS, lanc: comPeriodos(['06:00', '12:00']) }),
  ]);
  const integral = { tipo: 'atestado_medico', abrangencia: 'integral', data_inicio: '2026-10-13', data_fim: '2026-10-14', hora_inicio: null, hora_fim: null, descricao: null };
  assert.deepEqual(impactoDoAtestado(b, integral).diasComTrabalho, ['2026-10-14']);
  assert.deepEqual(impactoDoAtestado(b, { ...integral, data_fim: '2026-10-13' }).diasComTrabalho, []);
  const parcial = { ...integral, abrangencia: 'parcial', data_inicio: '2026-10-14', data_fim: '2026-10-14', hora_inicio: '10:00', hora_fim: '12:00' };
  assert.deepEqual(impactoDoAtestado(b, parcial).diasComTrabalho, [], 'parcial convive com trabalho');
});

test('revisão: proteção de rascunho cobre links, voltar, recarregar e troca de competência', () => {
  const hook = readFileSync(new URL('../../../components/ponto/useProtecaoAlteracoes.js', import.meta.url), 'utf8');
  for (const gancho of ["addEventListener('beforeunload'", "addEventListener('click', cliqueEmLink, true)", 'beforePopState', "events.on('routeChangeStart'"]) {
    assert.ok(hook.includes(gancho), gancho);
  }
  const cartao = readFileSync(new URL('../../../components/ponto/CartaoPonto.js', import.meta.url), 'utf8');
  assert.match(cartao, /if \(confirmarSaida\(\)\) onMudarMes\(novo\)/, 'trocar competência pergunta antes');
  assert.match(cartao, /sessionStorage/, 'rascunho guardado na sessão da aba');
  assert.match(cartao, /window\.confirm\(`Descartar as alterações/, 'descartar pede confirmação');
});

test('homologação: saldo do dia distingue "a lançar", falta registrada, não coberto e saldo apurado', () => {
  const ap = apurarCartao(base([
    dia('2026-10-05', { escala: SEIS }), // trabalho sem horário
    dia('2026-10-06', { escala: comOcorrencia(SEIS, 'falta') }),
    dia('2026-10-07', { escala: SEIS, lanc: comPeriodos(['06:00', '11:30']) }),
    dia('2026-10-08', { escala: SEIS, lanc: comPeriodos(['06:00', '09:00'], ['09:15', '12:15']) }),
  ]));
  const [aLancar, falta, curto, cheio] = ap.dias.map(leituraDoSaldo);
  assert.deepEqual([aLancar.estado, aLancar.texto, aLancar.tom, aLancar.minutos], ['nao_lancado', 'A lançar', 'warning', -360], 'valor da apuração preservado');
  assert.equal(aLancar.nota, 'previsto 06:00');
  assert.deepEqual([falta.estado, falta.texto, falta.tom, falta.nota], ['falta', '−06:00', 'danger', 'Falta registrada']);
  assert.deepEqual([curto.estado, curto.texto, curto.nota], ['apurado', '−00:30', 'não coberto 00:30']);
  assert.deepEqual([cheio.estado, cheio.texto, cheio.nota], ['apurado', '00:00', 'fora do previsto 00:15 · não coberto 00:15'], 'regra de jornada: 06:00–09:00 + 09:15–12:15 = 6h, saldo zero (desvios continuam visíveis)');
  assert.equal(ap.dias[3].trabalhado_min, 360);
});

test('homologação: resumo do topo = Previsto, Trabalhado, Saldo, Dias pendentes; resto secundário, mesmos valores', () => {
  const ap = apurarCartao(base([
    dia('2026-10-05', { escala: SEIS }),
    dia('2026-10-07', { escala: SEIS, lanc: comPeriodos(['06:00', '12:30']) }),
  ]));
  const { principais, secundarios } = resumoDoCartao(ap);
  assert.deepEqual(principais.map((c) => c.chave), ['previsto', 'trabalhado', 'saldo', 'pendentes']);
  const saldo = principais[2];
  assert.equal(saldo.valor, '−05:30', 'extra 00:30 − faltante 06:00');
  assert.equal(saldo.tom, 'warning', 'negativo vindo de dia não lançado não aparece como falta');
  assert.match(saldo.nota, /inclui −06:00 de dias ainda não lançados/);
  assert.deepEqual(secundarios.map((c) => c.chave), ['atestado', 'fora', 'nao_coberto', 'extra', 'faltante', 'faltas', 'atestados']);
  const todos = Object.fromEntries(cardsDeTotais(ap.totais).map((c) => [c.chave, c.valor]));
  for (const c of [...principais.filter((x) => x.chave !== 'saldo'), ...secundarios]) assert.equal(c.valor, todos[c.chave], c.chave);
  const comFalta = resumoDoCartao(apurarCartao(base([dia('2026-10-06', { escala: comOcorrencia(SEIS, 'falta') })])));
  assert.deepEqual([comFalta.principais[2].tom, comFalta.principais[2].nota], ['danger', null]);
});

test('homologação: feriado em dia escalado continua trabalho (não vira folga)', () => {
  const ap = apurarCartao(base([dia('2026-10-28', { escala: SEIS, feriado: 'Feriado de nome muito longo para a coluna' })]));
  assert.deepEqual([ap.dias[0].situacao, ap.dias[0].feriado, ap.dias[0].previsto_min], ['trabalho', 'Feriado de nome muito longo para a coluna', 360]);
  assert.equal(leituraDoSaldo(ap.dias[0]).estado, 'nao_lancado');
});

test('homologação: grade com ações em texto, filtro de pendências e atestado no cabeçalho', () => {
  const grade = readFileSync(new URL('../../../components/ponto/GradeDias.js', import.meta.url), 'utf8');
  assert.match(grade, /leituraDoSaldo/);
  assert.match(grade, /estilos\.feriado/, 'feriado com quebra de linha (não Badge nowrap)');
  assert.doesNotMatch(grade, /icone: 'check'/, 'sem ícone de "check" que parecia salvar');
  const cartao = readFileSync(new URL('../../../components/ponto/CartaoPonto.js', import.meta.url), 'utf8');
  assert.match(cartao, /Somente pendências/);
  assert.match(cartao, /Ir ao próximo pendente/);
  assert.match(cartao, /alterados\.has\(l\.base\.data\)/, 'dia em edição não some do filtro');
  assert.equal((cartao.match(/onClick=\{registrarAtestado\}|onRegistrar=\{registrarAtestado\}/g) || []).length, 2, 'mesmo fluxo nos dois pontos');
  assert.match(cartao, /Alterações salvas às/);
});

test('integração dos componentes: todo <TotaisCartao> recebe apuracao (Conferir/Fechar incluídos)', () => {
  const pasta = new URL('../../../components/ponto/', import.meta.url);
  const usos = readdirSync(pasta).filter((n) => n.endsWith('.js')).flatMap((n) => [...readFileSync(new URL(n, pasta), 'utf8').matchAll(/<TotaisCartao([^>]*)\/>/g)].map((m) => [n, m[1]]));
  assert.ok(usos.length >= 2);
  for (const [nome, props] of usos) assert.match(props, /apuracao=\{/, `${nome}: ${props}`);
  const cartao = readFileSync(new URL('CartaoPonto.js', pasta), 'utf8');
  assert.equal((cartao.match(/<ConfirmarModal[\s\S]*?apuracao=\{apuracaoSalva\}/g) || []).length, 2);
  assert.doesNotMatch(cartao, /totais=\{/);
});
