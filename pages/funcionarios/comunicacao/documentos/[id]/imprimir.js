import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import RequireAuth from '../../../../../components/RequireAuth';
import DocumentoA4 from '../../../../../components/documentos/DocumentoA4';
import { rotaDocumento } from '../../../../../components/documentos/ComunicacaoCabecalho';
import estilos from '../../../../../components/documentos/impressao.module.css';
import { PERMISSOES } from '../../../../../lib/auth/permissoes';
import { carregarDocumento } from '../../../../../lib/documentos/consultas';
import { montarDocumento } from '../../../../../lib/documentos/documento';
import { mensagemErroDocumento } from '../../../../../lib/documentos/apresentacao';

// Impressão do documento emitido (A4 retrato) -- visualização PRÓPRIA para
// papel (sem menu nem botões na folha), mesmo padrão de Tarefas > Imprimir:
// ?imprimir=1 abre o diálogo nativo (imprimir ou "Salvar como PDF") assim
// que o documento carrega; sem o parâmetro só mostra. A folha é a MESMA da
// tela (DocumentoA4), montada do snapshot gravado.
const PAGINA_A4_RETRATO = `
  @page { size: A4 portrait; margin: 20mm; }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  }
`;

function ImpressaoDocumento() {
  const router = useRouter();
  const { id } = router.query;
  const [registro, setRegistro] = useState(null);
  const [erro, setErro] = useState('');
  const imprimiu = useRef(false);

  useEffect(() => {
    if (!router.isReady || !id) return undefined;
    let ativo = true;
    carregarDocumento(id)
      .then((r) => {
        if (!ativo) return;
        if (!r) setErro('Documento não encontrado ou sem permissão para vê-lo.');
        setRegistro(r);
      })
      .catch((e) => ativo && setErro(mensagemErroDocumento(e)));
    return () => {
      ativo = false;
    };
  }, [router.isReady, id]);

  useEffect(() => {
    if (!registro || imprimiu.current || router.query.imprimir !== '1') return undefined;
    imprimiu.current = true;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [registro, router.query.imprimir]);

  return (
    <div className={estilos.pagina}>
      <Head>
        <title>{registro ? `${registro.titulo} — ${registro.numero_formatado}` : 'Documento'}</title>
        <style dangerouslySetInnerHTML={{ __html: PAGINA_A4_RETRATO }} />
      </Head>
      <div className={estilos.barra}>
        {id && <Link href={rotaDocumento(id)}>← Voltar ao documento</Link>}
        <button type="button" onClick={() => window.print()} disabled={!registro}>
          Imprimir / Salvar em PDF
        </button>
        <p className={estilos.dica}>Na janela de impressão: papel A4, orientação Retrato, margens Padrão e sem cabeçalhos/rodapés do navegador.</p>
        {erro && <p className={estilos.dica} role="alert">{erro}</p>}
      </div>
      {!registro && !erro && <p className={estilos.barra} role="status">Carregando documento…</p>}
      {registro && <DocumentoA4 documento={montarDocumento(registro)} />}
    </div>
  );
}

export default function ImpressaoDocumentoPage() {
  return (
    <RequireAuth permissao={PERMISSOES.FOLHA_DOCUMENTOS_VISUALIZAR}>
      <ImpressaoDocumento />
    </RequireAuth>
  );
}
