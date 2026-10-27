import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../../components/RequireAuth';
import PageShell from '../../../components/shell/PageShell';
import ComunicacaoCabecalho, { AreaComunicacao, ROTA_GERAR, ROTA_MODELOS, rotaDocumento } from '../../../components/documentos/ComunicacaoCabecalho';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Field from '../../../components/ui/Field';
import FilterBar from '../../../components/ui/FilterBar';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Paginacao, { paginarLista } from '../../../components/Paginacao';
import estilos from '../../../components/documentos/documentos.module.css';
import { useAuth } from '../../../hooks/useAuth';
import { listarDocumentos, listarFuncionarios, listarModelos } from '../../../lib/documentos/consultas';
import {
  ROTULO_STATUS,
  TOM_STATUS,
  formatarDataOuTraco,
  mensagemErroDocumento,
  permissoesComunicacao,
  quantidadeFiltrosAtivos,
  rotuloDestinatario,
} from '../../../lib/documentos/apresentacao';
import { ROTULO_ABRANGENCIA } from '../../../lib/documentos/modelo';
import { useFiltrosPersistidos, useSanearFiltros } from '../../../lib/filtros/useFiltrosPersistidos';
import { FILTROS_DOCUMENTOS, regrasSaneamentoDocumentos } from '../../../lib/filtros/telas';
import { useOrdenacao } from '../../../lib/ordenacao/useOrdenacao';
import { ordenarOpcoes } from '../../../lib/ordenacao/opcoes';

// Folha de Pagamento > Comunicação > Documentos (migration 0077) --
// histórico central dos documentos EMITIDOS (individuais e gerais).
// Filtros persistidos na sessão de login (lib/filtros); paginação no
// navegador (20 por página), nunca persistida. Documento emitido não se
// edita: a ação é abrir (visualizar/imprimir/baixar/cancelar).
const CARTOES_ATE = 900;

function DocumentosConteudo() {
  const router = useRouter();
  const { permissoes } = useAuth();
  const p = permissoesComunicacao(permissoes);

  // Quem entra na área sem ver documentos (só emite/administra) vai para
  // Modelos -- a RLS não mostraria nenhum documento.
  useEffect(() => {
    if (!p.visualizar) router.replace(ROTA_MODELOS);
  }, [p.visualizar, router]);

  const filtros = useFiltrosPersistidos('comunicacao.documentos', FILTROS_DOCUMENTOS);
  const [funcionarios, setFuncionarios] = useState([]);
  const [funcionariosProntos, setFuncionariosProntos] = useState(false);
  const [modelos, setModelos] = useState([]);
  const [modelosProntos, setModelosProntos] = useState(false);
  const valores = useSanearFiltros(filtros, regrasSaneamentoDocumentos({ funcionariosProntos, funcionarios, modelosProntos, modelos }));
  const { dataInicio, dataFim, funcionarioId, modeloId, abrangencia, status } = valores;
  const definir = filtros.definir;

  const [documentos, setDocumentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [pagina, setPagina] = useState(1);
  const ordenacao = useOrdenacao({ aoMudar: () => setPagina(1), persistirEm: 'comunicacao.documentos' });

  useEffect(() => {
    if (!p.visualizar) return undefined;
    let ativo = true;
    listarModelos()
      .then((m) => ativo && (setModelos(m), setModelosProntos(true)))
      .catch((e) => console.error('Erro ao carregar modelos:', e));
    // Cadastro de funcionários segue a RLS dele (funcionarios.visualizar);
    // sem acesso, o filtro mostra só "Todos".
    listarFuncionarios()
      .then((f) => ativo && (setFuncionarios(f), setFuncionariosProntos(true)))
      .catch((e) => console.error('Erro ao carregar funcionários:', e));
    return () => {
      ativo = false;
    };
  }, [p.visualizar]);

  useEffect(() => {
    if (!p.visualizar) return undefined;
    let ativo = true;
    setCarregando(true);
    setErro('');
    setPagina(1);
    listarDocumentos({ dataInicio, dataFim, funcionarioId, modeloId, abrangencia, status })
      .then((d) => ativo && setDocumentos(d))
      .catch((e) => {
        console.error('Erro ao carregar documentos:', e);
        if (ativo) setErro(mensagemErroDocumento(e));
      })
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [p.visualizar, dataInicio, dataFim, funcionarioId, modeloId, abrangencia, status]);

  const colunas = useMemo(() => [
    { chave: 'numero', rotulo: 'Número', mobile: 'titulo', cartaoOrdem: 0, semQuebra: true, ordenavel: { valor: (d) => d.ano * 100000 + d.numero, tipo: 'numero' }, render: (d) => <span className={estilos.numero}>{d.numero_formatado}</span> },
    { chave: 'data_emissao', rotulo: 'Emissão', semQuebra: true, ordenavel: { tipo: 'data', valor: (d) => d.data_emissao }, render: (d) => formatarDataOuTraco(d.data_emissao) },
    {
      chave: 'documento',
      rotulo: 'Documento',
      ordenavel: { valor: (d) => d.titulo },
      render: (d) => (
        <>
          {d.titulo}
          {d.modelo_nome && d.modelo_nome !== d.titulo ? <span className={estilos.secundario}> · {d.modelo_nome}</span> : null}
        </>
      ),
    },
    {
      chave: 'destinatario',
      rotulo: 'Funcionário / Aplicação',
      ordenavel: { valor: (d) => rotuloDestinatario(d) },
      render: (d) => (d.abrangencia === 'geral' ? <Badge tom="info">Documento geral</Badge> : rotuloDestinatario(d)),
    },
    { chave: 'assunto', rotulo: 'Assunto', ordenavel: { valor: (d) => d.assunto || '' }, render: (d) => d.assunto || '—' },
    {
      chave: 'status',
      rotulo: 'Status',
      mobile: 'titulo',
      cartaoOrdem: 1,
      ordenavel: { valor: (d) => d.status, ordem: ['emitido', 'cancelado'] },
      render: (d) => <Badge tom={TOM_STATUS[d.status]}>{ROTULO_STATUS[d.status]}</Badge>,
    },
  ], []);

  const paginacao = paginarLista(ordenacao.ordenar(documentos, colunas), pagina);
  const paginaAtual = paginacao.paginaAtual;
  useEffect(() => {
    if (pagina !== paginaAtual) setPagina(paginaAtual);
  }, [pagina, paginaAtual]);

  if (!p.visualizar) return null;

  const ativos = quantidadeFiltrosAtivos(filtros.valores, FILTROS_DOCUMENTOS.padrao);
  const opcoesFuncionario = ordenarOpcoes(funcionarios);

  return (
    <PageShell titulo="Folha de Pagamento">
      <ComunicacaoCabecalho
        visao="documentos"
        acoes={p.emitir && <Button icone="plus" href={ROTA_GERAR}>Gerar documento</Button>}
      />

      <FilterBar ativos={ativos} onLimpar={filtros.redefinir}>
        <Field label="Emissão — de">
          <Input type="date" value={dataInicio} onChange={(e) => definir('dataInicio', e.target.value)} />
        </Field>
        <Field label="até">
          <Input type="date" value={dataFim} onChange={(e) => definir('dataFim', e.target.value)} />
        </Field>
        <Field label="Funcionário">
          <Select value={funcionarioId} onChange={(e) => definir('funcionarioId', e.target.value)}>
            <option value="">Todos</option>
            {opcoesFuncionario.map((f) => (
              <option key={f.id} value={f.id}>{f.nome}{f.ativo === false ? ' (inativo)' : ''}</option>
            ))}
          </Select>
        </Field>
        <Field label="Modelo">
          <Select value={modeloId} onChange={(e) => definir('modeloId', e.target.value)}>
            <option value="">Todos</option>
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>{m.nome}{m.ativo ? '' : ' (inativo)'}</option>
            ))}
          </Select>
        </Field>
        <Field label="Aplicação">
          <Select value={abrangencia} onChange={(e) => definir('abrangencia', e.target.value)}>
            <option value="">Todas</option>
            <option value="individual">{ROTULO_ABRANGENCIA.individual}</option>
            <option value="geral">{ROTULO_ABRANGENCIA.geral}</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => definir('status', e.target.value)}>
            <option value="">Todos</option>
            <option value="emitido">{ROTULO_STATUS.emitido}</option>
            <option value="cancelado">{ROTULO_STATUS.cancelado}</option>
          </Select>
        </Field>
      </FilterBar>

      {carregando ? (
        <p role="status">Carregando documentos...</p>
      ) : erro ? (
        <Alert tom="danger">{erro}</Alert>
      ) : documentos.length === 0 ? (
        <EmptyState>{ativos > 0 ? 'Nenhum documento para este filtro.' : 'Nenhum documento emitido ainda.'}</EmptyState>
      ) : (
        <div className={estilos.superficie}>
          <DataTable
            rotulo="Documentos emitidos"
            colunas={colunas}
            linhas={paginacao.itens}
            chaveLinha={(d) => d.id}
            ordenacao={ordenacao.props}
            cartoesAte={CARTOES_ATE}
            destaque={(d) => (d.status === 'cancelado' ? 'inativo' : undefined)}
            renderAcoes={(d) => (
              <Button variante="secondary" tamanho="sm" icone="eye" href={rotaDocumento(d.id)}>
                Abrir
              </Button>
            )}
          />
          <p className={estilos.resumo}>
            Mostrando {paginacao.primeiro}–{paginacao.ultimo} de {paginacao.total} {paginacao.total === 1 ? 'documento' : 'documentos'}
            {paginacao.totalPaginas > 1 ? ` — página ${paginaAtual} de ${paginacao.totalPaginas}` : ''}
          </p>
          <Paginacao paginaAtual={paginaAtual} totalPaginas={paginacao.totalPaginas} onMudarPagina={setPagina} />
        </div>
      )}
    </PageShell>
  );
}

export default function ComunicacaoDocumentosPage() {
  return (
    <RequireAuth>
      <AreaComunicacao>
        <DocumentosConteudo />
      </AreaComunicacao>
    </RequireAuth>
  );
}
