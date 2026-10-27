// Word (.docx) do documento de RH -- WordprocessingML mínimo empacotado
// com o ZIP que o projeto já usa no Excel (lib/exportacao/zip.js), sem
// dependência nova. Mesmos blocos de layout.js usados pela folha HTML e
// pelo PDF; A4 retrato, margens de 2 cm, Arial; tamanhos e espaços de
// layout.js (TIPOGRAFIA/ESPACOS), convertidos para meio-ponto/twips.
//
// Só o necessário e na ordem exigida pelo esquema OOXML (o Word recusa
// elementos fora de ordem): [Content_Types].xml, _rels/.rels,
// word/document.xml, word/styles.xml e word/_rels/document.xml.rels.
// Assinaturas numa tabela SEM bordas de 2 colunas (linha não se parte
// entre páginas; local/data e as linhas da tabela "mantêm com o próximo",
// então o fechamento fica junto quando cabe). Função PURA -> Uint8Array.

import { criarZip } from '../exportacao/zip.js';
import { ESPACOS, TIPOGRAFIA, assinaturasEmPares, cabecalhoEmpresa, linhaIdentificacao, linhasAssinatura, textoCancelamento } from './layout.js';

export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// 20 mm = 1134 twips; A4 = 11906 x 16838 twips.
const MARGEM = 1134;
const LARGURA_UTIL = 11906 - 2 * MARGEM;
const T = TIPOGRAFIA;
const E = ESPACOS;
// mm -> twips (1 mm = 56,69 twips).
const twips = (mm) => Math.round(mm * 56.6929);
// Entrelinha "pelo menos" tamanho x múltiplo (em twips) -- o mesmo passo de
// linha da folha HTML (line-height) e do PDF.
const entrelinha = (tamanho, multiplo) => Math.round(tamanho * multiplo * 20);

// Texto -> conteúdo XML seguro (sem caracteres de controle proibidos no
// XML 1.0).
export function escaparXml(texto) {
  return String(texto ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Ordem do CT_RPr: b, color, sz, szCs. Tamanho em pt (meio-ponto no XML).
function run(texto, { negrito = false, cor = null, tamanho = null } = {}) {
  const meioPonto = tamanho ? Math.round(tamanho * 2) : null;
  const props = `${negrito ? '<w:b/>' : ''}${cor ? `<w:color w:val="${cor}"/>` : ''}${meioPonto ? `<w:sz w:val="${meioPonto}"/><w:szCs w:val="${meioPonto}"/>` : ''}`;
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
  // Tabulação vira <w:tab/> (dentro de <w:t> o Word a ignoraria).
  const partes = String(texto ?? '').split('\t').map((p) => `<w:t xml:space="preserve">${escaparXml(p)}</w:t>`);
  return `<w:r>${rPr}${partes.join('<w:tab/>')}</w:r>`;
}

// Ordem do CT_PPr: keepNext, spacing, jc. antes/depois em twips; linha =
// entrelinha mínima em twips (null = padrão do estilo).
function paragrafo(conteudo, { alinhar = null, antes = 0, depois = 0, linha = null, manterComProximo = false } = {}) {
  const espaco = `<w:spacing w:before="${antes}" w:after="${depois}"${linha ? ` w:line="${linha}" w:lineRule="atLeast"` : ''}/>`;
  const pPr = `<w:pPr>${manterComProximo ? '<w:keepNext/>' : ''}${espaco}${alinhar ? `<w:jc w:val="${alinhar}"/>` : ''}</w:pPr>`;
  return `<w:p>${pPr}${conteudo}</w:p>`;
}

// Várias linhas no MESMO parágrafo (quebra simples = <w:br/>).
function linhasComQuebra(linhas, estilo) {
  return linhas.map((l) => run(l, estilo)).join('<w:r><w:br/></w:r>');
}

// manterJunto: keepNext em TODOS os parágrafos da célula (a linha da
// tabela fica com a próxima -- usado em todas as linhas menos a última).
// coluna 0|1: o lado de dentro ganha metade do vão entre as assinaturas
// (mesma geometria do PDF e da folha HTML).
function celulaAssinatura(assinatura, larguraCelula, manterJunto, coluna) {
  const tcPr = `<w:tcPr><w:tcW w:w="${larguraCelula}" w:type="dxa"/></w:tcPr>`;
  if (!assinatura) return `<w:tc>${tcPr}${paragrafo('', { manterComProximo: manterJunto })}</w:tc>`;
  // Linha de assinatura = borda superior do 1º parágrafo (nome), recuada
  // das bordas da célula; o espaço antes é o lugar de assinar. Ordem do
  // CT_PPr: keepNext, pBdr, spacing, ind, jc.
  const recuo = twips(E.recuoAssinatura);
  const recuoDentro = twips(E.recuoAssinatura + E.colunasAssinatura / 2);
  const [esquerda, direita] = coluna === 0 ? [recuo, recuoDentro] : [recuoDentro, recuo];
  const linha = entrelinha(T.assinatura, T.entrelinhaAssinatura);
  const linhas = linhasAssinatura(assinatura);
  const corpo = linhas.map((l, i) => {
    const ultimo = i === linhas.length - 1;
    const keep = !ultimo || manterJunto ? '<w:keepNext/>' : '';
    const borda = i === 0 ? '<w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="3C3C3C"/></w:pBdr>' : '';
    const antes = i === 0 ? twips(E.assinatura) : 0;
    const depois = ultimo ? twips(E.assinaturaDepois) : 0;
    const pPr = `<w:pPr>${keep}${borda}<w:spacing w:before="${antes}" w:after="${depois}" w:line="${linha}" w:lineRule="atLeast"/><w:ind w:left="${esquerda}" w:right="${direita}"/><w:jc w:val="center"/></w:pPr>`;
    return `<w:p>${pPr}${run(l.texto, { negrito: l.negrito, tamanho: T.assinatura })}</w:p>`;
  }).join('');
  return `<w:tc>${tcPr}${corpo}</w:tc>`;
}

function tabelaAssinaturas(assinaturas) {
  if (assinaturas.length === 0) return '';
  const coluna = Math.floor(LARGURA_UTIL / 2);
  const pares = assinaturasEmPares(assinaturas);
  const linhas = pares.map((par, i) => {
    const manterJunto = i < pares.length - 1;
    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${celulaAssinatura(par[0], coluna, manterJunto, 0)}${celulaAssinatura(par[1] || null, coluna, manterJunto, 1)}</w:tr>`;
  });
  // Ordem do CT_TblPr: tblW, tblLayout. Sem estilo/bordas = tabela invisível.
  return `<w:tbl><w:tblPr><w:tblW w:w="${coluna * 2}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>`
    + `<w:tblGrid><w:gridCol w:w="${coluna}"/><w:gridCol w:w="${coluna}"/></w:tblGrid>${linhas.join('')}</w:tbl>`;
}

export function documentXml(doc) {
  const blocos = [];
  const cab = cabecalhoEmpresa(doc.empresa);
  const linhaEmpresa = (tamanho) => entrelinha(tamanho, T.entrelinhaEmpresa);
  if (cab.principal) blocos.push(paragrafo(run(cab.principal, { negrito: true, tamanho: T.empresa }), { linha: linhaEmpresa(T.empresa) }));
  if (cab.linhas.length > 0) blocos.push(paragrafo(linhasComQuebra(cab.linhas, { tamanho: T.empresaLinha, cor: '646464' }), { linha: linhaEmpresa(T.empresaLinha) }));
  // Linha divisória: borda inferior de um parágrafo vazio de altura mínima
  // (ordem do pPr: pBdr antes de spacing; w:space em pontos).
  blocos.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="${Math.round(E.cabecalhoLinha / 0.3528)}" w:color="3C3C3C"/></w:pBdr><w:spacing w:before="0" w:after="${twips(E.identificacao)}" w:line="20" w:lineRule="exact"/></w:pPr></w:p>`);
  blocos.push(paragrafo(run(linhaIdentificacao(doc), { tamanho: T.identificacao, cor: '646464' }), { alinhar: 'right', linha: linhaEmpresa(T.identificacao) }));

  const cancelado = textoCancelamento(doc.cancelamento);
  if (cancelado) blocos.push(paragrafo(run(cancelado, { negrito: true, cor: 'B00020', tamanho: T.cancelado }), { antes: twips(3), linha: linhaEmpresa(T.cancelado) }));

  blocos.push(paragrafo(run(doc.titulo, { negrito: true, tamanho: T.titulo }), {
    alinhar: 'center', antes: twips(E.tituloAntes), depois: twips(E.tituloDepois), linha: entrelinha(T.titulo, T.entrelinhaTitulo), manterComProximo: true,
  }));
  const linhaCorpo = entrelinha(T.corpo, T.entrelinhaCorpo);
  for (const linhas of doc.paragrafos) blocos.push(paragrafo(linhasComQuebra(linhas, { tamanho: T.corpo }), { depois: twips(E.paragrafo), linha: linhaCorpo }));
  if (doc.localData) {
    blocos.push(paragrafo(run(doc.localData, { tamanho: T.corpo }), {
      alinhar: 'right', antes: twips(E.localDataAntes), linha: linhaCorpo, manterComProximo: doc.assinaturas.length > 0,
    }));
  }

  const tabela = tabelaAssinaturas(doc.assinaturas);
  if (tabela) blocos.push(tabela, paragrafo('', { linha: 20 }));

  const sectPr = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${MARGEM}" w:right="${MARGEM}" w:bottom="${MARGEM}" w:left="${MARGEM}" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${NS_W}"><w:body>${blocos.join('')}${sectPr}</w:body></w:document>`;
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '</Types>';

const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

const DOCUMENT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '</Relationships>';

// Arial no tamanho do corpo; estilo Normal explícito (cada parágrafo do
// documento define a própria entrelinha).
const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + `<w:styles xmlns:w="${NS_W}">`
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>'
  + `<w:sz w:val="${T.corpo * 2}"/><w:szCs w:val="${T.corpo * 2}"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault>`
  + '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
  + '</w:styles>';

export function gerarDocx(doc) {
  return criarZip([
    { caminho: '[Content_Types].xml', conteudo: CONTENT_TYPES },
    { caminho: '_rels/.rels', conteudo: RELS },
    { caminho: 'word/document.xml', conteudo: documentXml(doc) },
    { caminho: 'word/_rels/document.xml.rels', conteudo: DOCUMENT_RELS },
    { caminho: 'word/styles.xml', conteudo: STYLES },
  ]);
}
