import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import RequireAuth from '../../../../../components/RequireAuth';
import PageShell from '../../../../../components/shell/PageShell';
import FuncionariosSubNav from '../../../../../components/funcionarios/FuncionariosSubNav';
import { ROTA_DOCUMENTOS, ROTA_GERAR, rotaDocumento } from '../../../../../components/documentos/ComunicacaoCabecalho';
import ArquivosDocumento from '../../../../../components/documentos/ArquivosDocumento';
import CancelarDocumentoModal from '../../../../../components/documentos/CancelarDocumentoModal';
import DocumentoA4 from '../../../../../components/documentos/DocumentoA4';
import PageHeader from '../../../../../components/ui/PageHeader';
import Alert from '../../../../../components/ui/Alert';
import Badge from '../../../../../components/ui/Badge';
import Button from '../../../../../components/ui/Button';
import Card from '../../../../../components/ui/Card';
import estilos from '../../../../../components/documentos/documentos.module.css';
import { useAuth } from '../../../../../hooks/useAuth';
import { PERMISSOES } from '../../../../../lib/auth/permissoes';
import { carregarDocumento } from '../../../../../lib/documentos/consultas';
import { montarDocumento } from '../../../../../lib/documentos/documento';
import {
  ROTULO_STATUS,
  TOM_STATUS,
  formatarDataOuTraco,
  formatarMomento,
  mensagemErroDocumento,
  permissoesComunicacao,
  rotuloDestinatario,
} from '../../../../../lib/documentos/apresentacao';
import { ROTULO_ABRANGENCIA } from '../../../../../lib/documentos/modelo';

// Documento EMITIDO (migration 0077) -- sempre reconstruído do conteúdo +
// snapshot gravados na emissão (montarDocumento), NUNCA do modelo atual nem
// do cadastro atual. Somente leitura: imprimir, PDF, Word e -- com
// permissão -- cancelar (lógico, com motivo). Não existe edição.
function DocumentoConteudo() {
  const router = useRouter();
  const { id } = router.query;
  const { permissoes } = useAuth();
  const p = permissoesComunicacao(permissoes);
  const [registro, setRegistro] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [cancelando, setCancelando] = useState(false);
  const [aviso, setAviso] = useState('');

  async function carregar() {
    if (!id) return;
    setCarregando(true);
    setErro('');
    try {
      const r = await carregarDocumento(id);
      if (!r) setErro('Documento não encontrado ou sem permissão para vê-lo.');
      setRegistro(r);
    } catch (e) {
      setErro(mensagemErroDocumento(e));
    }
    setCarregando(false);
  }

  useEffect(() => {
    if (router.isReady) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, id]);

  useEffect(() => {
    if (router.query.emitido === '1') setAviso('Documento emitido.');
  }, [router.query.emitido]);

  if (carregando) {
    return (
      <PageShell titulo="Folha de Pagamento">
        <p role="status">Carregando documento...</p>
      </PageShell>
    );
  }

  if (erro || !registro) {
    return (
      <PageShell titulo="Folha de Pagamento">
        <FuncionariosSubNav ativo="comunicacao" />
        <Alert tom="danger" className={estilos.mensagem}>{erro || 'Documento não encontrado.'}</Alert>
        <Button variante="secondary" href={ROTA_DOCUMENTOS}>← Voltar para documentos</Button>
      </PageShell>
    );
  }

  const documento = montarDocumento(registro);
  const s = registro.snapshot;
  const cancelado = registro.status === 'cancelado';

  return (
    <PageShell titulo="Folha de Pagamento">
      <FuncionariosSubNav ativo="comunicacao" />
      <PageHeader
        titulo={
          <span>
            {registro.titulo} <span className={estilos.numero}>nº {registro.numero_formatado}</span>{' '}
            <Badge tom={TOM_STATUS[registro.status]}>{ROTULO_STATUS[registro.status]}</Badge>
          </span>
        }
        acoes={
          <>
            <Button variante="secondary" href={ROTA_DOCUMENTOS}>← Documentos</Button>
            {p.emitir && <Button variante="secondary" href={ROTA_GERAR}>Gerar outro</Button>}
          </>
        }
      />

      {aviso && <Alert tom="success" className={estilos.mensagem}>{aviso}</Alert>}

      <div className={estilos.duasColunas}>
        <div className={estilos.formulario}>
          <Card titulo="Dados do documento">
            <dl className={estilos.metadados}>
              <div><dt>Número</dt><dd>{registro.numero_formatado}</dd></div>
              <div><dt>Situação</dt><dd>{ROTULO_STATUS[registro.status]}</dd></div>
              <div><dt>Emissão</dt><dd>{formatarDataOuTraco(registro.data_emissao)}</dd></div>
              <div><dt>Modelo</dt><dd>{s.modelo.nome} (v{registro.modelo_versao})</dd></div>
              <div><dt>Aplicação</dt><dd>{ROTULO_ABRANGENCIA[registro.abrangencia]}</dd></div>
              <div>
                <dt>Funcionário</dt>
                <dd>
                  {registro.abrangencia === 'geral' ? 'Documento geral' : registro.funcionario_id ? (
                    <Link href={`/funcionarios/${registro.funcionario_id}`}>{rotuloDestinatario(registro)}</Link>
                  ) : rotuloDestinatario(registro)}
                </dd>
              </div>
              {registro.assunto && <div><dt>Assunto</dt><dd>{registro.assunto}</dd></div>}
              {registro.data_ocorrencia && <div><dt>Ocorrência</dt><dd>{formatarDataOuTraco(registro.data_ocorrencia)}</dd></div>}
              <div><dt>Emitido por</dt><dd>{registro.criado_por_nome || '—'} · {formatarMomento(registro.criado_em)}</dd></div>
            </dl>
            {cancelado && (
              <Alert tom="danger" className={estilos.blocoCancelamento}>
                <strong>Cancelado</strong> em {formatarMomento(registro.cancelado_em)}{registro.cancelado_por_nome ? ` por ${registro.cancelado_por_nome}` : ''}.
                <br />
                Motivo: {registro.motivo_cancelamento}
              </Alert>
            )}
          </Card>

          <Card titulo="Arquivos">
            <ArquivosDocumento registro={registro} documento={documento} rotaImpressao={`${rotaDocumento(registro.id)}/imprimir`} />
          </Card>

          {!cancelado && p.cancelarVisivel && (
            <Card titulo="Cancelamento" subtitulo="Documento emitido não se edita. Se houver erro, cancele e emita outro.">
              <Button variante="dangerOutline" onClick={() => setCancelando(true)}>Cancelar documento</Button>
            </Card>
          )}
        </div>

        <div className={estilos.colunaPrevia}>
          <div className={estilos.areaFolha}>
            <DocumentoA4 documento={documento} />
          </div>
        </div>
      </div>

      {cancelando && (
        <CancelarDocumentoModal
          documento={registro}
          onFechar={() => setCancelando(false)}
          onCancelado={async () => {
            setCancelando(false);
            setAviso('Documento cancelado. Ele continua no histórico, marcado como cancelado.');
            await carregar();
          }}
        />
      )}
    </PageShell>
  );
}

export default function DocumentoPage() {
  return (
    <RequireAuth permissao={PERMISSOES.FOLHA_DOCUMENTOS_VISUALIZAR}>
      <DocumentoConteudo />
    </RequireAuth>
  );
}
