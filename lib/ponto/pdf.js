import { TEMA } from '../branding/tema.js';

// Cartão-Ponto -- PDF A4 RETRATO (um cartão por funcionária) a partir do
// modelo de lib/ponto/exportacao.js. jsPDF/jspdf-autotable chegam
// INJETADOS (mesmo padrão de lib/exportacao/pdf.js, que não é tocado: lá
// é paisagem e sem assinatura): no navegador por import() no clique; nos
// testes, direto no Node. Prévia = marca d'água + faixa em toda página.

const M = { esquerda: 10, direita: 10, topo: 40, base: 14 };

function rgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const COR = {
  primaria: rgb(TEMA.cores.primaria),
  secundaria: rgb(TEMA.cores.secundaria),
  erro: rgb(TEMA.cores.erro),
  aviso: [138, 90, 0],
  texto: [33, 33, 33],
  suave: [110, 110, 110],
  borda: [200, 205, 204],
  zebra: [246, 249, 248],
  folga: [240, 240, 240],
  falta: [253, 236, 236],
  atestado: [254, 244, 229],
  pendente: [255, 248, 225],
  marca: [215, 70, 60],
};

// Fontes padrão do jsPDF (WinAnsi) não têm alguns caracteres Unicode que a
// tela usa (sinal de menos U+2212, setas): sem trocar, o texto sai
// corrompido e com espaçamento quebrado. Todo texto do PDF passa por aqui.
export function textoPdf(valor) {
  return String(valor ?? '')
    .replace(/−/g, '-')
    .replace(/→/g, '->')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

const ESTILO_TOM = {
  vazio: { textColor: COR.suave },
  folga: { fillColor: COR.folga, fontStyle: 'italic' },
  falta: { fillColor: COR.falta },
  atestado: { fillColor: COR.atestado },
  pendente: { fillColor: COR.pendente },
};

function cabecalho(doc, modelo) {
  const largura = doc.internal.pageSize.getWidth();
  const direita = largura - M.direita;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COR.primaria);
  doc.text(textoPdf(modelo.empresa.nome.toUpperCase()), M.esquerda, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COR.suave);
  const idEmpresa = [modelo.empresa.razao_social, modelo.empresa.cnpj && `CNPJ ${modelo.empresa.cnpj}`, modelo.empresa.cidade_uf].filter(Boolean).join(' · ');
  if (idEmpresa) doc.text(textoPdf(idEmpresa), M.esquerda, 14);
  doc.text(`Gerado em ${modelo.geradoEm}`, direita, 10, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...COR.texto);
  doc.text(textoPdf(`${modelo.titulo} — ${modelo.competenciaRotulo}`), M.esquerda, 21);

  doc.setFontSize(9);
  doc.text(textoPdf(modelo.funcionaria.nome), M.esquerda, 27);
  doc.setFont('helvetica', 'normal');
  const dados = [
    modelo.funcionaria.cargo && `Cargo: ${modelo.funcionaria.cargo}`,
    modelo.funcionaria.admissao && `Admissão: ${modelo.funcionaria.admissao}`,
    modelo.funcionaria.desligamento && `Desligamento: ${modelo.funcionaria.desligamento}`,
  ].filter(Boolean).join('   ·   ');
  doc.setFontSize(8);
  doc.text(textoPdf(dados), M.esquerda, 31.5);

  if (modelo.previa) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...COR.marca);
    doc.text(textoPdf(modelo.situacaoDocumento), direita, 21, { align: 'right' });
  } else {
    doc.setFontSize(7.5);
    doc.setTextColor(...COR.suave);
    doc.text(doc.splitTextToSize(textoPdf(modelo.situacaoDocumento), 95), direita, 27, { align: 'right' });
  }

  doc.setDrawColor(...COR.secundaria);
  doc.setLineWidth(0.6);
  doc.line(M.esquerda, 35, direita, 35);
}

function marcaDagua(doc) {
  const largura = doc.internal.pageSize.getWidth();
  const altura = doc.internal.pageSize.getHeight();
  doc.saveGraphicsState?.();
  if (doc.GState && doc.setGState) doc.setGState(new doc.GState({ opacity: 0.12 }));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(54);
  doc.setTextColor(...COR.marca);
  doc.text('PRÉVIA', largura / 2, altura / 2, { align: 'center', angle: 35 });
  doc.restoreGraphicsState?.();
}

function rodape(doc, modelo, pagina, total) {
  const largura = doc.internal.pageSize.getWidth();
  const altura = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...COR.suave);
  const texto = `${modelo.titulo} · ${modelo.funcionaria.nome} · ${modelo.competenciaRotulo}${modelo.previa ? ` · ${modelo.situacaoDocumento}` : ''}`;
  doc.text(textoPdf(texto), M.esquerda, altura - 6);
  doc.text(`Página ${pagina} de ${total}`, largura - M.direita, altura - 6, { align: 'right' });
}

function celula(texto, tom, extra = {}) {
  return { content: textoPdf(texto), styles: { ...(ESTILO_TOM[tom] || {}), ...extra } };
}

export function gerarPdfCartao(modelo, { jsPDF, autoTable }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setProperties({ title: `${modelo.titulo} — ${modelo.funcionaria.nome} — ${modelo.competenciaRotulo}`, author: modelo.empresa.nome, creator: TEMA.nomeEmpresa });
  const altura = doc.internal.pageSize.getHeight();
  const largura = doc.internal.pageSize.getWidth();
  const util = largura - M.esquerda - M.direita;
  const comCabecalho = new Set();
  const porPagina = () => {
    const p = doc.internal.getCurrentPageInfo().pageNumber;
    if (comCabecalho.has(p)) return;
    comCabecalho.add(p);
    if (modelo.previa) marcaDagua(doc);
    cabecalho(doc, modelo);
  };
  const tabela = (opcoes) =>
    autoTable(doc, {
      theme: 'grid',
      margin: { top: M.topo, bottom: M.base, left: M.esquerda, right: M.direita },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 6.6, cellPadding: { top: 0.55, bottom: 0.55, left: 0.8, right: 0.8 }, valign: 'middle', overflow: 'linebreak', lineColor: COR.borda, lineWidth: 0.15, textColor: COR.texto },
      headStyles: { fillColor: COR.primaria, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 6.6 },
      didDrawPage: porPagina,
      ...opcoes,
    });

  // 1. Grade diária.
  tabela({
    startY: M.topo,
    head: [['Dia', 'Previsto (Escala)', 'Situação', 'Entrada', 'Saída int.', 'Retorno', 'Saída', 'Trab.', 'Atest.', 'Saldo', 'Observação']],
    body: modelo.dias.map((d) => {
      const tom = d.tom;
      const centro = { halign: 'center' };
      return [
        celula(d.feriado ? `${d.dia} F` : d.dia, tom, { fontStyle: 'bold' }),
        celula(d.previsto, tom),
        celula(d.situacao, tom),
        celula(d.entrada, tom, centro),
        celula(d.saida_intervalo, tom, centro),
        celula(d.retorno_intervalo, tom, centro),
        celula(d.saida, tom, centro),
        celula(d.trabalhado_min === null ? '—' : fmt(d.trabalhado_min), tom, centro),
        celula(d.atestado_min ? fmt(d.atestado_min) : d.atestado_min === null ? '—' : '', tom, centro),
        // "A LANÇAR" (sem horário) em âmbar: pendência, não falta.
        celula(d.saldo, tom, { halign: 'center', fontStyle: 'bold', textColor: d.estado_saldo === 'nao_lancado' ? COR.aviso : d.saldo_min > 0 ? [27, 120, 60] : d.saldo_min < 0 ? COR.erro : COR.texto }),
        celula(d.observacao, tom),
      ];
    }),
    columnStyles: {
      0: { cellWidth: 13 }, 1: { cellWidth: 30 }, 2: { cellWidth: 30 }, 3: { cellWidth: 11 }, 4: { cellWidth: 11 }, 5: { cellWidth: 11 },
      6: { cellWidth: 11 }, 7: { cellWidth: 11 }, 8: { cellWidth: 11 }, 9: { cellWidth: 15 }, 10: { cellWidth: 'auto' },
    },
  });

  let y = doc.lastAutoTable.finalY + 4;
  const novaPaginaSe = (espaco) => {
    if (y > altura - M.base - espaco) {
      doc.addPage();
      porPagina();
      y = M.topo;
    }
  };

  // 2. Totais (2 colunas de pares).
  novaPaginaSe(40);
  const metade = Math.ceil(modelo.totais.length / 2);
  const pares = Array.from({ length: metade }, (_, i) => [
    modelo.totais[i][0], modelo.totais[i][1], modelo.totais[i + metade]?.[0] ?? '', modelo.totais[i + metade]?.[1] ?? '',
  ]);
  tabela({
    startY: y,
    head: [[{ content: 'Totais do mês', colSpan: 4, styles: { halign: 'left' } }]],
    body: pares.map(([a, b, c, d]) => [textoPdf(a), { content: textoPdf(b), styles: { halign: 'right', fontStyle: 'bold' } }, textoPdf(c), { content: textoPdf(d), styles: { halign: 'right', fontStyle: 'bold' } }]),
    styles: { font: 'helvetica', fontSize: 7.2, cellPadding: 0.8, lineColor: COR.borda, lineWidth: 0.15, textColor: COR.texto },
    columnStyles: { 0: { cellWidth: util * 0.32 }, 1: { cellWidth: util * 0.18 }, 2: { cellWidth: util * 0.32 }, 3: { cellWidth: util * 0.18 } },
  });
  y = doc.lastAutoTable.finalY + 4;

  // 3. Atestados que tocam o mês.
  if (modelo.atestados.length > 0) {
    novaPaginaSe(25);
    tabela({
      startY: y,
      head: [['Atestado', 'Abrangência', 'Período', 'Descrição']],
      body: modelo.atestados.map((a) => [
        textoPdf(a.tipo),
        textoPdf(a.abrangencia),
        a.abrangencia === 'Parcial'
          ? `${fmtData(a.data_inicio)} ${a.hora_inicio}–${a.hora_fim}`
          : a.data_inicio === a.data_fim ? fmtData(a.data_inicio) : `${fmtData(a.data_inicio)} a ${fmtData(a.data_fim)}`,
        textoPdf(a.descricao),
      ]),
      styles: { font: 'helvetica', fontSize: 7, cellPadding: 0.8, lineColor: COR.borda, lineWidth: 0.15, textColor: COR.texto },
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 22 }, 2: { cellWidth: 45 }, 3: { cellWidth: 'auto' } },
    });
    y = doc.lastAutoTable.finalY + 4;
  }

  // 4. Legenda.
  novaPaginaSe(12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...COR.suave);
  const legenda = doc.splitTextToSize(textoPdf(`Legenda: ${modelo.legenda} F = feriado.`), util);
  doc.text(legenda, M.esquerda, y);
  y += legenda.length * 2.8 + 2;

  // 5. Assinaturas (sempre juntas, nunca partidas entre páginas).
  novaPaginaSe(24);
  y += 12;
  const larguraLinha = (util - 20) / 2;
  const assinaturas = [
    [M.esquerda, modelo.funcionaria.nome, 'Funcionária'],
    [M.esquerda + larguraLinha + 20, '', 'Responsável'],
  ];
  doc.setDrawColor(...COR.texto);
  doc.setLineWidth(0.3);
  for (const [x, nome, papel] of assinaturas) {
    doc.line(x, y, x + larguraLinha, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COR.texto);
    doc.text(textoPdf(nome) || ' ', x, y + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COR.suave);
    doc.text(`${papel} · Data: ____/____/________`, x, y + 8);
  }

  const total = doc.internal.getNumberOfPages();
  for (let p = 1; p <= total; p += 1) {
    doc.setPage(p);
    rodape(doc, modelo, p, total);
  }
  return doc.output('arraybuffer');
}

function fmt(minutos) {
  const t = Math.max(0, Math.round(minutos));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function fmtData(d) {
  const [a, m, dia] = String(d).slice(0, 10).split('-');
  return `${dia}/${m}/${a}`;
}
