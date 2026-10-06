import { gerarXlsx, MIME_XLSX } from './xlsx.js';
import { gerarPdfRelatorio } from './pdf.js';

// Ponto único de exportação no NAVEGADOR: recebe um modelo pronto (ver
// lib/funcionarios/escalaExportacao.js) e baixa o arquivo. Tudo é gerado no
// cliente com os dados já carregados na tela -- nenhuma chamada a
// backend/banco. jsPDF só é carregado (import dinâmico) no primeiro clique
// em PDF, para não pesar no carregamento da página.

export function baixarArquivo(bytes, nomeArquivo, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportarRelatorio(modelo, formato) {
  if (formato === 'xlsx') {
    const bytes = gerarXlsx({ planilhas: modelo.planilhas, titulo: `${modelo.titulo} — ${modelo.periodoRotulo}` });
    baixarArquivo(bytes, `${modelo.nomeArquivo}.xlsx`, MIME_XLSX);
    return;
  }
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const bytes = gerarPdfRelatorio(modelo, { jsPDF, autoTable });
  baixarArquivo(bytes, `${modelo.nomeArquivo}.pdf`, 'application/pdf');
}
