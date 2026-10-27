import { useEffect, useState } from 'react';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import DataTable from '../ui/DataTable';
import EmptyState from '../ui/EmptyState';
import SectionHeader from '../ui/SectionHeader';
import Paginacao, { paginarLista } from '../Paginacao';
import { ROTA_GERAR, rotaDocumento } from './ComunicacaoCabecalho';
import estilos from './documentos.module.css';
import { listarDocumentos } from '../../lib/documentos/consultas';
import { ROTULO_STATUS, TOM_STATUS, formatarDataOuTraco, mensagemErroDocumento } from '../../lib/documentos/apresentacao';

// Ficha do funcionário > Documentos: SÓ os documentos individuais deste
// funcionário (documento geral não tem funcionário). Abrir mostra o
// documento congelado da emissão. Não se chama "Advertências": qualquer
// modelo individual aparece aqui.
export default function DocumentosFuncionarioTab({ funcionarioId, podeEmitir }) {
  const [documentos, setDocumentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [pagina, setPagina] = useState(1);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    listarDocumentos({ funcionarioId, abrangencia: 'individual' })
      .then((d) => ativo && setDocumentos(d))
      .catch((e) => ativo && setErro(mensagemErroDocumento(e)))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [funcionarioId]);

  const paginacao = paginarLista(documentos, pagina);
  const colunas = [
    { chave: 'data_emissao', rotulo: 'Emissão', semQuebra: true, render: (d) => formatarDataOuTraco(d.data_emissao) },
    {
      chave: 'documento',
      rotulo: 'Documento',
      mobile: 'titulo',
      cartaoOrdem: 0,
      render: (d) => (
        <>
          {d.titulo} <span className={estilos.numero}>· {d.numero_formatado}</span>
        </>
      ),
    },
    { chave: 'assunto', rotulo: 'Motivo / Assunto', render: (d) => d.assunto || '—' },
    { chave: 'ocorrencia', rotulo: 'Ocorrência', semQuebra: true, render: (d) => formatarDataOuTraco(d.data_ocorrencia) },
    { chave: 'status', rotulo: 'Status', mobile: 'titulo', cartaoOrdem: 1, render: (d) => <Badge tom={TOM_STATUS[d.status]}>{ROTULO_STATUS[d.status]}</Badge> },
  ];

  return (
    <div className={estilos.superficie}>
      <SectionHeader
        titulo="Documentos emitidos"
        acao={podeEmitir && <Button tamanho="sm" icone="plus" href={`${ROTA_GERAR}?funcionario=${funcionarioId}`}>Gerar documento</Button>}
      />
      {carregando ? (
        <p role="status">Carregando documentos...</p>
      ) : erro ? (
        <Alert tom="danger">{erro}</Alert>
      ) : documentos.length === 0 ? (
        <EmptyState>Nenhum documento emitido para este funcionário.</EmptyState>
      ) : (
        <>
          <DataTable
            rotulo="Documentos do funcionário"
            colunas={colunas}
            linhas={paginacao.itens}
            chaveLinha={(d) => d.id}
            destaque={(d) => (d.status === 'cancelado' ? 'inativo' : undefined)}
            renderAcoes={(d) => (
              <Button variante="secondary" tamanho="sm" icone="eye" href={rotaDocumento(d.id)}>Abrir</Button>
            )}
          />
          <Paginacao paginaAtual={paginacao.paginaAtual} totalPaginas={paginacao.totalPaginas} onMudarPagina={setPagina} />
        </>
      )}
    </div>
  );
}
