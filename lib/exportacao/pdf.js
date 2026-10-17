import { TEMA } from '../branding/tema.js';

// Renderiza um modelo de relatório (ver lib/funcionarios/escalaExportacao.js)
// num PDF A4 PAISAGEM próprio para impressão -- nunca screenshot da tela.
// jsPDF/jspdf-autotable chegam INJETADOS (`bibliotecas`): no navegador por
// import() dinâmico só no clique (não pesa no carregamento da Escala); nos
// testes, importados direto no Node.
//
// Toda página repete: identificação (Padoca da Mata · Escala · tipo ·
// período · filtros ativos · gerado em), cabeçalho da tabela e rodapé com
// paginação. Linhas nunca são partidas entre páginas (rowPageBreak avoid).

const MARGEM = { esquerda: 10, direita: 10, topo: 30, base: 14 };

// Início de grupo (secao.inicioGrupos, ex.: cargo da Escala): sem linha
// extra -- a 1ª linha do grupo ganha borda superior mais forte e o rótulo
// do grupo em letra pequena acima do conteúdo da 1ª coluna (espaço
// reservado no padding superior dessa célula).
const GRUPO = { espaco: 2.4, fonte: 5.8, borda: 0.6 };

function paddingComoObjeto(padding) {
  if (padding && typeof padding === 'object') return { top: 0, right: 0, bottom: 0, left: 0, ...padding };
  const p = Number(padding) || 0;
  return { top: p, right: p, bottom: p, left: p };
}

function hexParaRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const COR = {
  primaria: hexParaRgb(TEMA.cores.primaria),
  secundaria: hexParaRgb(TEMA.cores.secundaria),
  erro: hexParaRgb(TEMA.cores.erro),
  texto: [33, 33, 33],
  suave: [110, 110, 110],
  borda: [200, 205, 204],
  zebra: [246, 249, 248],
  fimDeSemana: [234, 241, 240],
  folgaFundo: [240, 240, 240],
  faltaFundo: [253, 236, 236],
  atestadoFundo: [254, 244, 229],
  atestado: [156, 90, 0],
};

// "tom" semântico do modelo -> estilo de célula (texto SEMPRE presente --
// cor só reforça, nunca é a única pista; legível também em P&B).
function estiloDoTom(tom) {
  switch (tom) {
    case 'vazio':
      return { textColor: COR.suave };
    case 'folga':
      return { textColor: COR.suave, fillColor: COR.folgaFundo, fontStyle: 'italic' };
    case 'falta':
      return { textColor: COR.erro, fillColor: COR.faltaFundo, fontStyle: 'bold' };
    case 'atestado':
      return { textColor: COR.atestado, fillColor: COR.atestadoFundo, fontStyle: 'bold' };
    case 'numero':
      return { fontStyle: 'bold' };
    default:
      return {};
  }
}

// `compactar` (célula de 3 linhas, ex.: "M / T / Falta" no Mensal): letra
// e respiro menores só nela, para a linha da tabela não ficar mais alta.
const CELULA_COMPACTA = { fontSize: 6, cellPadding: { top: 0.1, bottom: 0.1, left: 1.2, right: 1.2 } };

function paraCelula(valor) {
  if (valor && typeof valor === 'object') {
    const celula = { content: valor.texto, styles: { ...estiloDoTom(valor.tom), ...(valor.compactar ? CELULA_COMPACTA : {}) } };
    if (valor.colSpan) celula.colSpan = valor.colSpan;
    return celula;
  }
  return { content: valor === null || valor === undefined ? '' : String(valor) };
}

// Período + SÓ os filtros ativos ("Cargo: …", "Funcionária: …") -- em
// "Todos" nada é escrito (arquivo da equipe completa).
function linhaPeriodo(modelo) {
  const partes = [`Período: ${modelo.periodoRotulo}`];
  if (modelo.filtros?.cargo) partes.push(`Cargo: ${modelo.filtros.cargo}`);
  if (modelo.filtros?.funcionario) partes.push(`Funcionária: ${modelo.filtros.funcionario}`);
  return partes.join('   ·   ');
}

function desenharCabecalhoPagina(doc, modelo) {
  const largura = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COR.primaria);
  doc.text(TEMA.nomeEmpresa.toUpperCase(), MARGEM.esquerda, 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COR.suave);
  doc.text(`Gerado em ${modelo.geradoEm}`, largura - MARGEM.direita, 10, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...COR.texto);
  doc.text(modelo.titulo, MARGEM.esquerda, 17);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COR.texto);
  doc.text(linhaPeriodo(modelo), MARGEM.esquerda, 23);

  doc.setDrawColor(...COR.secundaria);
  doc.setLineWidth(0.6);
  doc.line(MARGEM.esquerda, 25.5, largura - MARGEM.direita, 25.5);
}

function desenharRodape(doc, modelo, pagina, total) {
  const largura = doc.internal.pageSize.getWidth();
  const altura = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COR.suave);
  doc.text(`${TEMA.nomeEmpresa} · ${modelo.titulo} · ${modelo.periodoRotulo}`, MARGEM.esquerda, altura - 6);
  doc.text(`Página ${pagina} de ${total}`, largura - MARGEM.direita, altura - 6, { align: 'right' });
}

function textoQuebrado(doc, texto, x, y, larguraMax, tamanho, cor, estilo = 'normal') {
  doc.setFont('helvetica', estilo);
  doc.setFontSize(tamanho);
  doc.setTextColor(...cor);
  const linhas = doc.splitTextToSize(texto, larguraMax);
  doc.text(linhas, x, y);
  return y + linhas.length * tamanho * 0.42;
}

export function gerarPdfRelatorio(modelo, { jsPDF, autoTable }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setProperties({ title: `${modelo.titulo} — ${modelo.periodoRotulo}`, author: TEMA.nomeEmpresa, creator: TEMA.nomeEmpresa });
  const larguraUtil = doc.internal.pageSize.getWidth() - MARGEM.esquerda - MARGEM.direita;
  const alturaPagina = doc.internal.pageSize.getHeight();

  // Identificação desenhada UMA vez por página (várias tabelas na mesma
  // página não a redesenham por cima).
  const paginasComCabecalho = new Set();
  const cabecalhoUmaVez = () => {
    const pagina = doc.internal.getCurrentPageInfo().pageNumber;
    if (paginasComCabecalho.has(pagina)) return;
    paginasComCabecalho.add(pagina);
    desenharCabecalhoPagina(doc, modelo);
  };

  let y = MARGEM.topo + 2;
  let primeira = true;

  for (const secao of modelo.pdf.secoes) {
    // Nova seção continua na MESMA página sempre que cabem título +
    // cabeçalho + algumas linhas; se a tabela for maior que o espaço, o
    // autotable pagina sozinho (cabeçalho repetido, nada é cortado).
    if (!primeira && (secao.novaPagina || y > alturaPagina - MARGEM.base - 35)) {
      doc.addPage();
      y = MARGEM.topo + 2;
    }
    primeira = false;

    if (secao.titulo) {
      y = textoQuebrado(doc, secao.titulo, MARGEM.esquerda, y + (secao.compacto ? 1 : 2), larguraUtil, secao.compacto ? 10 : 11, COR.primaria, 'bold') + 1;
    }
    if (secao.nota) {
      y = textoQuebrado(doc, secao.nota, MARGEM.esquerda, y + 1, larguraUtil, 8, COR.suave) + 1;
    }

    const numColunas = secao.cabecalho.length;
    const corpo =
      secao.linhas.length > 0
        ? secao.linhas.map((linha) => linha.map(paraCelula))
        : [[{ content: secao.vazio || 'Sem registros.', colSpan: numColunas, styles: { halign: 'center', textColor: COR.suave, fontStyle: 'italic' } }]];

    const columnStyles = {};
    for (const [indice, largura] of Object.entries(secao.larguras || {})) {
      columnStyles[indice] = { cellWidth: largura, halign: 'left' };
    }
    const centralizar = new Set(secao.centralizarColunas || []);
    const fimDeSemana = new Set(secao.colunasFimDeSemana || []);
    const muitasColunas = numColunas > 12;
    const rotuloGrupoPorLinha = new Map((secao.linhas.length > 0 ? secao.inicioGrupos || [] : []).map((g) => [g.indice, g.rotulo]));
    // `compacto`: menos respiro vertical (Mensal: 2 blocos de dias na mesma
    // página) -- mesma fonte, só o padding da célula diminui.
    const padding = secao.compacto ? { top: 0.6, bottom: 0.6, left: 1.2, right: 1.2 } : muitasColunas ? 1.2 : 1.6;

    autoTable(doc, {
      startY: y + 1,
      head: [secao.cabecalho],
      body: corpo,
      theme: 'grid',
      margin: { top: MARGEM.topo, bottom: MARGEM.base, left: MARGEM.esquerda, right: MARGEM.direita },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      tableWidth: 'auto',
      styles: {
        font: 'helvetica',
        fontSize: muitasColunas ? 7.5 : 8.5,
        cellPadding: padding,
        valign: 'middle',
        overflow: 'linebreak',
        lineColor: COR.borda,
        lineWidth: 0.15,
        textColor: COR.texto,
      },
      headStyles: {
        fillColor: COR.primaria,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center',
        valign: 'middle',
        fontSize: muitasColunas ? 7.5 : 8.5,
      },
      alternateRowStyles: { fillColor: COR.zebra },
      columnStyles,
      didParseCell: (data) => {
        const col = data.column.index;
        if (data.section === 'head') {
          if (fimDeSemana.has(col)) data.cell.styles.fillColor = COR.secundaria;
          if (col === 0) data.cell.styles.halign = 'left';
          return;
        }
        if (data.section !== 'body') return;
        if (rotuloGrupoPorLinha.has(data.row.index)) {
          data.cell.styles.lineWidth = { top: GRUPO.borda, right: 0.15, bottom: 0.15, left: 0.15 };
          if (col === 0) {
            const p = paddingComoObjeto(data.cell.styles.cellPadding);
            data.cell.styles.cellPadding = { ...p, top: p.top + GRUPO.espaco };
          }
        }
        const temTom = data.cell.raw && typeof data.cell.raw === 'object' && data.cell.raw.styles && Object.keys(data.cell.raw.styles).length > 0;
        const centralizada = secao.centralizarColunas ? centralizar.has(col) : col >= (secao.colunasTexto ?? 1);
        if (centralizada) data.cell.styles.halign = 'center';
        if (col === 0) data.cell.styles.fontStyle = data.cell.styles.fontStyle === 'normal' ? 'bold' : data.cell.styles.fontStyle;
        if (!temTom && fimDeSemana.has(col)) data.cell.styles.fillColor = COR.fimDeSemana;
      },
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 0 || !rotuloGrupoPorLinha.has(data.row.index)) return;
        const esquerda = paddingComoObjeto(data.cell.styles.cellPadding).left;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(GRUPO.fonte);
        doc.setTextColor(...COR.primaria);
        doc.text(rotuloGrupoPorLinha.get(data.row.index), data.cell.x + esquerda, data.cell.y + GRUPO.espaco, { maxWidth: data.cell.width - 2 * esquerda });
      },
      didDrawPage: cabecalhoUmaVez,
    });

    y = doc.lastAutoTable.finalY + (secao.compacto ? 4 : 6);
  }

  if (modelo.pdf.legenda) {
    if (y > alturaPagina - MARGEM.base - 8) {
      doc.addPage();
      cabecalhoUmaVez();
      y = MARGEM.topo + 2;
    }
    textoQuebrado(doc, `Legenda: ${modelo.pdf.legenda}`, MARGEM.esquerda, y, larguraUtil, 7.5, COR.suave);
  }

  const total = doc.internal.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    desenharRodape(doc, modelo, p, total);
  }

  return doc.output('arraybuffer');
}
