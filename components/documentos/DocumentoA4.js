import { assinaturasEmPares, cabecalhoEmpresa, linhaIdentificacao, linhasAssinatura, textoCancelamento, variaveisCssA4 } from '../../lib/documentos/layout';
import { cx } from '../../lib/design/cx';
import estilos from './documentoA4.module.css';

// Folha A4 do documento de RH -- a MESMA para a prévia da emissão, a
// visualização do documento emitido e a impressão. Recebe a representação
// intermediária de montarDocumento (lib/documentos/documento.js), montada
// SEMPRE do conteúdo + snapshot gravados (ou da prévia) -- nunca do modelo
// atual. Blocos, textos, tamanhos e espaços de lib/documentos/layout.js
// (TIPOGRAFIA/ESPACOS, como variáveis CSS), os mesmos do PDF e do Word.
const VARIAVEIS_A4 = variaveisCssA4();

export default function DocumentoA4({ documento, previa = false, className }) {
  const cab = cabecalhoEmpresa(documento.empresa);
  const cancelado = textoCancelamento(documento.cancelamento);

  return (
    <article className={cx(estilos.folha, previa && estilos.previa, className)} style={VARIAVEIS_A4} aria-label={`Documento ${documento.titulo}`}>
      {previa && <div className={estilos.marcaPrevia} aria-hidden="true">PRÉVIA</div>}
      <header className={estilos.cabecalho}>
        {cab.principal && <p className={estilos.empresa}>{cab.principal}</p>}
        {cab.linhas.map((linha) => (
          <p key={linha} className={estilos.empresaLinha}>{linha}</p>
        ))}
      </header>
      <p className={estilos.identificacao}>{linhaIdentificacao(documento)}</p>
      {cancelado && <p className={estilos.cancelado} role="note">{cancelado}</p>}

      <h2 className={estilos.titulo}>{documento.titulo}</h2>

      <div className={estilos.corpo}>
        {documento.paragrafos.map((linhas, i) => (
          <p key={i} className={estilos.paragrafo}>
            {linhas.map((linha, j) => (
              <span key={j} className={estilos.linha}>{linha}</span>
            ))}
          </p>
        ))}
      </div>

      {(documento.localData || documento.assinaturas.length > 0) && (
        <div className={estilos.fechamento}>
          {documento.localData && <p className={estilos.localData}>{documento.localData}</p>}
          {assinaturasEmPares(documento.assinaturas).map((par, i) => (
            <div key={i} className={estilos.parAssinaturas}>
              {par.map((assinatura, j) => (
                <div key={j} className={estilos.assinatura}>
                  {linhasAssinatura(assinatura).map((l, k) => (
                    <p key={k} className={cx(estilos.assinaturaLinha, l.negrito && estilos.negrito)}>{l.texto || ' '}</p>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
