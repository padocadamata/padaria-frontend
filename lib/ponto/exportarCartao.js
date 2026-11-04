import { baixarArquivo } from '../exportacao/exportar.js';
import { gerarXlsx, MIME_XLSX } from '../exportacao/xlsx.js';
import { criarZip } from '../exportacao/zip.js';
import { gerarPdfCartao } from './pdf.js';

// Cartão-Ponto -- exportação no NAVEGADOR a partir do modelo pronto
// (lib/ponto/exportacao.js), com os dados já lidos pela tela -- nenhuma
// gravação. jsPDF só é carregado (import dinâmico) no primeiro PDF.

async function bibliotecasPdf() {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  return { jsPDF, autoTable };
}

export async function pdfDoCartao(modelo) {
  return new Uint8Array(gerarPdfCartao(modelo, await bibliotecasPdf()));
}

export function xlsxDoCartao(modelo) {
  return gerarXlsx({ planilhas: modelo.planilhas, titulo: `${modelo.titulo} — ${modelo.funcionaria.nome} — ${modelo.competenciaRotulo}` });
}

export async function exportarCartao(modelo, formato) {
  if (formato === 'xlsx') {
    baixarArquivo(xlsxDoCartao(modelo), `${modelo.nomeArquivo}.xlsx`, MIME_XLSX);
    return;
  }
  baixarArquivo(await pdfDoCartao(modelo), `${modelo.nomeArquivo}.pdf`, 'application/pdf');
}

// ZIP da competência: um PDF por funcionária (mesmo modelo do individual).
export async function exportarZipCompetencia(modelos, nomeArquivo) {
  const bibliotecas = await bibliotecasPdf();
  const arquivos = modelos.map((m) => ({ caminho: `${m.nomeArquivo}.pdf`, conteudo: new Uint8Array(gerarPdfCartao(m, bibliotecas)) }));
  baixarArquivo(criarZip(arquivos), `${nomeArquivo}.zip`, 'application/zip');
}
