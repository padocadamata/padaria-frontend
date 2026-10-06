// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/funcionarios/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { construirMapaEscala, obterEstadoDia } from '../escala.js';
import { classificarCelulaMensal } from '../escalaFaixas.js';
import { resolverCoberturaPeriodo, resolverEstadosDoDia, calcularFaixasCobertura } from '../escalaCobertura.js';
import { FILTRO_ESCALA_VAZIO, filtrarFuncionariosEscala, funcionariosDoCargo, descreverFiltroEscala, funcionariasDisponiveisNoFiltro, normalizarFiltroEscala } from '../escalaFiltro.js';
import {
  montarExportacaoSemanal,
  montarExportacaoMensal,
  montarExportacaoCobertura,
  celulaMensalPdf,
  leituraMensal,
  formatarGeradoEm,
} from '../escalaExportacao.js';
import { gerarXlsx, serialData, serialHora, letraColuna } from '../../exportacao/xlsx.js';
import { crc32 } from '../../exportacao/zip.js';
import { gerarPdfRelatorio } from '../../exportacao/pdf.js';
import { diasDoMes } from '../../data/dataLocal.js';

// ------------------------------------------------------------
// Fixture (somente memória -- nada é gravado no Supabase)
// ------------------------------------------------------------
const ATENDENTE = { id: 'c1', nome: 'Atendente' };
const PADEIRA = { id: 'c2', nome: 'Padeira' };
const cargos = [ATENDENTE, PADEIRA];
const func = (id, nome, cargo, tipo_vinculo = 'funcionario') => ({ id, nome, ativo: true, tipo_vinculo, cargo_id: cargo.id, funcionarios_cargos: { nome: cargo.nome } });
const ANA = func('f-ana', 'Ana Souza', ATENDENTE);
const BIA = func('f-bia', 'Bia Lima', ATENDENTE, 'freelancer');
const CARLA = func('f-carla', 'Carla Dias', PADEIRA);
const MARIA = func('f-maria', 'Maria Silva', ATENDENTE, 'pj');
const funcionarios = [ANA, BIA, CARLA, MARIA];

const SEMANA = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
const GERADO_EM = '06/10/2026 09:30';

function montarMapa() {
  const dias = [];
  const periodos = new Map();
  const ocorrencias = new Map();
  let seq = 0;
  const dia = (funcionario, data, tipo, pers = [], ocorrencia = null) => {
    const id = `d${++seq}`;
    dias.push({ id, funcionario_id: funcionario.id, data, tipo_dia: tipo });
    periodos.set(
      id,
      pers.map(([hi, hf, natureza]) => ({ hora_inicio: `${hi}:00`, hora_fim: `${hf}:00`, ...(natureza ? { natureza_financeira: natureza } : {}) }))
    );
    if (ocorrencia) ocorrencias.set(id, { tipo: ocorrencia, observacao: null });
  };
  dia(ANA, '2026-10-05', 'trabalho', [['06:00', '12:00']]); // M
  dia(ANA, '2026-10-06', 'trabalho', [['12:00', '18:00']]); // T
  dia(ANA, '2026-10-07', 'trabalho', [['06:00', '15:00']]); // M+T
  dia(ANA, '2026-10-08', 'trabalho', [['14:00', '18:00'], ['07:00', '11:00']]); // 2 períodos, M+T
  dia(ANA, '2026-10-09', 'folga');
  dia(ANA, '2026-10-10', 'trabalho', [['06:00', '12:00']], 'falta');
  // ANA 11/10: não definido
  dia(BIA, '2026-10-05', 'trabalho', [['08:00', '14:00']], 'atestado');
  dia(BIA, '2026-10-06', 'trabalho', [['12:00', '19:30', 'extra_remunerado']]);
  dia(CARLA, '2026-10-05', 'trabalho', [['06:00', '12:00']]);
  dia(MARIA, '2026-10-05', 'trabalho', [['10:00', '16:00']]);
  return construirMapaEscala(dias, periodos, ocorrencias);
}
const mapaEscala = montarMapa();
const descricao = (filtro) => descreverFiltroEscala(filtro, { cargos, funcionarios });

// ------------------------------------------------------------
// Utilitários de leitura dos arquivos gerados
// ------------------------------------------------------------
function lerZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const arquivos = new Map();
  let pos = 0;
  while (dv.getUint32(pos, true) === 0x04034b50) {
    const metodo = dv.getUint16(pos + 8, true);
    const crc = dv.getUint32(pos + 14, true);
    const tamanho = dv.getUint32(pos + 18, true);
    const nomeLen = dv.getUint16(pos + 26, true);
    const extraLen = dv.getUint16(pos + 28, true);
    const nome = new TextDecoder().decode(bytes.subarray(pos + 30, pos + 30 + nomeLen));
    const dados = bytes.subarray(pos + 30 + nomeLen + extraLen, pos + 30 + nomeLen + extraLen + tamanho);
    assert.equal(metodo, 0);
    assert.equal(crc32(dados), crc, `CRC de ${nome}`);
    arquivos.set(nome, new TextDecoder().decode(dados));
    pos += 30 + nomeLen + extraLen + tamanho;
  }
  assert.equal(dv.getUint32(bytes.length - 22, true), 0x06054b50, 'EOCD no fim do zip');
  return arquivos;
}

const desescapar = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// Lê uma aba como matriz de { v, t, s } a partir do XML gerado.
function lerAba(xml) {
  const linhas = [];
  for (const [, conteudo] of xml.matchAll(/<row r="\d+">(.*?)<\/row>/g)) {
    const linha = [];
    for (const [, ref, attrs, corpo] of conteudo.matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(.*?)<\/c>/g)) {
      const col = ref.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const estilo = attrs.match(/s="(\d+)"/)?.[1] ?? '0';
      if (attrs.includes('inlineStr')) linha[col] = { t: 's', v: desescapar(corpo.match(/<t[^>]*>(.*?)<\/t>/)[1]), s: estilo };
      else linha[col] = { t: 'n', v: Number(corpo.match(/<v>(.*?)<\/v>/)[1]), s: estilo };
    }
    linhas.push(linha);
  }
  return linhas;
}

function lerXlsx(modelo) {
  const bytes = gerarXlsx({ planilhas: modelo.planilhas, titulo: modelo.titulo });
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
  const zip = lerZip(bytes);
  for (const parte of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']) {
    assert.ok(zip.has(parte), `parte ${parte}`);
  }
  const nomes = [...zip.get('xl/workbook.xml').matchAll(/<sheet name="([^"]+)"/g)].map((m) => desescapar(m[1]));
  const abas = new Map(nomes.map((nome, i) => [nome, { xml: zip.get(`xl/worksheets/sheet${i + 1}.xml`), linhas: lerAba(zip.get(`xl/worksheets/sheet${i + 1}.xml`)) }]));
  return { nomes, abas, zip };
}

const textoLinha = (linha) => linha.map((c) => (c ? c.v : null));

// jsPDF grava streams SEM compressão por padrão: o texto desenhado aparece
// literal no arquivo (WinAnsi), o que permite conferir o conteúdo do PDF
// sem dependência externa.
function lerPdf(modelo) {
  const bytes = new Uint8Array(gerarPdfRelatorio(modelo, { jsPDF, autoTable }));
  const texto = Buffer.from(bytes).toString('latin1');
  assert.ok(texto.startsWith('%PDF-'), 'cabeçalho %PDF');
  assert.ok(texto.trimEnd().endsWith('%%EOF'), 'termina com %%EOF');
  const paginas = (texto.match(/\/Type \/Page\b(?!s)/g) || []).length;
  return { bytes, texto, paginas };
}
// jsPDF grava o texto em WinAnsi: acentos = byte Latin-1; "–"/"—" = 0x96/0x97.
const winAnsi = (s) => s.replace(/–/g, '\x96').replace(/—/g, '\x97');
const noPdf = (pdf, s) => pdf.texto.includes(winAnsi(s));

// ------------------------------------------------------------
// FILTROS
// ------------------------------------------------------------
test('filtro: sem filtro devolve todas as funcionárias (mesma ordem da fonte)', () => {
  assert.deepEqual(filtrarFuncionariosEscala(funcionarios, FILTRO_ESCALA_VAZIO).map((f) => f.id), ['f-ana', 'f-bia', 'f-carla', 'f-maria']);
  assert.deepEqual(descricao(FILTRO_ESCALA_VAZIO), { cargo: null, funcionario: null });
});

test('filtro: por cargo', () => {
  assert.deepEqual(filtrarFuncionariosEscala(funcionarios, { cargoId: 'c1', funcionarioId: '' }).map((f) => f.id), ['f-ana', 'f-bia', 'f-maria']);
  assert.deepEqual(descricao({ cargoId: 'c1', funcionarioId: '' }), { cargo: 'Atendente', funcionario: null });
});

test('filtro: por funcionária', () => {
  assert.deepEqual(filtrarFuncionariosEscala(funcionarios, { cargoId: '', funcionarioId: 'f-carla' }).map((f) => f.id), ['f-carla']);
  assert.deepEqual(descricao({ cargoId: '', funcionarioId: 'f-carla' }), { cargo: null, funcionario: 'Carla Dias' });
});

test('filtro: cargo + funcionária', () => {
  assert.deepEqual(filtrarFuncionariosEscala(funcionarios, { cargoId: 'c1', funcionarioId: 'f-maria' }).map((f) => f.id), ['f-maria']);
});

test('filtro: combinação incompatível -> vazio (sem "corrigir" o filtro)', () => {
  assert.deepEqual(filtrarFuncionariosEscala(funcionarios, { cargoId: 'c1', funcionarioId: 'f-carla' }), []);
});

test('filtro: lista de funcionárias depende do cargo selecionado', () => {
  assert.deepEqual(funcionariasDisponiveisNoFiltro(funcionarios, '').map((f) => f.id), ['f-ana', 'f-bia', 'f-carla', 'f-maria']);
  assert.deepEqual(funcionariasDisponiveisNoFiltro(funcionarios, 'c1').map((f) => f.id), ['f-ana', 'f-bia', 'f-maria']);
  assert.deepEqual(funcionariasDisponiveisNoFiltro(funcionarios, 'c2').map((f) => f.id), ['f-carla']);
});

test('filtro: trocar para cargo incompatível limpa a funcionária; compatível mantém', () => {
  assert.deepEqual(normalizarFiltroEscala({ cargoId: 'c2', funcionarioId: 'f-maria' }, funcionarios), { cargoId: 'c2', funcionarioId: '' });
  assert.deepEqual(normalizarFiltroEscala({ cargoId: 'c1', funcionarioId: 'f-maria' }, funcionarios), { cargoId: 'c1', funcionarioId: 'f-maria' });
  assert.deepEqual(normalizarFiltroEscala({ cargoId: '', funcionarioId: 'f-carla' }, funcionarios), { cargoId: '', funcionarioId: 'f-carla' });
  assert.deepEqual(normalizarFiltroEscala({ cargoId: 'c1', funcionarioId: '' }, funcionarios), { cargoId: 'c1', funcionarioId: '' });
  // funcionária que não existe mais na lista (ex.: inativada) também é limpa
  assert.deepEqual(normalizarFiltroEscala({ cargoId: '', funcionarioId: 'f-sumiu' }, funcionarios), { cargoId: '', funcionarioId: '' });
});

test('filtro: base de cobertura ignora a funcionária (só cargo)', () => {
  assert.equal(funcionariosDoCargo(funcionarios, '').length, 4);
  assert.deepEqual(funcionariosDoCargo(funcionarios, 'c2').map((f) => f.id), ['f-carla']);
});

// ------------------------------------------------------------
// SEMANAL
// ------------------------------------------------------------
test('semanal: 1 funcionária -- estados, 2 períodos no mesmo dia, folga/falta/não definido', () => {
  const filtro = { cargoId: '', funcionarioId: 'f-ana' };
  const modelo = montarExportacaoSemanal({ dias: SEMANA, funcionarios: filtrarFuncionariosEscala(funcionarios, filtro), mapaEscala, filtroDescricao: descricao(filtro), geradoEm: GERADO_EM });
  assert.equal(modelo.nomeArquivo, 'escala-semanal_2026-10-05_a_2026-10-11');
  assert.equal(modelo.periodoRotulo, '05/10 — 11/10/2026');

  const aba = modelo.planilhas[0];
  assert.equal(aba.nome, 'Escala semanal');
  assert.deepEqual(aba.colunas.map((c) => c.titulo), ['Funcionária', 'Cargo', 'Vínculo', 'Data', 'Dia da semana', 'Estado', 'Ocorrência', 'Período nº', 'Início', 'Fim', 'Natureza']);
  assert.equal(aba.linhas.length, 8); // 7 dias + 1 período extra em 08/10
  const dia8 = aba.linhas.filter((l) => l[3] === '2026-10-08');
  assert.deepEqual(dia8.map((l) => [l[7], l[8], l[9]]), [[1, '07:00', '11:00'], [2, '14:00', '18:00']]); // ordenados por início
  assert.deepEqual(aba.linhas.find((l) => l[3] === '2026-10-09').slice(5, 8), ['Folga', '', null]);
  assert.deepEqual(aba.linhas.find((l) => l[3] === '2026-10-10').slice(5, 7), ['Trabalho', 'Falta']);
  assert.deepEqual(aba.linhas.find((l) => l[3] === '2026-10-11').slice(5, 7), ['Não definido', '']);
  assert.equal(aba.linhas[0][4], 'Seg'); // semana operacional segunda a domingo
  assert.equal(aba.linhas[aba.linhas.length - 1][4], 'Dom');

  const grade = modelo.pdf.secoes[0];
  assert.deepEqual(grade.cabecalho, ['Funcionária', 'Cargo', 'Seg 05/10', 'Ter 06/10', 'Qua 07/10', 'Qui 08/10', 'Sex 09/10', 'Sáb 10/10', 'Dom 11/10']);
  const [linhaAna] = grade.linhas;
  assert.equal(linhaAna[5].texto, '07:00–11:00\n14:00–18:00');
  assert.deepEqual(linhaAna[6], { texto: 'Folga', tom: 'folga' });
  assert.deepEqual(linhaAna[7], { texto: '06:00–12:00\nFALTA', tom: 'falta' });
  assert.deepEqual(linhaAna[8], { texto: '—', tom: 'vazio' });
});

test('semanal: vários funcionários, atestado e período extra', () => {
  const modelo = montarExportacaoSemanal({ dias: SEMANA, funcionarios, mapaEscala, filtroDescricao: descricao(FILTRO_ESCALA_VAZIO), geradoEm: GERADO_EM });
  const linhas = modelo.pdf.secoes[0].linhas;
  assert.deepEqual(linhas.map((l) => l[0]), ['Ana Souza', 'Bia Lima', 'Carla Dias', 'Maria Silva']);
  assert.deepEqual(linhas[1][2], { texto: '08:00–14:00\nATESTADO', tom: 'atestado' });
  assert.equal(linhas[1][3].texto, '12:00–19:30 · extra');
  const aba = modelo.planilhas[0];
  assert.equal(aba.linhas.length, 8 + 7 * 3);
  assert.equal(aba.linhas.find((l) => l[0] === 'Bia Lima' && l[3] === '2026-10-06')[10], 'Extra remunerado');
  assert.equal(aba.linhas.find((l) => l[0] === 'Maria Silva')[2], 'PJ');
});

// ------------------------------------------------------------
// MENSAL -- reutiliza classificarCelulaMensal (regra M/T publicada)
// ------------------------------------------------------------
const OUTUBRO = diasDoMes('2026-10-01');

test('mensal: M, T, M+T, folga, falta, atestado', () => {
  const modelo = montarExportacaoMensal({ dias: OUTUBRO, funcionarios, mapaEscala, filtroDescricao: descricao(FILTRO_ESCALA_VAZIO), geradoEm: GERADO_EM });
  assert.equal(modelo.nomeArquivo, 'escala-mensal_2026-10');
  assert.equal(modelo.periodoRotulo, 'Outubro de 2026');
  const aba = modelo.planilhas.find((p) => p.nome === 'Mensal');
  assert.deepEqual(aba.colunas.map((c) => c.titulo), ['Funcionária', 'Cargo', 'Data', 'Dia', 'Estado', 'M', 'T', 'Leitura', 'Ocorrência', 'Horários']);
  const linha = (nome, data) => aba.linhas.find((l) => l[0] === nome && l[2] === data);
  assert.deepEqual(linha('Ana Souza', '2026-10-05').slice(4, 10), ['Trabalho', 'Sim', 'Não', 'M', '', '06:00–12:00']);
  assert.deepEqual(linha('Ana Souza', '2026-10-06').slice(4, 8), ['Trabalho', 'Não', 'Sim', 'T']);
  assert.deepEqual(linha('Ana Souza', '2026-10-07').slice(4, 8), ['Trabalho', 'Sim', 'Sim', 'M+T']);
  assert.deepEqual(linha('Ana Souza', '2026-10-08').slice(7, 10), ['M+T', '', '07:00–11:00 ; 14:00–18:00']);
  assert.deepEqual(linha('Ana Souza', '2026-10-09').slice(4, 8), ['Folga', '', '', '']);
  assert.deepEqual(linha('Ana Souza', '2026-10-10').slice(7, 9), ['M', 'Falta']);
  assert.deepEqual(linha('Bia Lima', '2026-10-05').slice(7, 9), ['M+T', 'Atestado']);
  assert.deepEqual(linha('Bia Lima', '2026-10-06').slice(7, 8), ['T']); // 12:00–19:30 só T
  assert.equal(linha('Ana Souza', '2026-10-11')[4], 'Não definido');
  assert.equal(aba.linhas.length, 4 * 31);

  // PDF: dois blocos (1–16 / 17–31), Funcionária repetida em cada um.
  const [b1, b2] = modelo.pdf.secoes;
  assert.equal(modelo.pdf.secoes.length, 2);
  assert.equal(b1.cabecalho.length, 1 + 16);
  assert.equal(b2.cabecalho.length, 1 + 15);
  assert.equal(b2.novaPagina, undefined); // mesma página do 1º bloco
  assert.equal(b1.compacto && b2.compacto, true);
  const ana = b1.linhas[0];
  assert.deepEqual(ana.slice(5, 11), [
    { texto: 'M', tom: 'trabalho' },
    { texto: 'T', tom: 'trabalho' },
    { texto: 'M+T', tom: 'trabalho' },
    { texto: 'M+T', tom: 'trabalho' },
    { texto: 'Folga', tom: 'folga' },
    { texto: 'M\nFalta', tom: 'falta' },
  ]);
  assert.deepEqual(b1.linhas[1][5], { texto: 'M+T\nAtestado', tom: 'atestado' });
});

test('mensal: exportação nunca diverge de classificarCelulaMensal (sem regra paralela)', () => {
  const modelo = montarExportacaoMensal({ dias: OUTUBRO, funcionarios, mapaEscala, filtroDescricao: descricao(FILTRO_ESCALA_VAZIO), geradoEm: GERADO_EM });
  const aba = modelo.planilhas.find((p) => p.nome === 'Mensal');
  for (const l of aba.linhas) {
    const f = funcionarios.find((x) => x.nome === l[0]);
    const info = classificarCelulaMensal(obterEstadoDia(mapaEscala, f.id, l[2]));
    if (info.tipo !== 'trabalho') continue;
    assert.equal(l[5] === 'Sim', info.manha);
    assert.equal(l[6] === 'Sim', info.tarde);
    assert.equal(l[7], leituraMensal(info));
  }
  // período totalmente fora das faixas: mostra o horário real, nunca "vazio"
  const fora = celulaMensalPdf({ tipo: 'trabalho', periodos: [{ hora_inicio: '20:00:00', hora_fim: '22:00:00' }], ocorrencia: null });
  assert.deepEqual(fora, { texto: '20:00–22:00', tom: 'trabalho' });
});

test('mensal: vários funcionários com filtro de cargo', () => {
  const filtro = { cargoId: 'c1', funcionarioId: '' };
  const modelo = montarExportacaoMensal({ dias: OUTUBRO, funcionarios: filtrarFuncionariosEscala(funcionarios, filtro), mapaEscala, filtroDescricao: descricao(filtro), geradoEm: GERADO_EM });
  assert.deepEqual(modelo.pdf.secoes[0].linhas.map((l) => l[0]), ['Ana Souza', 'Bia Lima', 'Maria Silva']);
  assert.ok(!modelo.planilhas[0].linhas.some((l) => l[0] === 'Carla Dias'));
  const grade = modelo.planilhas.find((p) => p.nome === 'Grade mensal');
  assert.equal(grade.colunas.length, 2 + 31);
  assert.equal(grade.linhas[0][2 + 9], 'M (Falta)'); // Ana, dia 10
});

// ------------------------------------------------------------
// COBERTURA
// ------------------------------------------------------------
function faixasEsperadas(base, data) {
  const estados = resolverEstadosDoDia({ funcionarios: base, mapaEscala, data });
  return calcularFaixasCobertura(estados.periodosPrevistos, estados.periodosEfetivos);
}

test('cobertura: resolverCoberturaPeriodo == motor por dia (refatoração sem mudar cálculo)', () => {
  const { faixasPorDia, porFuncionarioEDia } = resolverCoberturaPeriodo({ funcionarios, mapaEscala, dias: SEMANA });
  for (const data of SEMANA) assert.deepEqual(faixasPorDia.get(data), faixasEsperadas(funcionarios, data));
  assert.equal(porFuncionarioEDia.get('2026-10-05').size, 4);
  const resumo = faixasPorDia.get('2026-10-05').map((f) => [f.inicio, f.fim, f.efetivos.length, f.previstos.length]);
  assert.deepEqual(resumo, [
    ['06:00', '08:00', 2, 2],
    ['08:00', '10:00', 2, 3],
    ['10:00', '12:00', 3, 4],
    ['12:00', '14:00', 1, 2],
    ['14:00', '16:00', 1, 1],
  ]);
});

test('cobertura: sem filtro -- faixas, presenças e escala do período', () => {
  const modelo = montarExportacaoCobertura({ dias: SEMANA, funcionarios, funcionariosBase: funcionarios, mapaEscala, filtroDescricao: descricao(FILTRO_ESCALA_VAZIO), geradoEm: GERADO_EM });
  assert.equal(modelo.nomeArquivo, 'escala-cobertura_2026-10-05_a_2026-10-11');
  assert.deepEqual(modelo.planilhas.map((p) => p.nome), ['Cobertura por faixa', 'Presenças por faixa', 'Escala no período', 'Relatório']);
  const faixas = modelo.planilhas[0];
  const dia5 = faixas.linhas.filter((l) => l[0] === '2026-10-05');
  assert.deepEqual(dia5.map((l) => [l[2], l[3], l[4], l[5], l[6]]), [
    ['06:00', '08:00', 2, 2, 0],
    ['08:00', '10:00', 2, 3, 1],
    ['10:00', '12:00', 3, 4, 1],
    ['12:00', '14:00', 1, 2, 1],
    ['14:00', '16:00', 1, 1, 0],
  ]);
  const presencasBia = modelo.planilhas[1].linhas.filter((l) => l[4] === 'Bia Lima' && l[0] === '2026-10-05');
  assert.ok(presencasBia.length > 0 && presencasBia.every((l) => l[6] === 'Atestado'));
  const pdfFaixas = modelo.pdf.secoes[1];
  const linha10 = pdfFaixas.linhas.find((l) => l[0] === 'Seg 05/10' && l[1] === '10:00');
  assert.equal(linha10[5], 'Ana, Carla, Maria');
  assert.equal(linha10[6], 'Bia (Atestado)');
  // dia sem trabalho vira 1 linha explicativa (não some do relatório)
  assert.ok(pdfFaixas.linhas.some((l) => l[0] === 'Sex 09/10' && l[1].texto.startsWith('Sem períodos')));
});

test('cobertura: filtro por UMA funcionária NÃO recalcula a cobertura da equipe', () => {
  const filtro = { cargoId: '', funcionarioId: 'f-maria' };
  const modelo = montarExportacaoCobertura({
    dias: SEMANA,
    funcionarios: filtrarFuncionariosEscala(funcionarios, filtro),
    funcionariosBase: funcionariosDoCargo(funcionarios, filtro.cargoId),
    mapaEscala,
    filtroDescricao: descricao(filtro),
    geradoEm: GERADO_EM,
  });
  const faixas = modelo.planilhas[0];
  assert.equal(faixas.colunas[faixas.colunas.length - 1].titulo, 'Maria Silva presente');
  const dia5 = faixas.linhas.filter((l) => l[0] === '2026-10-05');
  // Quantidades IDÊNTICAS às da equipe toda -- nunca "1" por ter filtrado Maria.
  assert.deepEqual(dia5.map((l) => l[4]), [2, 2, 3, 1, 1]);
  assert.deepEqual(dia5.map((l) => l[8]), ['Não', 'Não', 'Sim', 'Sim', 'Sim']);
  // Linhas individuais: só Maria.
  assert.ok(modelo.planilhas[1].linhas.every((l) => l[4] === 'Maria Silva'));
  assert.ok(modelo.planilhas[2].linhas.every((l) => l[0] === 'Maria Silva'));
  assert.deepEqual(modelo.pdf.secoes[0].linhas.map((l) => l[0]), ['Maria Silva']);
  assert.match(modelo.pdf.secoes[1].nota, /NÃO altera este total/);
  const colunaMaria = modelo.pdf.secoes[1].linhas.filter((l) => l[0] === 'Seg 05/10').map((l) => l[7]);
  assert.deepEqual(colunaMaria, ['—', '—', 'Presente', 'Presente', 'Presente']);
  assert.ok(modelo.planilhas[3].linhas.some((l) => l[0] === 'Base da cobertura' && /todos os cargos/.test(l[1])));
});

test('cobertura: funcionária filtrada com falta aparece como ausente na faixa (não some, não conta)', () => {
  const filtro = { cargoId: '', funcionarioId: 'f-ana' };
  const modelo = montarExportacaoCobertura({
    dias: SEMANA,
    funcionarios: filtrarFuncionariosEscala(funcionarios, filtro),
    funcionariosBase: funcionariosDoCargo(funcionarios, ''),
    mapaEscala,
    filtroDescricao: descricao(filtro),
    geradoEm: GERADO_EM,
  });
  const linhaPdf = modelo.pdf.secoes[1].linhas.find((l) => l[0] === 'Sáb 10/10');
  assert.deepEqual(linhaPdf[3], { texto: '0', tom: 'falta' });
  assert.equal(linhaPdf[6], 'Ana (Falta)');
  assert.deepEqual(linhaPdf[7], { texto: 'Falta', tom: 'falta' });
  const presenca = modelo.planilhas[1].linhas.find((l) => l[0] === '2026-10-10');
  assert.deepEqual([presenca[4], presenca[6], presenca[7]], ['Ana Souza', 'Falta', 0]);
});

test('cobertura: filtro de cargo mantém a semântica publicada (cálculo restrito ao cargo)', () => {
  const filtro = { cargoId: 'c1', funcionarioId: '' };
  const base = funcionariosDoCargo(funcionarios, filtro.cargoId);
  const modelo = montarExportacaoCobertura({ dias: SEMANA, funcionarios: filtrarFuncionariosEscala(funcionarios, filtro), funcionariosBase: base, mapaEscala, filtroDescricao: descricao(filtro), geradoEm: GERADO_EM });
  const dia5 = modelo.planilhas[0].linhas.filter((l) => l[0] === '2026-10-05');
  const esperado = faixasEsperadas(base, '2026-10-05');
  assert.deepEqual(dia5.map((l) => [l[2], l[3], l[4]]), esperado.map((f) => [f.inicio, f.fim, f.efetivos.length]));
  assert.ok(dia5.every((l) => l[7] === 'Atendente'));
  assert.ok(!modelo.planilhas[1].linhas.some((l) => l[4] === 'Carla Dias'));
});

test('cobertura: cargo + funcionária incompatíveis -> sem linhas individuais', () => {
  const filtro = { cargoId: 'c2', funcionarioId: 'f-maria' };
  const modelo = montarExportacaoCobertura({
    dias: SEMANA,
    funcionarios: filtrarFuncionariosEscala(funcionarios, filtro),
    funcionariosBase: funcionariosDoCargo(funcionarios, filtro.cargoId),
    mapaEscala,
    filtroDescricao: descricao(filtro),
    geradoEm: GERADO_EM,
  });
  assert.equal(modelo.pdf.secoes[0].linhas.length, 0);
  assert.equal(modelo.planilhas[1].linhas.length, 0);
  assert.ok(modelo.planilhas[0].linhas.every((l) => l[8] === 'Não'));
});

// ------------------------------------------------------------
// EXCEL (.xlsx real)
// ------------------------------------------------------------
test('xlsx: utilitários (serial de data/hora, colunas)', () => {
  assert.equal(serialData('1900-03-01'), 61);
  assert.equal(serialData('2026-10-05'), 46300);
  assert.equal(serialHora('06:00'), 0.25);
  assert.equal(serialHora('19:30'), 19.5 / 24);
  assert.deepEqual([0, 25, 26, 27, 32].map(letraColuna), ['A', 'Z', 'AA', 'AB', 'AG']);
});

test('xlsx semanal: estrutura, tipos (data/hora/número), autofiltro e cabeçalho congelado', () => {
  const filtro = { cargoId: 'c1', funcionarioId: '' };
  const modelo = montarExportacaoSemanal({ dias: SEMANA, funcionarios: filtrarFuncionariosEscala(funcionarios, filtro), mapaEscala, filtroDescricao: descricao(filtro), geradoEm: GERADO_EM });
  const { nomes, abas, zip } = lerXlsx(modelo);
  assert.deepEqual(nomes, ['Escala semanal', 'Relatório']);
  const aba = abas.get('Escala semanal');
  assert.deepEqual(textoLinha(aba.linhas[0]), modelo.planilhas[0].colunas.map((c) => c.titulo));
  assert.ok(aba.linhas[0].every((c) => c.s === '1'), 'cabeçalho com estilo destacado');
  assert.match(aba.xml, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(aba.xml, new RegExp(`<autoFilter ref="A1:K${modelo.planilhas[0].linhas.length + 1}"/>`));
  assert.match(aba.xml, /<col min="1" max="1" width="28" customWidth="1"\/>/);
  const ana8 = aba.linhas.find((l) => l[0]?.v === 'Ana Souza' && l[3]?.v === serialData('2026-10-08'));
  assert.equal(ana8[3].t, 'n');
  assert.equal(ana8[3].s, '2'); // estilo data dd/mm/aaaa
  assert.equal(ana8[7].v, 1);
  assert.equal(ana8[8].v, serialHora('07:00'));
  assert.equal(ana8[8].s, '3'); // estilo hora hh:mm
  assert.ok(!aba.linhas.some((l) => l[0]?.v === 'Carla Dias'), 'filtro de cargo respeitado');
  assert.match(zip.get('xl/styles.xml'), /formatCode="dd\/mm\/yyyy"/);
  assert.match(zip.get('xl/styles.xml'), /formatCode="hh:mm"/);
  assert.match(zip.get('xl/workbook.xml'), /_xlnm\._FilterDatabase/);
  const rel = abas.get('Relatório').linhas.map(textoLinha);
  assert.deepEqual(rel.find((l) => l[0] === 'Cargo'), ['Cargo', 'Atendente']);
  assert.deepEqual(rel.find((l) => l[0] === 'Funcionária'), ['Funcionária', 'Todas as funcionárias']);
});

test('xlsx mensal e cobertura: abas e colunas esperadas', () => {
  const mensal = lerXlsx(montarExportacaoMensal({ dias: OUTUBRO, funcionarios, mapaEscala, filtroDescricao: descricao(FILTRO_ESCALA_VAZIO), geradoEm: GERADO_EM }));
  assert.deepEqual(mensal.nomes, ['Mensal', 'Grade mensal', 'Relatório']);
  assert.equal(mensal.abas.get('Mensal').linhas.length, 1 + 4 * 31);
  assert.equal(mensal.abas.get('Grade mensal').linhas[0].length, 33);

  const filtro = { cargoId: '', funcionarioId: 'f-maria' };
  const cobertura = lerXlsx(
    montarExportacaoCobertura({
      dias: SEMANA,
      funcionarios: filtrarFuncionariosEscala(funcionarios, filtro),
      funcionariosBase: funcionariosDoCargo(funcionarios, ''),
      mapaEscala,
      filtroDescricao: descricao(filtro),
      geradoEm: GERADO_EM,
    })
  );
  assert.deepEqual(cobertura.nomes, ['Cobertura por faixa', 'Presenças por faixa', 'Escala no período', 'Relatório']);
  const faixas = cobertura.abas.get('Cobertura por faixa').linhas;
  assert.deepEqual(textoLinha(faixas[0]), ['Data', 'Dia', 'Início', 'Fim', 'Cobertura (presentes)', 'Previstas', 'Ausentes', 'Base do cálculo', 'Maria Silva presente']);
  assert.equal(faixas[1][4].t, 'n');
  assert.equal(faixas[3][4].v, 3); // 10:00–12:00 de 05/10: equipe toda
});

test('xlsx: caracteres especiais escapados e nomes de aba válidos', () => {
  const { nomes, abas } = lerXlsx({
    titulo: 'x',
    planilhas: [
      { nome: 'A/B: teste [1]*?', colunas: [{ titulo: 'Texto', tipo: 'texto' }], linhas: [['<a & "b">']] },
      { nome: 'A/B: teste [1]*?', colunas: [{ titulo: 'N', tipo: 'numero' }], linhas: [[5], [null]] },
    ],
  });
  assert.equal(nomes.length, 2);
  assert.notEqual(nomes[0], nomes[1]);
  assert.ok(nomes.every((n) => n.length <= 31 && !/[[\]:*?/\\]/.test(n)));
  assert.equal(abas.get(nomes[0]).linhas[1][0].v, '<a & "b">');
});

// ------------------------------------------------------------
// PDF
// ------------------------------------------------------------
test('pdf semanal: arquivo válido, cabeçalho com período/filtros e dados filtrados', () => {
  const filtro = { cargoId: 'c1', funcionarioId: 'f-maria' };
  const modelo = montarExportacaoSemanal({ dias: SEMANA, funcionarios: filtrarFuncionariosEscala(funcionarios, filtro), mapaEscala, filtroDescricao: descricao(filtro), geradoEm: GERADO_EM });
  const pdf = lerPdf(modelo);
  assert.equal(pdf.paginas, 1);
  assert.match(pdf.texto, /\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/); // A4 paisagem (297 x 210 mm)
  for (const s of ['PADOCA DA MATA', 'Escala — Semanal', '05/10 — 11/10/2026', 'Cargo: Atendente', 'Funcionária: Maria Silva', 'Gerado em 06/10/2026 09:30', 'Maria Silva', '10:00–16:00', 'Página 1 de 1']) {
    assert.ok(noPdf(pdf, s), `PDF contém "${s}"`);
  }
  assert.ok(!noPdf(pdf, 'Ana Souza'), 'filtrada fora não aparece');
});

test('pdf mensal: os dois blocos de dias na mesma página, legenda M/T', () => {
  const modelo = montarExportacaoMensal({ dias: OUTUBRO, funcionarios, mapaEscala, filtroDescricao: descricao(FILTRO_ESCALA_VAZIO), geradoEm: GERADO_EM });
  const pdf = lerPdf(modelo);
  assert.equal(pdf.paginas, 1);
  assert.ok(noPdf(pdf, 'Página 1 de 1'));
  for (const s of ['Escala — Mensal', 'Outubro de 2026', 'Cargo: Todos', 'Funcionária: Todas', 'Dias 01/10 a 16/10', 'Dias 17/10 a 31/10', 'M+T', 'Atestado', 'M = ocupa 06:00–12:00']) {
    assert.ok(noPdf(pdf, s), `PDF contém "${s}"`);
  }
});

// Mensal "pesado" com o tamanho atual da equipe (8): todos os dias com
// trabalho e metade com ocorrência (célula de 2 linhas) -- pior caso de
// altura para a página única.
function mensalPesado(qtd) {
  const equipe = Array.from({ length: qtd }, (_, i) => func(`p${i}`, `Funcionária ${String(i + 1).padStart(2, '0')} Sobrenome`, i % 2 ? ATENDENTE : PADEIRA));
  const dias = [];
  const periodos = new Map();
  const ocorrencias = new Map();
  let n = 0;
  for (const data of OUTUBRO) {
    equipe.forEach((f, i) => {
      const id = `m${++n}`;
      dias.push({ id, funcionario_id: f.id, data, tipo_dia: 'trabalho' });
      periodos.set(id, [{ hora_inicio: '06:00:00', hora_fim: '15:00:00' }]);
      if ((Number(data.slice(8)) + i) % 2 === 0) ocorrencias.set(id, { tipo: i % 3 ? 'falta' : 'atestado' });
    });
  }
  return { equipe, mapa: construirMapaEscala(dias, periodos, ocorrencias) };
}

test('pdf mensal: 8 funcionárias no pior caso cabem em 1 página, cabeçalho uma vez, 2º bloco completo', () => {
  const { equipe, mapa } = mensalPesado(8);
  const modelo = montarExportacaoMensal({ dias: OUTUBRO, funcionarios: equipe, mapaEscala: mapa, filtroDescricao: descricao(FILTRO_ESCALA_VAZIO), geradoEm: GERADO_EM });
  const pdf = lerPdf(modelo);
  assert.equal(pdf.paginas, 1);
  assert.ok(noPdf(pdf, 'Página 1 de 1'));
  assert.equal(pdf.texto.split(winAnsi('(Escala — Mensal)')).length - 1, 1, 'identificação desenhada uma única vez');
  assert.ok(noPdf(pdf, 'Dias 01/10 a 16/10') && noPdf(pdf, 'Dias 17/10 a 31/10'));
  // 2º bloco: todos os cabeçalhos de dia 17..31 e todas as linhas (cada nome 2x: um por bloco)
  for (let d = 17; d <= 31; d++) assert.ok(pdf.texto.includes(`(${d}) Tj`), `cabeçalho do dia ${d}`);
  for (const f of equipe) assert.equal(pdf.texto.split(`(${f.nome}) Tj`).length - 1, 2, `${f.nome} nos dois blocos`);
  // quantidade de células desenhadas = 8 linhas x 31 dias (M+T em todas)
  assert.equal(pdf.texto.split('(M+T) Tj').length - 1, 8 * 31);
  assert.ok(noPdf(pdf, 'M = ocupa 06:00–12:00'), 'legenda na mesma página');
});

test('pdf mensal: equipe excepcionalmente grande pagina sem perder linhas', () => {
  const { equipe, mapa } = mensalPesado(40);
  const modelo = montarExportacaoMensal({ dias: OUTUBRO, funcionarios: equipe, mapaEscala: mapa, filtroDescricao: descricao(FILTRO_ESCALA_VAZIO), geradoEm: GERADO_EM });
  const pdf = lerPdf(modelo);
  assert.ok(pdf.paginas > 1);
  for (const f of equipe) assert.equal(pdf.texto.split(`(${f.nome}) Tj`).length - 1, 2, `${f.nome} nos dois blocos`);
  assert.equal(pdf.texto.split('(M+T) Tj').length - 1, 40 * 31);
  assert.ok(noPdf(pdf, `Página ${pdf.paginas} de ${pdf.paginas}`));
});

test('pdf cobertura: muitas funcionárias -> paginação com cabeçalho repetido', () => {
  const muitas = Array.from({ length: 60 }, (_, i) => func(`f${i}`, `Pessoa ${String(i).padStart(2, '0')}`, ATENDENTE));
  const modelo = montarExportacaoCobertura({ dias: SEMANA, funcionarios: muitas, funcionariosBase: muitas, mapaEscala: new Map(), filtroDescricao: descricao(FILTRO_ESCALA_VAZIO), geradoEm: GERADO_EM });
  const pdf = lerPdf(modelo);
  assert.ok(pdf.paginas >= 3, `paginou (${pdf.paginas})`);
  const repeticoes = pdf.texto.split(winAnsi('(Escala — Cobertura)')).length - 1;
  assert.ok(repeticoes >= pdf.paginas, 'identificação do relatório em todas as páginas');
  assert.ok(noPdf(pdf, `Página ${pdf.paginas} de ${pdf.paginas}`));
  assert.ok(noPdf(pdf, 'Pessoa 59'));
});

test('geradoEm: formato dd/mm/aaaa hh:mm no fuso de São Paulo', () => {
  assert.equal(formatarGeradoEm(new Date('2026-10-06T12:05:00Z')), '06/10/2026 09:05');
  assert.equal(formatarGeradoEm(new Date('2026-10-07T02:30:00Z')), '06/10/2026 23:30');
});

