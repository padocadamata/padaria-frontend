// PDF A4 RETRATO do documento de RH -- gerado no navegador com o jsPDF
// que o projeto já usa (lib/exportacao/pdf.js), INJETADO (`bibliotecas`):
// import() dinâmico só no clique; nos testes, importado direto no Node.
// Mesmos blocos de layout.js usados pela folha HTML e pelo Word.
//
// Fonte padrão Helvetica (codificação WinAnsi: cobre o português; emoji e
// símbolos fora dela não são suportados pelo PDF padrão). Paginação
// automática; local/data + assinaturas ficam juntos quando cabem (um par
// de assinaturas nunca é partido entre páginas); tamanhos e espaços de
// layout.js (TIPOGRAFIA/ESPACOS), os mesmos da folha HTML e do Word; rodapé
// "Documento nº … — página x de y" em todas as folhas.

import { ESPACOS, PAGINA_A4, TIPOGRAFIA, assinaturasEmPares, cabecalhoEmpresa, linhaIdentificacao, linhasAssinatura, textoCancelamento } from './layout.js';

const PT_MM = 0.3528;
const COR = { texto: [33, 33, 33], suave: [100, 100, 100], erro: [176, 0, 32], linha: [60, 60, 60] };
const T = TIPOGRAFIA;
const E = ESPACOS;

export function gerarPdfDocumento(doc, { jsPDF }) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const { largura: L, altura: A, margem: M } = PAGINA_A4;
  const larguraUtil = L - 2 * M;
  const limite = A - M - 6; // espaço do rodapé
  let y = M;

  const novaPagina = () => {
    pdf.addPage();
    y = M;
  };
  const garantir = (altura) => {
    if (y + altura > limite) novaPagina();
  };
  const alturaLinha = (tamanho, entrelinha) => tamanho * PT_MM * entrelinha;

  function escrever(texto, { tamanho = T.corpo, negrito = false, alinhar = 'left', cor = COR.texto, entrelinha = T.entrelinhaCorpo, largura = larguraUtil, x = M } = {}) {
    pdf.setFont('helvetica', negrito ? 'bold' : 'normal');
    pdf.setFontSize(tamanho);
    pdf.setTextColor(...cor);
    const altura = alturaLinha(tamanho, entrelinha);
    const linhas = pdf.splitTextToSize(String(texto), largura);
    const xTexto = alinhar === 'center' ? x + largura / 2 : alinhar === 'right' ? x + largura : x;
    for (const linha of linhas) {
      garantir(altura);
      pdf.text(linha, xTexto, y + tamanho * PT_MM * 0.85, { align: alinhar });
      y += altura;
    }
  }

  // Cabeçalho da empresa.
  const cab = cabecalhoEmpresa(doc.empresa);
  if (cab.principal) escrever(cab.principal, { tamanho: T.empresa, negrito: true, entrelinha: T.entrelinhaEmpresa });
  for (const linha of cab.linhas) escrever(linha, { tamanho: T.empresaLinha, cor: COR.suave, entrelinha: T.entrelinhaEmpresa });
  y += E.cabecalhoLinha;
  pdf.setDrawColor(...COR.linha);
  pdf.setLineWidth(0.3);
  pdf.line(M, y, L - M, y);
  y += E.identificacao;
  escrever(linhaIdentificacao(doc), { tamanho: T.identificacao, cor: COR.suave, alinhar: 'right', entrelinha: T.entrelinhaEmpresa });

  const cancelado = textoCancelamento(doc.cancelamento);
  if (cancelado) {
    y += 3;
    escrever(cancelado, { tamanho: T.cancelado, negrito: true, cor: COR.erro, entrelinha: T.entrelinhaEmpresa });
  }

  y += E.tituloAntes;
  escrever(doc.titulo, { tamanho: T.titulo, negrito: true, alinhar: 'center', entrelinha: T.entrelinhaTitulo });
  y += E.tituloDepois;

  for (const paragrafo of doc.paragrafos) {
    for (const linha of paragrafo) escrever(linha);
    y += E.paragrafo;
  }

  // Fechamento: local/data + assinaturas (2 por linha). Fica inteiro na
  // mesma página quando cabe numa página; senão, ao menos cada par de
  // assinaturas nunca é partido (e o local/data vai com o 1º par).
  const coluna = (larguraUtil - E.colunasAssinatura) / 2;
  const pares = assinaturasEmPares(doc.assinaturas);
  const alturaPar = (par) => E.assinatura + 1.5 + Math.max(...par.map((a) => linhasAssinatura(a).length)) * alturaLinha(T.assinatura, T.entrelinhaAssinatura) + E.assinaturaDepois;
  const alturaLocalData = doc.localData ? E.localDataAntes + alturaLinha(T.corpo, T.entrelinhaCorpo) : 0;
  const alturaFechamento = alturaLocalData + pares.reduce((t, par) => t + alturaPar(par), 0);
  if (alturaFechamento <= limite - M) garantir(alturaFechamento);
  else garantir(alturaLocalData + (pares[0] ? alturaPar(pares[0]) : 0));

  if (doc.localData) {
    y += E.localDataAntes;
    escrever(doc.localData, { alinhar: 'right' });
  }

  for (const par of pares) {
    garantir(alturaPar(par));
    y += E.assinatura;
    const topo = y;
    let maisBaixo = topo;
    par.forEach((assinatura, i) => {
      const x = M + i * (coluna + E.colunasAssinatura);
      pdf.setDrawColor(...COR.linha);
      pdf.setLineWidth(0.3);
      pdf.line(x + E.recuoAssinatura, topo, x + coluna - E.recuoAssinatura, topo);
      y = topo + 1.5;
      for (const l of linhasAssinatura(assinatura)) escrever(l.texto, { tamanho: T.assinatura, negrito: l.negrito, alinhar: 'center', largura: coluna, x, entrelinha: T.entrelinhaAssinatura });
      maisBaixo = Math.max(maisBaixo, y);
    });
    y = maisBaixo + E.assinaturaDepois;
  }

  // Rodapé com paginação.
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p += 1) {
    pdf.setPage(p);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(T.rodape);
    pdf.setTextColor(...COR.suave);
    pdf.text(`Documento nº ${doc.numero} — página ${p} de ${total}`, L / 2, A - M / 2, { align: 'center' });
  }

  return new Uint8Array(pdf.output('arraybuffer'));
}
