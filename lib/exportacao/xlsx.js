import { criarZip } from './zip.js';
import { TEMA } from '../branding/tema.js';

// Gerador de .xlsx REAL (Office Open XML / SpreadsheetML) sem dependência
// externa -- só o subconjunto que as exportações do sistema usam:
//   * várias abas; cabeçalho em destaque (cor primária da marca);
//   * células tipadas: texto, número, DATA (serial do Excel + formato
//     dd/mm/aaaa) e HORA (fração do dia + formato hh:mm) -- nunca texto
//     disfarçado de data;
//   * autofiltro, cabeçalho congelado e larguras de coluna.
// Não implementa fórmulas (os valores já vêm calculados do sistema).
//
// planilhas: [{ nome, colunas: [{ titulo, tipo: 'texto'|'numero'|'data'|'hora', largura }],
//               linhas: [[valor...]], semFiltro? }]
//   data -> 'YYYY-MM-DD'; hora -> 'HH:MM' (ou 'HH:MM:SS'); null/'' -> célula vazia.

const ESTILO = { padrao: 0, cabecalho: 1, data: 2, hora: 3, numero: 4 };

function escaparXml(valor) {
  return String(valor)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function letraColuna(indice) {
  let n = indice + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Serial de data do Excel (sistema 1900): dias desde 30/12/1899. Aritmética
// pura de calendário via Date.UTC (mesmo princípio de lib/data/dataLocal.js
// -- nunca o fuso do dispositivo).
export function serialData(dataYYYYMMDD) {
  const [a, m, d] = dataYYYYMMDD.split('-').map(Number);
  return Date.UTC(a, m - 1, d) / 86400000 + 25569;
}

export function serialHora(hhmm) {
  const [h, m, s = 0] = hhmm.split(':').map(Number);
  return (h * 3600 + m * 60 + s) / 86400;
}

// Nome de aba válido no Excel: até 31 caracteres, sem []:*?/\ e único.
function nomesDeAbaValidos(nomes) {
  const usados = new Set();
  return nomes.map((nome) => {
    const base = (String(nome || 'Planilha').replace(/[[\]:*?/\\]/g, ' ').trim() || 'Planilha').slice(0, 31);
    let candidato = base;
    let n = 2;
    while (usados.has(candidato.toLowerCase())) {
      const sufixo = ` (${n++})`;
      candidato = base.slice(0, 31 - sufixo.length) + sufixo;
    }
    usados.add(candidato.toLowerCase());
    return candidato;
  });
}

function celula(ref, valor, tipo) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (tipo === 'data') return `<c r="${ref}" s="${ESTILO.data}"><v>${serialData(valor)}</v></c>`;
  if (tipo === 'hora') return `<c r="${ref}" s="${ESTILO.hora}"><v>${serialHora(valor)}</v></c>`;
  if (tipo === 'numero' && typeof valor === 'number' && Number.isFinite(valor)) return `<c r="${ref}" s="${ESTILO.numero}"><v>${valor}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`;
}

function xmlPlanilha(planilha) {
  const { colunas, linhas, semFiltro } = planilha;
  const ultimaColuna = letraColuna(Math.max(colunas.length - 1, 0));
  const ultimaLinha = Math.max(linhas.length + 1, 1);

  const cols = colunas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura || 14}" customWidth="1"/>`).join('');

  const cabecalho = `<row r="1">${colunas
    .map((c, i) => `<c r="${letraColuna(i)}1" t="inlineStr" s="${ESTILO.cabecalho}"><is><t xml:space="preserve">${escaparXml(c.titulo)}</t></is></c>`)
    .join('')}</row>`;

  const corpo = linhas
    .map((linha, li) => {
      const r = li + 2;
      return `<row r="${r}">${colunas.map((c, ci) => celula(`${letraColuna(ci)}${r}`, linha[ci], c.tipo)).join('')}</row>`;
    })
    .join('');

  const vista = semFiltro
    ? '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';

  const filtro = semFiltro ? '' : `<autoFilter ref="A1:${ultimaColuna}${ultimaLinha}"/>`;

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="A1:${ultimaColuna}${ultimaLinha}"/>` +
    vista +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${cabecalho}${corpo}</sheetData>` +
    filtro +
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
    '<pageSetup paperSize="9" orientation="landscape"/>' +
    '</worksheet>'
  );
}

function xmlEstilos() {
  const corPrimaria = `FF${TEMA.cores.primaria.replace('#', '').toUpperCase()}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="hh:mm"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    `<fill><patternFill patternType="solid"><fgColor rgb="${corPrimaria}"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="5">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  );
}

export function gerarXlsx({ planilhas, titulo = '' }) {
  const nomes = nomesDeAbaValidos(planilhas.map((p) => p.nome));

  const sheetsXml = nomes.map((nome, i) => `<sheet name="${escaparXml(nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  // _FilterDatabase oculto por aba com autofiltro -- é o que o próprio
  // Excel grava; sem ele algumas versões "reparam" o arquivo ao abrir.
  const nomesDefinidos = planilhas
    .map((p, i) => {
      if (p.semFiltro) return '';
      const ultima = letraColuna(Math.max(p.colunas.length - 1, 0));
      const nomeRef = `'${nomes[i].replace(/'/g, "''")}'`;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${escaparXml(`${nomeRef}!$A$1:$${ultima}$${Math.max(p.linhas.length + 1, 1)}`)}</definedName>`;
    })
    .join('');

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<bookViews><workbookView/></bookViews>' +
    `<sheets>${sheetsXml}</sheets>` +
    (nomesDefinidos ? `<definedNames>${nomesDefinidos}</definedNames>` : '') +
    '</workbook>';

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    nomes.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${nomes.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    nomes.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>';

  const core =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${escaparXml(titulo)}</dc:title><dc:creator>${escaparXml(TEMA.nomeEmpresa)}</dc:creator>` +
    '</cp:coreProperties>';

  return criarZip([
    { caminho: '[Content_Types].xml', conteudo: contentTypes },
    { caminho: '_rels/.rels', conteudo: rels },
    { caminho: 'docProps/core.xml', conteudo: core },
    { caminho: 'xl/workbook.xml', conteudo: workbook },
    { caminho: 'xl/_rels/workbook.xml.rels', conteudo: workbookRels },
    { caminho: 'xl/styles.xml', conteudo: xmlEstilos() },
    ...planilhas.map((p, i) => ({ caminho: `xl/worksheets/sheet${i + 1}.xml`, conteudo: xmlPlanilha(p) })),
  ]);
}

export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
