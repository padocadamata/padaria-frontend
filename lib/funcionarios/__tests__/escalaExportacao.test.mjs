// node --import ./lib/funcionarios/__tests__/resolverImports.mjs --test lib/funcionarios/__tests__/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { construirMapaEscala, obterEstadoDia } from '../escala.js';
import { classificarCelulaMensal } from '../escalaFaixas.js';
import { resolverCoberturaPeriodo, resolverEstadosDoDia, calcularFaixasCobertura } from '../escalaCobertura.js';
import { agruparPorCargo, funcionariasDosGrupos } from '../escalaGrupos.js';
import { FILTRO_ESCALA_VAZIO, filtrarFuncionariosEscala, funcionariosDoCargo, descreverFiltroEscala, funcionariasDisponiveisNoFiltro, normalizarFiltroEscala } from '../escalaFiltro.js';
import { montarMapaFeriados } from '../escalaFeriados.js';
import {
  montarExportacaoSemanal,
  montarExportacaoMensal,
  montarExportacaoCobertura,
  basesDeCobertura,
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
const OUTUBRO = diasDoMes('2026-10-01');

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
// Equipe toda agrupada por cargo, como a tela: Atendente (Ana, Bia, Maria)
// e Padeira (Carla).
const grupos = agruparPorCargo(funcionarios);
const grupoSo = (...pessoas) => agruparPorCargo(pessoas);
const descricao = (filtro) => descreverFiltroEscala(filtro, { cargos, funcionarios });
// MESMO caminho da tela: filtro -> agrupamento por cargo.
const gruposDoFiltro = (filtro) => agruparPorCargo(filtrarFuncionariosEscala(funcionarios, filtro));
const gruposBaseDoFiltro = (filtro) => agruparPorCargo(funcionariosDoCargo(funcionarios, filtro.cargoId));
const FERIADOS = montarMapaFeriados([
  { data: '2026-10-12', nome: 'Nossa Senhora Aparecida' },
  { data: '2026-10-09', nome: 'Feriado de teste' },
]);
const linhasDePessoas = (secao) => secao.linhas;
// Leitura "1ª coluna, com o rótulo do grupo onde ele começa" de uma seção do PDF.
const leituraAgrupada = (secao) => {
  const rotulos = new Map(secao.inicioGrupos.map((g) => [g.indice, g.rotulo]));
  return secao.linhas.flatMap((l, i) => (rotulos.has(i) ? [`# ${rotulos.get(i)}`, l[0]] : [l[0]]));
};

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
// AGRUPAMENTO NO ARQUIVO
// ------------------------------------------------------------
test('agrupamento: início de cada cargo marcado no PDF (sem linha extra), equipe toda no Excel', () => {
  const modelo = montarExportacaoSemanal({ dias: SEMANA, grupos, mapaEscala, geradoEm: GERADO_EM });
  const secao = modelo.pdf.secoes[0];
  assert.equal(secao.linhas.length, 4); // só as funcionárias -- nenhuma linha de título
  assert.deepEqual(secao.inicioGrupos, [
    { indice: 0, rotulo: 'Atendente · 3 funcionárias' },
    { indice: 3, rotulo: 'Padeira · 1 funcionária' },
  ]);
  assert.deepEqual(leituraAgrupada(secao), [
    '# Atendente · 3 funcionárias',
    'Ana Souza',
    'Bia Lima',
    'Maria Silva',
    '# Padeira · 1 funcionária',
    'Carla Dias',
  ]);
  // Excel: mesma ordem (grupo a grupo), coluna Cargo identifica o grupo.
  const nomes = [...new Set(modelo.planilhas[0].linhas.map((l) => `${l[0]}|${l[1]}`))];
  assert.deepEqual(nomes, ['Ana Souza|Atendente', 'Bia Lima|Atendente', 'Maria Silva|Atendente', 'Carla Dias|Padeira']);
});

test('agrupamento: sem filtro, nenhuma linha de filtro na aba Relatório', () => {
  const modelo = montarExportacaoMensal({ dias: diasDoMes('2026-10-01'), grupos, mapaEscala, filtroDescricao: descricao(FILTRO_ESCALA_VAZIO), geradoEm: GERADO_EM });
  assert.deepEqual(modelo.filtros, { cargo: null, funcionario: null });
  const rel = modelo.planilhas.find((p) => p.nome === 'Relatório').linhas.map((l) => l[0]);
  assert.deepEqual(rel, ['Empresa', 'Relatório', 'Período', 'Organização', 'Gerado em']);
});

// ------------------------------------------------------------
// FILTROS (escalaFiltro.js, restaurado) + agrupamento por cargo
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

test('filtro: lista de funcionárias depende do cargo selecionado', () => {
  assert.deepEqual(funcionariasDisponiveisNoFiltro(funcionarios, '').map((f) => f.id), ['f-ana', 'f-bia', 'f-carla', 'f-maria']);
  assert.deepEqual(funcionariasDisponiveisNoFiltro(funcionarios, 'c1').map((f) => f.id), ['f-ana', 'f-bia', 'f-maria']);
  assert.deepEqual(funcionariasDisponiveisNoFiltro(funcionarios, 'c2').map((f) => f.id), ['f-carla']);
});

test('filtro: trocar para cargo incompatível limpa a funcionária; compatível mantém; limpar volta ao vazio', () => {
  assert.deepEqual(normalizarFiltroEscala({ cargoId: 'c2', funcionarioId: 'f-maria' }, funcionarios), { cargoId: 'c2', funcionarioId: '' });
  assert.deepEqual(normalizarFiltroEscala({ cargoId: 'c1', funcionarioId: 'f-maria' }, funcionarios), { cargoId: 'c1', funcionarioId: 'f-maria' });
  assert.deepEqual(normalizarFiltroEscala({ cargoId: '', funcionarioId: 'f-sumiu' }, funcionarios), { cargoId: '', funcionarioId: '' });
  assert.deepEqual(normalizarFiltroEscala(FILTRO_ESCALA_VAZIO, funcionarios), FILTRO_ESCALA_VAZIO);
  assert.deepEqual(funcionariasDosGrupos(gruposDoFiltro(FILTRO_ESCALA_VAZIO)).length, 4);
});

test('filtro + agrupamento: título do cargo permanece (cargo, funcionária, cargo+funcionária)', () => {
  assert.deepEqual(gruposDoFiltro(FILTRO_ESCALA_VAZIO).map((g) => [g.nome, g.funcionarios.length]), [['Atendente', 3], ['Padeira', 1]]);
  assert.deepEqual(gruposDoFiltro({ cargoId: 'c1', funcionarioId: '' }).map((g) => [g.nome, g.funcionarios.length]), [['Atendente', 3]]);
  assert.deepEqual(gruposDoFiltro({ cargoId: '', funcionarioId: 'f-carla' }).map((g) => [g.nome, g.funcionarios.map((f) => f.id)]), [['Padeira', ['f-carla']]]);
  assert.deepEqual(gruposDoFiltro({ cargoId: 'c1', funcionarioId: 'f-maria' }).map((g) => [g.nome, g.funcionarios.map((f) => f.id)]), [['Atendente', ['f-maria']]]);
  assert.deepEqual(gruposDoFiltro({ cargoId: 'c2', funcionarioId: 'f-maria' }), []); // combinação incompatível = vazio
});

// ------------------------------------------------------------
// EXPORTAÇÃO = MESMA POPULAÇÃO DA TELA (os três modelos)
// ------------------------------------------------------------
const CENARIOS_FILTRO = [
  { nome: 'sem filtro', filtro: FILTRO_ESCALA_VAZIO, ids: ['f-ana', 'f-bia', 'f-maria', 'f-carla'], cargo: null, funcionaria: null },
  { nome: 'cargo', filtro: { cargoId: 'c1', funcionarioId: '' }, ids: ['f-ana', 'f-bia', 'f-maria'], cargo: 'Atendente', funcionaria: null },
  { nome: 'funcionária', filtro: { cargoId: '', funcionarioId: 'f-maria' }, ids: ['f-maria'], cargo: null, funcionaria: 'Maria Silva' },
  { nome: 'cargo + funcionária', filtro: { cargoId: 'c2', funcionarioId: 'f-carla' }, ids: ['f-carla'], cargo: 'Padeira', funcionaria: 'Carla Dias' },
];
const idsDasLinhas = (linhas, coluna = 0) => [...new Set(linhas.map((l) => l[coluna]))].map((nome) => funcionarios.find((f) => f.nome === nome)?.id);

for (const cenario of CENARIOS_FILTRO) {
  test(`exportação (${cenario.nome}): semanal/mensal/cobertura com exatamente a população da tela`, () => {
    const comum = { mapaEscala, filtroDescricao: descricao(cenario.filtro), geradoEm: GERADO_EM };
    const semanal = montarExportacaoSemanal({ dias: SEMANA, grupos: gruposDoFiltro(cenario.filtro), ...comum });
    const mensal = montarExportacaoMensal({ dias: OUTUBRO, grupos: gruposDoFiltro(cenario.filtro), ...comum });
    const cobertura = montarExportacaoCobertura({ dias: SEMANA, grupos: gruposDoFiltro(cenario.filtro), gruposBase: gruposBaseDoFiltro(cenario.filtro), ...comum });

    assert.deepEqual(idsDasLinhas(semanal.pdf.secoes[0].linhas), cenario.ids);
    assert.deepEqual(idsDasLinhas(semanal.planilhas[0].linhas), cenario.ids);
    for (const secao of mensal.pdf.secoes) assert.deepEqual(idsDasLinhas(secao.linhas), cenario.ids);
    assert.deepEqual(idsDasLinhas(mensal.planilhas.find((a) => a.nome === 'Mensal').linhas), cenario.ids);
    assert.deepEqual(idsDasLinhas(mensal.planilhas.find((a) => a.nome === 'Grade mensal').linhas), cenario.ids);
    assert.deepEqual(idsDasLinhas(cobertura.pdf.secoes[0].linhas), cenario.ids);
    assert.deepEqual(idsDasLinhas(cobertura.planilhas.find((a) => a.nome === 'Escala no período').linhas), cenario.ids);
    const presencas = cobertura.planilhas.find((a) => a.nome === 'Presenças por faixa').linhas;
    assert.ok(presencas.every((l) => cenario.ids.includes(funcionarios.find((f) => f.nome === l[4]).id)), 'presenças só da população exibida');

    for (const modelo of [semanal, mensal, cobertura]) {
      assert.deepEqual(modelo.filtros, { cargo: cenario.cargo, funcionario: cenario.funcionaria });
      const rel = modelo.planilhas.find((a) => a.nome === 'Relatório').linhas;
      assert.deepEqual(rel.find((l) => l[0] === 'Cargo')?.[1] ?? null, cenario.cargo);
      assert.deepEqual(rel.find((l) => l[0] === 'Funcionária')?.[1] ?? null, cenario.funcionaria);
      // arquivo individual: o nome do arquivo identifica a funcionária
      const slug = cenario.funcionaria ? `_${cenario.funcionaria.toLowerCase().replace(' ', '-')}` : null;
      if (slug) assert.ok(modelo.nomeArquivo.endsWith(slug), modelo.nomeArquivo);
      else assert.ok(!/_(maria|carla|ana|bia)/.test(modelo.nomeArquivo), modelo.nomeArquivo);
    }
  });
}

test('exportação cobertura: filtro de funcionária NÃO muda o total (base = recorte de cargo)', () => {
  const filtro = { cargoId: '', funcionarioId: 'f-maria' };
  const modelo = montarExportacaoCobertura({ dias: SEMANA, grupos: gruposDoFiltro(filtro), gruposBase: gruposBaseDoFiltro(filtro), mapaEscala, filtroDescricao: descricao(filtro), geradoEm: GERADO_EM });
  const geral5 = modelo.planilhas[0].linhas.filter((l) => l[0] === '2026-10-05' && l[7] === 'Todos os cargos');
  assert.deepEqual(geral5.map((l) => l[4]), [2, 2, 3, 1, 1]); // equipe toda -- nunca "1"
  // só a linha do cargo da Maria (Atendente) além da geral
  assert.deepEqual([...new Set(modelo.planilhas[0].linhas.map((l) => l[7]))], ['Todos os cargos', 'Atendente']);
  assert.match(modelo.pdf.secoes[1].nota, /NÃO altera este total/);
  assert.ok(modelo.planilhas[3].linhas.some((l) => l[0] === 'Base da cobertura' && /não restrita pelo filtro de funcionária/.test(l[1])));
});

test('exportação cobertura: filtro de cargo -> cálculo só do cargo (semântica publicada)', () => {
  const filtro = { cargoId: 'c1', funcionarioId: '' };
  const modelo = montarExportacaoCobertura({ dias: SEMANA, grupos: gruposDoFiltro(filtro), gruposBase: gruposBaseDoFiltro(filtro), mapaEscala, filtroDescricao: descricao(filtro), geradoEm: GERADO_EM });
  const dia5 = modelo.planilhas[0].linhas.filter((l) => l[0] === '2026-10-05');
  const esperado = faixasEsperadas(funcionariosDoCargo(funcionarios, 'c1'), '2026-10-05');
  assert.deepEqual(dia5.map((l) => [l[2], l[3], l[4]]), esperado.map((f) => [f.inicio, f.fim, f.efetivos.length]));
  assert.ok(dia5.every((l) => l[7] === 'Atendente'));
  assert.deepEqual(modelo.pdf.secoes.map((sec) => sec.titulo), ['Horários no período', 'Cobertura por faixa horária']);
});

test('pdf individual: cabeçalho com Cargo/Funcionária só quando ativos', () => {
  const filtro = { cargoId: 'c1', funcionarioId: 'f-maria' };
  const pdf = lerPdf(montarExportacaoSemanal({ dias: SEMANA, grupos: gruposDoFiltro(filtro), mapaEscala, filtroDescricao: descricao(filtro), geradoEm: GERADO_EM }));
  assert.ok(noPdf(pdf, 'Cargo: Atendente') && noPdf(pdf, 'Funcionária: Maria Silva'));
  assert.ok(noPdf(pdf, 'Maria Silva') && !noPdf(pdf, 'Ana Souza'), 'só a funcionária filtrada');
  const soFuncionaria = lerPdf(montarExportacaoMensal({ dias: OUTUBRO, grupos: gruposDoFiltro({ cargoId: '', funcionarioId: 'f-carla' }), mapaEscala, filtroDescricao: descricao({ cargoId: '', funcionarioId: 'f-carla' }), geradoEm: GERADO_EM }));
  assert.ok(noPdf(soFuncionaria, 'Funcionária: Carla Dias') && !noPdf(soFuncionaria, 'Cargo: '));
});

// ------------------------------------------------------------
// FERIADOS NOS ARQUIVOS (só informação)
// ------------------------------------------------------------
test('feriados: F* no cabeçalho, nome na legenda/coluna Feriado/aba Relatório -- valores da escala inalterados', () => {
  const filtro = { cargoId: '', funcionarioId: 'f-ana' };
  const semComFeriado = montarExportacaoSemanal({ dias: SEMANA, grupos: gruposDoFiltro(filtro), mapaEscala, filtroDescricao: descricao(filtro), geradoEm: GERADO_EM });
  const comFeriado = montarExportacaoSemanal({ dias: ['2026-10-12', ...SEMANA.slice(1)], grupos: gruposDoFiltro(filtro), mapaEscala, filtroDescricao: descricao(filtro), feriados: FERIADOS, geradoEm: GERADO_EM });
  assert.equal(comFeriado.pdf.secoes[0].cabecalho[2], 'Seg 12/10 F*');
  assert.equal(comFeriado.pdf.secoes[0].cabecalho[6], 'Sex 09/10 F*'); // [Funcionária, Cargo, 12/10, 06, 07, 08, 09, ...]
  assert.match(comFeriado.pdf.legenda, /F\* = feriado: 12\/10 Nossa Senhora Aparecida; 09\/10 Feriado de teste/);
  const aba = comFeriado.planilhas[0];
  assert.equal(aba.colunas.at(-1).titulo, 'Feriado');
  assert.equal(aba.linhas.find((l) => l[3] === '2026-10-12')[11], 'Nossa Senhora Aparecida');
  assert.equal(aba.linhas.find((l) => l[3] === '2026-10-06')[11], '');
  assert.ok(comFeriado.planilhas[1].linhas.some((l) => l[0] === 'Feriados no período' && /Nossa Senhora Aparecida/.test(l[1])));
  // feriado nunca altera a escala exportada (mesmo estado do dia 09/10 com e sem feriado)
  const dia9 = (m) => m.planilhas[0].linhas.find((l) => l[3] === '2026-10-09').slice(0, 11);
  assert.deepEqual(dia9(comFeriado), dia9(semComFeriado));
  assert.ok(!semComFeriado.pdf.legenda.includes('F*'));
});

test('feriados: mensal e cobertura marcam a data e trazem o nome (arquivo individual incluso)', () => {
  const filtro = { cargoId: '', funcionarioId: 'f-maria' };
  const mensal = montarExportacaoMensal({ dias: OUTUBRO, grupos: gruposDoFiltro(filtro), mapaEscala, filtroDescricao: descricao(filtro), feriados: FERIADOS, geradoEm: GERADO_EM });
  assert.ok(mensal.pdf.secoes[0].cabecalho.includes('Seg\n12 F*'));
  assert.match(mensal.pdf.legenda, /Nossa Senhora Aparecida/);
  const linhaMensal = mensal.planilhas.find((a) => a.nome === 'Mensal').linhas.find((l) => l[2] === '2026-10-12');
  assert.equal(linhaMensal.at(-1), 'Nossa Senhora Aparecida');
  assert.ok(mensal.planilhas.find((a) => a.nome === 'Grade mensal').colunas.some((c) => c.titulo === '12 Seg F*'));
  const pdf = lerPdf(mensal);
  assert.equal(pdf.paginas, 1);
  // texto corrido (a legenda pode quebrar linha no meio do nome do feriado)
  const corrido = [...pdf.texto.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]).join(' ').replace(/\s+/g, ' ');
  assert.ok(corrido.includes('Nossa Senhora Aparecida'), 'nome do feriado na legenda');
  assert.ok(noPdf(pdf, '12 F*'), 'F* no cabeçalho do dia');

  const cobertura = montarExportacaoCobertura({ dias: SEMANA, grupos: gruposDoFiltro(filtro), gruposBase: gruposBaseDoFiltro(filtro), mapaEscala, filtroDescricao: descricao(filtro), feriados: FERIADOS, geradoEm: GERADO_EM });
  assert.ok(cobertura.pdf.secoes[1].linhas.some((l) => l[0] === 'Sex 09/10 F*'));
  assert.ok(cobertura.planilhas[0].colunas.at(-1).titulo === 'Feriado');
  assert.ok(cobertura.planilhas[2].linhas.filter((l) => l[3] === '2026-10-09').every((l) => l[11] === 'Feriado de teste'));
});

// ------------------------------------------------------------
// SEMANAL
// ------------------------------------------------------------
test('semanal: 1 funcionária -- estados, 2 períodos no mesmo dia, folga/falta/não definido', () => {
  const modelo = montarExportacaoSemanal({ dias: SEMANA, grupos: grupoSo(ANA), mapaEscala, geradoEm: GERADO_EM });
  assert.equal(modelo.nomeArquivo, 'escala-semanal_2026-10-05_a_2026-10-11');
  assert.equal(modelo.periodoRotulo, '05/10 — 11/10/2026');

  const aba = modelo.planilhas[0];
  assert.equal(aba.nome, 'Escala semanal');
  assert.deepEqual(aba.colunas.map((c) => c.titulo), ['Funcionária', 'Cargo', 'Vínculo', 'Data', 'Dia da semana', 'Estado', 'Ocorrência', 'Período nº', 'Início', 'Fim', 'Natureza', 'Feriado']);
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
  const [linhaAna] = linhasDePessoas(grade);
  assert.equal(linhaAna[5].texto, '07:00–11:00\n14:00–18:00');
  assert.deepEqual(linhaAna[6], { texto: 'Folga', tom: 'folga' });
  assert.deepEqual(linhaAna[7], { texto: '06:00–12:00\nFALTA', tom: 'falta' });
  assert.deepEqual(linhaAna[8], { texto: '—', tom: 'vazio' });
});

test('semanal: vários funcionários, atestado e período extra', () => {
  const modelo = montarExportacaoSemanal({ dias: SEMANA, grupos, mapaEscala, geradoEm: GERADO_EM });
  const linhas = linhasDePessoas(modelo.pdf.secoes[0]);
  assert.deepEqual(linhas.map((l) => l[0]), ['Ana Souza', 'Bia Lima', 'Maria Silva', 'Carla Dias']);
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

test('mensal: M, T, M+T, folga, falta, atestado', () => {
  const modelo = montarExportacaoMensal({ dias: OUTUBRO, grupos, mapaEscala, geradoEm: GERADO_EM });
  assert.equal(modelo.nomeArquivo, 'escala-mensal_2026-10');
  assert.equal(modelo.periodoRotulo, 'Outubro de 2026');
  const aba = modelo.planilhas.find((p) => p.nome === 'Mensal');
  assert.deepEqual(aba.colunas.map((c) => c.titulo), ['Funcionária', 'Cargo', 'Data', 'Dia', 'Estado', 'M', 'T', 'Leitura', 'Ocorrência', 'Horários', 'Feriado']);
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
  assert.deepEqual(b1.inicioGrupos, b2.inicioGrupos);
  assert.equal(b1.linhas.length, 4);
  const ana = linhasDePessoas(b1)[0];
  assert.deepEqual(ana.slice(5, 11), [
    { texto: 'M', tom: 'trabalho' },
    { texto: 'T', tom: 'trabalho' },
    { texto: 'M\nT', tom: 'trabalho' }, // manhã+tarde EMPILHADO no PDF
    { texto: 'M\nT', tom: 'trabalho' },
    { texto: 'Folga', tom: 'folga' },
    { texto: 'M\nFalta', tom: 'falta' },
  ]);
  assert.deepEqual(linhasDePessoas(b1)[1][5], { texto: 'M\nT\nAtestado', tom: 'atestado', compactar: true });
});

test('mensal: exportação nunca diverge de classificarCelulaMensal (sem regra paralela)', () => {
  const modelo = montarExportacaoMensal({ dias: OUTUBRO, grupos, mapaEscala, geradoEm: GERADO_EM });
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

test('mensal: equipe toda agrupada -- cargos em ordem, cada funcionária uma vez por bloco', () => {
  const modelo = montarExportacaoMensal({ dias: OUTUBRO, grupos, mapaEscala, geradoEm: GERADO_EM });
  for (const secao of modelo.pdf.secoes) {
    assert.deepEqual(leituraAgrupada(secao), [
      '# Atendente · 3 funcionárias',
      'Ana Souza',
      'Bia Lima',
      'Maria Silva',
      '# Padeira · 1 funcionária',
      'Carla Dias',
    ]);
  }
  const grade = modelo.planilhas.find((p) => p.nome === 'Grade mensal');
  assert.equal(grade.colunas.length, 2 + 31);
  assert.deepEqual(grade.linhas.map((l) => l[0]), ['Ana Souza', 'Bia Lima', 'Maria Silva', 'Carla Dias']);
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

test('cobertura: geral (equipe toda) + uma cobertura por cargo, mesmo motor', () => {
  const modelo = montarExportacaoCobertura({ dias: SEMANA, grupos, mapaEscala, geradoEm: GERADO_EM });
  assert.equal(modelo.nomeArquivo, 'escala-cobertura_2026-10-05_a_2026-10-11');
  assert.deepEqual(modelo.planilhas.map((p) => p.nome), ['Cobertura por faixa', 'Presenças por faixa', 'Escala no período', 'Relatório']);
  const faixas = modelo.planilhas[0];
  // Geral de 05/10: os MESMOS números de antes sem filtro.
  const geral5 = faixas.linhas.filter((l) => l[0] === '2026-10-05' && l[7] === 'Todos os cargos');
  assert.deepEqual(geral5.map((l) => [l[2], l[3], l[4], l[5], l[6]]), [
    ['06:00', '08:00', 2, 2, 0],
    ['08:00', '10:00', 2, 3, 1],
    ['10:00', '12:00', 3, 4, 1],
    ['12:00', '14:00', 1, 2, 1],
    ['14:00', '16:00', 1, 1, 0],
  ]);
  // Cada cargo = o número que antes saía com o filtro daquele cargo.
  for (const grupo of grupos) {
    const doCargo = faixas.linhas.filter((l) => l[0] === '2026-10-05' && l[7] === grupo.nome);
    const esperado = faixasEsperadas(grupo.funcionarios, '2026-10-05');
    assert.deepEqual(doCargo.map((l) => [l[2], l[3], l[4]]), esperado.map((f) => [f.inicio, f.fim, f.efetivos.length]));
  }
  assert.ok(faixas.linhas.some((l) => l[7] === 'Padeira'));
  // PDF: horários (agrupados) + Geral + Atendente + Padeira.
  assert.deepEqual(modelo.pdf.secoes.map((sec) => sec.titulo), [
    'Horários no período',
    'Cobertura por faixa horária · Todos os cargos',
    'Cobertura por faixa horária · Atendente',
    'Cobertura por faixa horária · Padeira',
  ]);
  assert.match(modelo.pdf.secoes[1].nota, /equipe toda/);
  assert.match(modelo.pdf.secoes[3].nota, /só sobre o cargo Padeira/);
  const linha10 = modelo.pdf.secoes[1].linhas.find((l) => l[0] === 'Seg 05/10' && l[1] === '10:00');
  assert.equal(linha10[5], 'Ana, Carla, Maria');
  assert.equal(linha10[6], 'Bia (Atestado)');
  // dia sem trabalho vira 1 linha explicativa (não some do relatório)
  assert.ok(modelo.pdf.secoes[1].linhas.some((l) => l[0] === 'Sex 09/10' && l[1].texto.startsWith('Sem períodos')));
  // Presenças: 1 vez por pessoa (só da base geral), com o cargo.
  const presencasBia = modelo.planilhas[1].linhas.filter((l) => l[4] === 'Bia Lima' && l[0] === '2026-10-05');
  assert.ok(presencasBia.length > 0 && presencasBia.every((l) => l[6] === 'Atestado' && l[5] === 'Atendente'));
  const presencas10h = modelo.planilhas[1].linhas.filter((l) => l[0] === '2026-10-05' && l[2] === '10:00');
  assert.equal(presencas10h.length, 4);
});

test('cobertura: falta aparece como ausente na faixa (não some, não conta)', () => {
  const modelo = montarExportacaoCobertura({ dias: SEMANA, grupos, mapaEscala, geradoEm: GERADO_EM });
  const linhaPdf = modelo.pdf.secoes[1].linhas.find((l) => l[0] === 'Sáb 10/10');
  assert.deepEqual(linhaPdf[3], { texto: '0', tom: 'falta' });
  assert.equal(linhaPdf[6], 'Ana (Falta)');
  const presenca = modelo.planilhas[1].linhas.find((l) => l[0] === '2026-10-10');
  assert.deepEqual([presenca[4], presenca[6], presenca[7]], ['Ana Souza', 'Falta', 0]);
});

test('cobertura: um único cargo -> só a geral (sem repetir a mesma cobertura)', () => {
  const soAtendentes = grupoSo(ANA, BIA, MARIA);
  assert.equal(basesDeCobertura(soAtendentes).length, 1);
  const modelo = montarExportacaoCobertura({ dias: SEMANA, grupos: soAtendentes, mapaEscala, geradoEm: GERADO_EM });
  assert.deepEqual(modelo.pdf.secoes.map((sec) => sec.titulo), ['Horários no período', 'Cobertura por faixa horária']);
  assert.ok(modelo.planilhas[0].linhas.every((l) => l[7] === 'Atendente'), 'base de um cargo só leva o nome do cargo');
  assert.ok(!modelo.planilhas[1].linhas.some((l) => l[4] === 'Carla Dias'));
});

test('cobertura: bases -- geral com a equipe toda + 1 por cargo na ordem dos grupos', () => {
  const bases = basesDeCobertura(grupos);
  assert.deepEqual(bases.map((b) => [b.rotulo, b.funcionarios.length]), [['Todos os cargos', 4], ['Atendente', 3], ['Padeira', 1]]);
  assert.deepEqual(basesDeCobertura([]).map((b) => b.funcionarios.length), [0]);
  // só os cargos EXIBIDOS ganham linha própria (filtro de funcionária)
  const soPadeira = agruparPorCargo([CARLA]);
  assert.deepEqual(basesDeCobertura(grupos, soPadeira).map((b) => b.rotulo), ['Todos os cargos', 'Padeira']);
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
  const modelo = montarExportacaoSemanal({ dias: SEMANA, grupos, mapaEscala, geradoEm: GERADO_EM });
  const { nomes, abas, zip } = lerXlsx(modelo);
  assert.deepEqual(nomes, ['Escala semanal', 'Relatório']);
  const aba = abas.get('Escala semanal');
  assert.deepEqual(textoLinha(aba.linhas[0]), modelo.planilhas[0].colunas.map((c) => c.titulo));
  assert.ok(aba.linhas[0].every((c) => c.s === '1'), 'cabeçalho com estilo destacado');
  assert.match(aba.xml, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(aba.xml, new RegExp(`<autoFilter ref="A1:L${modelo.planilhas[0].linhas.length + 1}"/>`));
  assert.match(aba.xml, /<col min="1" max="1" width="28" customWidth="1"\/>/);
  const ana8 = aba.linhas.find((l) => l[0]?.v === 'Ana Souza' && l[3]?.v === serialData('2026-10-08'));
  assert.equal(ana8[3].t, 'n');
  assert.equal(ana8[3].s, '2'); // estilo data dd/mm/aaaa
  assert.equal(ana8[7].v, 1);
  assert.equal(ana8[8].v, serialHora('07:00'));
  assert.equal(ana8[8].s, '3'); // estilo hora hh:mm
  assert.ok(aba.linhas.some((l) => l[0]?.v === 'Carla Dias'), 'equipe toda no arquivo');
  assert.match(zip.get('xl/styles.xml'), /formatCode="dd\/mm\/yyyy"/);
  assert.match(zip.get('xl/styles.xml'), /formatCode="hh:mm"/);
  assert.match(zip.get('xl/workbook.xml'), /_xlnm\._FilterDatabase/);
  const rel = abas.get('Relatório').linhas.map(textoLinha);
  assert.ok(!rel.some((l) => l[0] === 'Cargo' || l[0] === 'Funcionária'), 'sem linhas de filtro');
  assert.deepEqual(rel.find((l) => l[0] === 'Organização'), ['Organização', 'Equipe completa, agrupada por cargo']);
});

test('xlsx mensal e cobertura: abas e colunas esperadas', () => {
  const mensal = lerXlsx(montarExportacaoMensal({ dias: OUTUBRO, grupos, mapaEscala, geradoEm: GERADO_EM }));
  assert.deepEqual(mensal.nomes, ['Mensal', 'Grade mensal', 'Relatório']);
  assert.equal(mensal.abas.get('Mensal').linhas.length, 1 + 4 * 31);
  assert.equal(mensal.abas.get('Grade mensal').linhas[0].length, 33);

  const cobertura = lerXlsx(montarExportacaoCobertura({ dias: SEMANA, grupos, mapaEscala, geradoEm: GERADO_EM }));
  assert.deepEqual(cobertura.nomes, ['Cobertura por faixa', 'Presenças por faixa', 'Escala no período', 'Relatório']);
  const faixas = cobertura.abas.get('Cobertura por faixa').linhas;
  assert.deepEqual(textoLinha(faixas[0]), ['Data', 'Dia', 'Início', 'Fim', 'Cobertura (presentes)', 'Previstas', 'Ausentes', 'Base do cálculo', 'Feriado']);
  assert.equal(faixas[1][4].t, 'n');
  assert.equal(faixas[3][4].v, 3); // 10:00–12:00 de 05/10: equipe toda (geral vem primeiro)
  assert.equal(faixas[3][7].v, 'Todos os cargos');
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
test('pdf semanal: arquivo válido, cabeçalho com período, títulos de cargo e equipe toda', () => {
  const modelo = montarExportacaoSemanal({ dias: SEMANA, grupos, mapaEscala, geradoEm: GERADO_EM });
  const pdf = lerPdf(modelo);
  assert.equal(pdf.paginas, 1);
  assert.match(pdf.texto, /\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/); // A4 paisagem (297 x 210 mm)
  for (const s of ['PADOCA DA MATA', 'Escala — Semanal', 'Período: 05/10 — 11/10/2026', 'Gerado em 06/10/2026 09:30', 'Atendente · 3 funcionárias', 'Padeira · 1 funcionária', 'Maria Silva', 'Ana Souza', '10:00–16:00', 'Página 1 de 1']) {
    assert.ok(noPdf(pdf, s), `PDF contém "${s}"`);
  }
  assert.ok(!noPdf(pdf, 'Cargo: ') && !noPdf(pdf, 'Funcionária: '), 'sem linha de filtros no cabeçalho');
});

test('pdf mensal: os dois blocos de dias na mesma página, legenda M/T', () => {
  const modelo = montarExportacaoMensal({ dias: OUTUBRO, grupos, mapaEscala, geradoEm: GERADO_EM });
  const pdf = lerPdf(modelo);
  assert.equal(pdf.paginas, 1);
  assert.ok(noPdf(pdf, 'Página 1 de 1'));
  for (const s of ['Escala — Mensal', 'Outubro de 2026', 'Atendente · 3 funcionárias', 'Padeira · 1 funcionária', 'Dias 01/10 a 16/10', 'Dias 17/10 a 31/10', 'Atestado', 'M = ocupa 06:00–12:00']) {
    assert.ok(noPdf(pdf, s), `PDF contém "${s}"`);
  }
  assert.ok(!pdf.texto.includes('(M+T)'), 'manhã+tarde nunca aparece como "M+T" no PDF');
});

test('pdf mensal: manhã+tarde é desenhado EMPILHADO (M em cima, T embaixo), nunca "M+T"', () => {
  const { equipe, mapa } = mensalCheio(8, () => false);
  const modelo = montarExportacaoMensal({ dias: OUTUBRO, grupos: agruparPorCargo(equipe), mapaEscala: mapa, geradoEm: GERADO_EM });
  for (const secao of modelo.pdf.secoes) {
    for (const linha of secao.linhas) for (const celula of linha.slice(1)) assert.equal(celula.texto, 'M\nT');
  }
  const pdf = lerPdf(modelo);
  assert.ok(!pdf.texto.includes('(M+T)'));
  // 8 x 31 células, cada uma com as DUAS linhas desenhadas
  assert.equal(pdf.texto.split('(M) Tj').length - 1, 8 * 31);
  assert.equal(pdf.texto.split('(T) Tj').length - 1, 8 * 31);
  // M, T, Folga, não definido e Falta isolados continuam iguais
  assert.deepEqual(celulaMensalPdf({ tipo: 'trabalho', periodos: [{ hora_inicio: '06:00:00', hora_fim: '12:00:00' }], ocorrencia: null }), { texto: 'M', tom: 'trabalho' });
  assert.deepEqual(celulaMensalPdf({ tipo: 'trabalho', periodos: [{ hora_inicio: '13:00:00', hora_fim: '18:00:00' }], ocorrencia: null }), { texto: 'T', tom: 'trabalho' });
  assert.deepEqual(celulaMensalPdf({ tipo: 'trabalho', periodos: [{ hora_inicio: '06:00:00', hora_fim: '12:00:00' }], ocorrencia: { tipo: 'falta' } }), { texto: 'M\nFalta', tom: 'falta' });
  assert.deepEqual(celulaMensalPdf({ tipo: 'folga', periodos: [], ocorrencia: null }), { texto: 'Folga', tom: 'folga' });
  assert.deepEqual(celulaMensalPdf(null), { texto: '—', tom: 'vazio' });
  // A planilha continua com o texto filtrável "M+T" (só o PDF empilha).
  assert.equal(modelo.planilhas.find((a) => a.nome === 'Mensal').linhas[0][7], 'M+T');
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

// Mês "cheio" realista: todas com manhã+tarde (célula de 2 linhas) todos os
// dias e `falta(i, dia)` decidindo as ocorrências.
function mensalCheio(qtd, falta) {
  const equipe = Array.from({ length: qtd }, (_, i) => func(`p${i}`, `Funcionária ${String(i + 1).padStart(2, '0')} Sobrenome`, i % 2 ? ATENDENTE : PADEIRA));
  const dias = [];
  const periodos = new Map();
  const ocorrencias = new Map();
  let n = 0;
  for (const data of OUTUBRO) {
    equipe.forEach((f, i) => {
      const id = `c${++n}`;
      dias.push({ id, funcionario_id: f.id, data, tipo_dia: 'trabalho' });
      periodos.set(id, [{ hora_inicio: '06:00:00', hora_fim: '15:00:00' }]);
      if (falta(i, Number(data.slice(8)))) ocorrencias.set(id, { tipo: 'falta' });
    });
  }
  return { equipe, mapa: construirMapaEscala(dias, periodos, ocorrencias) };
}

test('pdf mensal: 8 funcionárias, M/T empilhados todos os dias + algumas faltas -> 1 página, cabeçalho uma vez, 2º bloco completo', () => {
  const { equipe, mapa } = mensalCheio(8, (i, d) => (i === 0 && d === 3) || (i === 3 && d === 12) || (i === 6 && d === 25));
  const modelo = montarExportacaoMensal({ dias: OUTUBRO, grupos: agruparPorCargo(equipe), mapaEscala: mapa, geradoEm: GERADO_EM });
  const pdf = lerPdf(modelo);
  assert.equal(pdf.paginas, 1);
  assert.ok(noPdf(pdf, 'Página 1 de 1'));
  assert.equal(pdf.texto.split(winAnsi('(Escala — Mensal)')).length - 1, 1, 'identificação desenhada uma única vez');
  assert.ok(noPdf(pdf, 'Dias 01/10 a 16/10') && noPdf(pdf, 'Dias 17/10 a 31/10'));
  // 2º bloco: todos os cabeçalhos de dia 17..31 e todas as linhas (cada nome 2x: um por bloco)
  for (let d = 17; d <= 31; d++) assert.ok(pdf.texto.includes(`(${d}) Tj`), `cabeçalho do dia ${d}`);
  for (const f of equipe) assert.equal(pdf.texto.split(`(${f.nome}) Tj`).length - 1, 2, `${f.nome} nos dois blocos`);
  // todas as células desenhadas (M e T empilhados em todas as 8 x 31)
  assert.equal(pdf.texto.split('(T) Tj').length - 1, 8 * 31);
  assert.ok(noPdf(pdf, 'M = ocupa 06:00–12:00'), 'legenda na mesma página');
});

test('pdf mensal: pior caso extremo (metade dos dias com falta em M/T) pagina sem perder linhas', () => {
  const { equipe, mapa } = mensalPesado(8);
  const pdf = lerPdf(montarExportacaoMensal({ dias: OUTUBRO, grupos: agruparPorCargo(equipe), mapaEscala: mapa, geradoEm: GERADO_EM }));
  for (const f of equipe) assert.equal(pdf.texto.split(`(${f.nome}) Tj`).length - 1, 2, `${f.nome} nos dois blocos`);
  assert.equal(pdf.texto.split('(T) Tj').length - 1, 8 * 31);
  assert.ok(noPdf(pdf, `Página ${pdf.paginas} de ${pdf.paginas}`));
});

test('pdf mensal: equipe excepcionalmente grande pagina sem perder linhas', () => {
  const { equipe, mapa } = mensalPesado(40);
  const modelo = montarExportacaoMensal({ dias: OUTUBRO, grupos: agruparPorCargo(equipe), mapaEscala: mapa, geradoEm: GERADO_EM });
  const pdf = lerPdf(modelo);
  assert.ok(pdf.paginas > 1);
  for (const f of equipe) assert.equal(pdf.texto.split(`(${f.nome}) Tj`).length - 1, 2, `${f.nome} nos dois blocos`);
  assert.equal(pdf.texto.split('(T) Tj').length - 1, 40 * 31);
  assert.ok(!pdf.texto.includes('(M+T)'));
  assert.ok(noPdf(pdf, `Página ${pdf.paginas} de ${pdf.paginas}`));
});

test('pdf cobertura: muitas funcionárias -> paginação com cabeçalho repetido', () => {
  const muitas = Array.from({ length: 60 }, (_, i) => func(`f${i}`, `Pessoa ${String(i).padStart(2, '0')}`, ATENDENTE));
  const modelo = montarExportacaoCobertura({ dias: SEMANA, grupos: agruparPorCargo(muitas), mapaEscala: new Map(), geradoEm: GERADO_EM });
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

