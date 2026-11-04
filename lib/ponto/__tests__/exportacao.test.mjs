// Cartão-Ponto, Etapa 2: exportação (PDF A4 retrato com assinaturas,
// Excel Dias/Totais/Atestados, ZIP da competência). PRÉVIA para cartão
// aberto; cartão fechado só pelo snapshot.
//   node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/ponto/__tests__/exportacao.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { LEGENDA, MARCA_PREVIA, montarExportacaoCartao } from '../exportacao.js';
import { gerarPdfCartao, textoPdf } from '../pdf.js';
import { apurarCartao } from '../apuracao.js';
import { gerarXlsx } from '../../exportacao/xlsx.js';
import { criarZip } from '../../exportacao/zip.js';
import { FOLGA, atestado, base, comOcorrencia, dia, lancamento, trabalho } from './casos.mjs';

const SEIS = trabalho(['06:00', '12:00']);
const lanc = (...p) => lancamento({ periodos: p });

function mes() {
  const dias = [];
  for (let d = 1; d <= 31; d += 1) {
    const data = `2026-10-${String(d).padStart(2, '0')}`;
    const domingo = new Date(`${data}T12:00:00Z`).getUTCDay() === 0;
    if (domingo) dias.push(dia(data, { escala: FOLGA }));
    else if (d === 7) dias.push(dia(data, { escala: comOcorrencia(SEIS, 'falta') }));
    else if (d === 12) dias.push(dia(data, { escala: FOLGA, feriado: 'Nossa Senhora Aparecida' }));
    else if (d === 20) dias.push(dia(data, { escala: SEIS, lanc: lanc(['06:00', '08:00'], ['08:15', '10:00'], ['10:30', '12:30']) }));
    else dias.push(dia(data, { escala: SEIS, lanc: lanc(['06:30', '12:30']) }));
  }
  return base(dias, { atestados: [atestado('2026-10-07', '2026-10-07', { descricao: 'Entregue 08/10' })] });
}

const EMPRESA = { nome_fantasia: 'Padoca Teste', razao_social: 'Padoca Teste Ltda', cnpj: '00.000.000/0001-00', cidade_uf: 'São Paulo/SP' };

test('cartão aberto: PRÉVIA identificada, base atual, totais e 3 planilhas', () => {
  const m = montarExportacaoCartao({ ...mes(), cartao: { status: 'em_preenchimento' } }, { empresa: EMPRESA, geradoEm: '2026-11-03T12:00:00Z' });
  assert.equal(m.previa, true);
  assert.equal(m.situacaoDocumento, MARCA_PREVIA);
  assert.equal(m.nomeArquivo, 'Cartao-Ponto_2026-10_Sabrina_PREVIA');
  assert.equal(m.dias.length, 31);
  assert.equal(m.empresa.razao_social, 'Padoca Teste Ltda');
  const d7 = m.dias.find((d) => d.data === '2026-10-07');
  assert.equal(d7.situacao, 'Atestado (Escala: Falta)');
  const d5 = m.dias.find((d) => d.data === '2026-10-05');
  assert.deepEqual([d5.entrada, d5.saida, d5.saldo, d5.fora_min, d5.nao_coberto_min], ['06:30', '12:30', '00:00', 30, 30]);
  const d20 = m.dias.find((d) => d.data === '2026-10-20');
  assert.deepEqual([d20.entrada, d20.saida_intervalo, d20.retorno_intervalo, d20.saida], ['06:00', '08:00', '08:15', '10:00']);
  assert.match(d20.observacao, /\+ 10:30–12:30/, 'períodos além do 2º aparecem na observação');
  assert.deepEqual(m.planilhas.map((p) => p.nome), ['Dias', 'Totais', 'Atestados']);
  assert.equal(m.planilhas[0].linhas.length, 31);
  assert.equal(m.planilhas[2].linhas[0][6], 'Entregue 08/10');
  assert.ok(m.planilhas[1].linhas.some((l) => l[0] === 'Documento' && l[1] === MARCA_PREVIA));
  assert.equal(m.legenda, LEGENDA);
});

test('cartão FECHADO: exporta só o snapshot (Escala de hoje ignorada), empresa do snapshot, sem PRÉVIA', () => {
  const congelada = mes();
  const snapshot = {
    base: congelada, apuracao: apurarCartao(congelada), empresa: EMPRESA,
    conferido_em: '2026-11-02T10:00:00Z', conferido_por_nome: 'Admin', fechado_em: '2026-11-02T11:00:00Z', fechado_por_nome: 'Admin',
  };
  const hoje = mes();
  hoje.dias = hoje.dias.map((d) => ({ ...d, escala: FOLGA })); // Escala mudou depois
  const m = montarExportacaoCartao({ ...hoje, cartao: { status: 'fechado', snapshot, fechado_em: snapshot.fechado_em, fechado_por_nome: 'Admin' } }, { empresa: { nome_fantasia: 'Outra' } });
  assert.equal(m.previa, false);
  assert.equal(m.nomeArquivo, 'Cartao-Ponto_2026-10_Sabrina');
  assert.match(m.situacaoDocumento, /^Fechado em .* por Admin · Conferido em/);
  assert.equal(m.empresa.nome, 'Padoca Teste');
  assert.equal(m.dias.find((d) => d.data === '2026-10-05').previsto, '06:00–12:00', 'previsto do snapshot');
  assert.equal(m.totais[0][2], snapshot.apuracao.totais.previsto_min);
});

test('PDF A4 retrato: gera para prévia e fechado; assinaturas; várias páginas sem erro', () => {
  const previa = montarExportacaoCartao({ ...mes(), cartao: null }, { empresa: null });
  const bytes = new Uint8Array(gerarPdfCartao(previa, { jsPDF, autoTable }));
  const texto = new TextDecoder('latin1').decode(bytes);
  assert.equal(texto.slice(0, 5), '%PDF-');
  assert.match(texto, /\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/, 'A4 retrato');
  assert.match(texto, /Respons/, 'linha de assinatura do responsável');
  assert.match(texto, /Funcion/, 'linha de assinatura da funcionária');
  assert.match(texto, /PR.VIA/, 'marca de prévia');
  assert.equal(previa.empresa.nome.length > 0, true, 'sem config: nome da marca');
  assert.ok(previa.dias.some((d) => d.saldo.startsWith('−')), 'há saldo negativo no mês de teste');
  assert.match(texto, /\(-0\d:\d\d\)/, 'saldo negativo com hífen no PDF');
  assert.doesNotMatch(texto, /−/);

  const congelada = mes();
  const fechado = montarExportacaoCartao({
    ...congelada,
    cartao: { status: 'fechado', fechado_em: '2026-11-02T11:00:00Z', snapshot: { base: congelada, apuracao: apurarCartao(congelada), empresa: EMPRESA } },
  });
  const t2 = new TextDecoder('latin1').decode(new Uint8Array(gerarPdfCartao(fechado, { jsPDF, autoTable })));
  assert.doesNotMatch(t2, /PR.VIA/, 'fechado não leva a marca de prévia');
});

test('PDF: caracteres fora da fonte padrão (menos, setas, aspas curvas) viram equivalentes legíveis', () => {
  assert.equal(textoPdf('−01:00 → “x” ‘y’'), '-01:00 -> "x" \'y\'');
  const m = montarExportacaoCartao({ ...mes(), cartao: null });
  assert.match(m.legenda, /−/, 'a legenda da tela usa o sinal de menos');
  const texto = new TextDecoder('latin1').decode(new Uint8Array(gerarPdfCartao(m, { jsPDF, autoTable })));
  assert.match(texto, /previsto - previsto/, 'no PDF a legenda sai com hífen');
  assert.match(texto, /\/Count 1/, 'um mês cabe numa página A4 (com assinaturas)');
});

function arquivosDoZip(bytes) {
  const nomes = [];
  const conteudo = {};
  let i = 0;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (i + 30 <= bytes.length && v.getUint32(i, true) === 0x04034b50) {
    const metodo = v.getUint16(i + 8, true);
    const tamanho = v.getUint32(i + 18, true);
    const nomeLen = v.getUint16(i + 26, true);
    const extraLen = v.getUint16(i + 28, true);
    const nome = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nomeLen));
    const ini = i + 30 + nomeLen + extraLen;
    const dados = bytes.subarray(ini, ini + tamanho);
    nomes.push(nome);
    conteudo[nome] = new TextDecoder().decode(metodo === 8 ? inflateRawSync(dados) : dados);
    i = ini + tamanho;
  }
  return { nomes, conteudo };
}

test('Excel: abas Dias/Totais/Atestados, datas e horas tipadas, PRÉVIA no documento', () => {
  const m = montarExportacaoCartao({ ...mes(), cartao: null });
  const { nomes, conteudo } = arquivosDoZip(gerarXlsx({ planilhas: m.planilhas, titulo: 'Cartão-Ponto' }));
  assert.ok(nomes.includes('xl/worksheets/sheet3.xml'));
  assert.match(conteudo['xl/workbook.xml'], /name="Dias".*name="Totais".*name="Atestados"/);
  assert.match(conteudo['xl/worksheets/sheet2.xml'], new RegExp(MARCA_PREVIA));
  assert.match(conteudo['xl/worksheets/sheet1.xml'], /<c r="A2" s="2"><v>\d+<\/v><\/c>/, 'data como serial');
  assert.doesNotMatch(Object.values(conteudo).join(''), /R\$/);
});

test('ZIP da competência: um PDF por funcionária', () => {
  const m1 = montarExportacaoCartao({ ...mes(), cartao: null });
  const outra = mes();
  outra.funcionario = { ...outra.funcionario, id: 'f-2', nome: 'Joana' };
  const m2 = montarExportacaoCartao({ ...outra, cartao: null });
  const zip = criarZip([m1, m2].map((m) => ({ caminho: `${m.nomeArquivo}.pdf`, conteudo: new Uint8Array(gerarPdfCartao(m, { jsPDF, autoTable })) })));
  const { nomes } = arquivosDoZip(zip);
  assert.deepEqual(nomes, ['Cartao-Ponto_2026-10_Sabrina_PREVIA.pdf', 'Cartao-Ponto_2026-10_Joana_PREVIA.pdf']);
});

test('PDF/Excel: A LANÇAR (sem horário) x Falta registrada x parcial x futuro x folga; valores da apuração preservados', () => {
  const b = base([
    dia('2026-11-02', { escala: SEIS, lanc: lanc(['06:00', '11:50']) }), // parcial: −00:10 apurado
    dia('2026-11-03', { escala: SEIS }), // sem horário
    dia('2026-11-04', { escala: SEIS }), // sem horário
    dia('2026-11-05', { escala: comOcorrencia(SEIS, 'falta') }),
    dia('2026-11-08', { escala: FOLGA }),
    dia('2026-11-25', { escala: SEIS }), // futuro (HOJE = 20/11)
  ], { competencia: '2026-11-01' });
  const m = montarExportacaoCartao({ ...b, cartao: { status: 'em_preenchimento' } });
  const por = Object.fromEntries(m.dias.map((d) => [d.data, d]));
  assert.deepEqual([por['2026-11-03'].saldo, por['2026-11-03'].saldo_min, por['2026-11-03'].leitura_saldo], ['A LANÇAR', -360, 'A lançar (sem horário)']);
  assert.match(por['2026-11-03'].observacao, /^A lançar: previsto 06:00/);
  assert.doesNotMatch(por['2026-11-03'].observacao, /PENDENTE/);
  assert.deepEqual([por['2026-11-05'].saldo, por['2026-11-05'].leitura_saldo], ['−06:00', 'Falta registrada']);
  assert.match(por['2026-11-05'].observacao, /Falta registrada/);
  assert.deepEqual([por['2026-11-02'].saldo, por['2026-11-02'].leitura_saldo], ['−00:10', 'Apurado']);
  assert.equal(por['2026-11-02'].observacao, 'não cob. 00:10', 'desvios do dia parcial');
  assert.deepEqual([por['2026-11-25'].saldo, por['2026-11-25'].leitura_saldo], ['—', '']);
  assert.deepEqual([por['2026-11-08'].situacao, por['2026-11-08'].saldo], ['Folga', '00:00']);

  const totais = Object.fromEntries(m.totais.map((t) => [t[0].trim(), t]));
  assert.equal(totais['Faltante (soma dos saldos negativos)'][1], '18:10', 'valor da apuração intacto');
  assert.equal(totais['dos quais: dias ainda não lançados'][1], '12:00');
  assert.equal(totais['dos quais: saldo negativo já apurado'][1], '06:10', 'Falta (06:00) + parcial (00:10)');

  const dias = m.planilhas[0];
  const iLeitura = dias.colunas.findIndex((c) => c.titulo === 'Leitura do saldo');
  assert.ok(iLeitura > 0);
  assert.equal(dias.linhas.find((l) => l[0] === '2026-11-03')[iLeitura], 'A lançar (sem horário)');
  assert.ok(m.planilhas[1].linhas.some((l) => /dos quais: dias ainda não lançados/.test(l[0] || '') && l[2] === 720));

  const texto = new TextDecoder('latin1').decode(new Uint8Array(gerarPdfCartao(m, { jsPDF, autoTable })));
  assert.match(texto, /A LAN\xC7AR/, 'PDF mostra A LANÇAR');
  assert.match(texto, /Falta registrada/);
  assert.match(texto, /dos quais: dias ainda n\xE3o lan\xE7ados/);
});

test('exemplo da homologação: 12:10 faltantes = 12:00 a lançar + 00:10 apurado; mês inteiro em 1 página', () => {
  const dias = [];
  for (let d = 1; d <= 31; d += 1) {
    const data = `2026-10-${String(d).padStart(2, '0')}`;
    const domingo = new Date(`${data}T12:00:00Z`).getUTCDay() === 0;
    if (domingo) dias.push(dia(data, { escala: FOLGA }));
    else if (d === 14 || d === 15) dias.push(dia(data, { escala: SEIS }));
    else if (d === 16) dias.push(dia(data, { escala: SEIS, lanc: lanc(['06:10', '12:00']) }));
    else dias.push(dia(data, { escala: SEIS, lanc: lanc(['06:00', '12:00']) }));
  }
  const m = montarExportacaoCartao({ ...base(dias), cartao: { status: 'em_preenchimento' } });
  const totais = Object.fromEntries(m.totais.map((t) => [t[0].trim(), t[1]]));
  assert.deepEqual(
    [totais['Faltante (soma dos saldos negativos)'], totais['dos quais: dias ainda não lançados'], totais['dos quais: saldo negativo já apurado']],
    ['12:10', '12:00', '00:10'],
  );
  const texto = new TextDecoder('latin1').decode(new Uint8Array(gerarPdfCartao(m, { jsPDF, autoTable })));
  assert.match(texto, /\/Count 1/, 'continua em uma página A4');
});
