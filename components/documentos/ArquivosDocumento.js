import { useState } from 'react';
import Button from '../ui/Button';
import { baixarArquivo } from '../../lib/exportacao/exportar';
import { gerarDocx, MIME_DOCX } from '../../lib/documentos/docx';
import { gerarPdfDocumento } from '../../lib/documentos/pdf';
import { nomeArquivoDocumento } from '../../lib/documentos/apresentacao';
import estilos from './documentos.module.css';

// Imprimir / PDF / Word do documento CONGELADO -- todos a partir da mesma
// representação intermediária (montarDocumento do snapshot). Tudo gerado no
// navegador; jsPDF só é carregado (import dinâmico) no clique.
export default function ArquivosDocumento({ registro, documento, rotaImpressao }) {
  const [gerando, setGerando] = useState('');
  const [erro, setErro] = useState('');
  const nome = nomeArquivoDocumento(registro);

  async function baixarPdf() {
    setGerando('pdf');
    setErro('');
    try {
      const { jsPDF } = await import('jspdf');
      baixarArquivo(gerarPdfDocumento(documento, { jsPDF }), `${nome}.pdf`, 'application/pdf');
    } catch (e) {
      console.error('Erro ao gerar PDF:', e);
      setErro('Não foi possível gerar o PDF.');
    }
    setGerando('');
  }

  function baixarWord() {
    setErro('');
    try {
      baixarArquivo(gerarDocx(documento), `${nome}.docx`, MIME_DOCX);
    } catch (e) {
      console.error('Erro ao gerar Word:', e);
      setErro('Não foi possível gerar o arquivo Word.');
    }
  }

  return (
    <div className={estilos.acoesDocumento}>
      <Button variante="secondary" href={`${rotaImpressao}?imprimir=1`} target="_blank" rel="noopener">Imprimir</Button>
      <Button variante="secondary" icone="download" onClick={baixarPdf} disabled={gerando === 'pdf'}>{gerando === 'pdf' ? 'Gerando…' : 'Baixar PDF'}</Button>
      <Button variante="secondary" icone="download" onClick={baixarWord}>Baixar Word</Button>
      {erro && <span role="alert" className={estilos.secundario}>{erro}</span>}
    </div>
  );
}
