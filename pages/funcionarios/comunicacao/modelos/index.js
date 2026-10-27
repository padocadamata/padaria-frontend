import { useEffect, useState } from 'react';
import RequireAuth from '../../../../components/RequireAuth';
import PageShell from '../../../../components/shell/PageShell';
import ComunicacaoCabecalho, { AreaComunicacao, ROTA_EMPRESA, ROTA_GERAR, rotaModelo } from '../../../../components/documentos/ComunicacaoCabecalho';
import Alert from '../../../../components/ui/Alert';
import Badge from '../../../../components/ui/Badge';
import Button from '../../../../components/ui/Button';
import DataTable from '../../../../components/ui/DataTable';
import EmptyState from '../../../../components/ui/EmptyState';
import Field from '../../../../components/ui/Field';
import Select from '../../../../components/ui/Select';
import estilos from '../../../../components/documentos/documentos.module.css';
import { useAuth } from '../../../../hooks/useAuth';
import { carregarConfig, definirModeloAtivo, listarModelos } from '../../../../lib/documentos/consultas';
import { mensagemErroDocumento, permissoesComunicacao, resumoAssinaturas } from '../../../../lib/documentos/apresentacao';
import { ROTULO_ABRANGENCIA } from '../../../../lib/documentos/modelo';

// Folha de Pagamento > Comunicação > Modelos (migration 0077). Lista todos
// os modelos (ativos e inativos); criar/editar abre o editor em página
// própria; ativar/inativar pela RPC (não muda a versão). Modelo nunca é
// excluído. Quem só emite vê a lista (e gera a partir dela) sem editar.
function ModelosConteudo() {
  const { permissoes } = useAuth();
  const p = permissoesComunicacao(permissoes);
  const [modelos, setModelos] = useState([]);
  const [config, setConfig] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [situacao, setSituacao] = useState('ativos');
  const [alterando, setAlterando] = useState(null);

  async function carregar() {
    setCarregando(true);
    setErro('');
    try {
      const [m, c] = await Promise.all([listarModelos(), carregarConfig()]);
      setModelos(m);
      setConfig(c);
    } catch (e) {
      console.error('Erro ao carregar modelos:', e);
      setErro(mensagemErroDocumento(e));
    }
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  async function alternarAtivo(modelo) {
    setAlterando(modelo.id);
    setAviso('');
    setErro('');
    try {
      await definirModeloAtivo(modelo.id, !modelo.ativo);
      setAviso(`Modelo "${modelo.nome}" ${modelo.ativo ? 'inativado' : 'reativado'}.`);
      await carregar();
    } catch (e) {
      setErro(mensagemErroDocumento(e));
    }
    setAlterando(null);
  }

  const visiveis = modelos.filter((m) => (situacao === 'todos' ? true : situacao === 'ativos' ? m.ativo : !m.ativo));
  const semRazaoSocial = config && !config.razao_social;

  const colunas = [
    { chave: 'nome', rotulo: 'Nome', mobile: 'titulo', cartaoOrdem: 0, render: (m) => <strong>{m.nome}</strong> },
    { chave: 'abrangencia', rotulo: 'Aplicação', render: (m) => ROTULO_ABRANGENCIA[m.abrangencia] },
    { chave: 'titulo', rotulo: 'Título do documento', render: (m) => m.titulo_impresso },
    {
      chave: 'situacao',
      rotulo: 'Situação',
      mobile: 'titulo',
      cartaoOrdem: 1,
      render: (m) => <Badge tom={m.ativo ? 'success' : 'neutral'}>{m.ativo ? 'Ativo' : 'Inativo'}</Badge>,
    },
    { chave: 'versao', rotulo: 'Versão', alinhar: 'direita', render: (m) => `v${m.versao}` },
    { chave: 'assinaturas', rotulo: 'Assinaturas', render: (m) => <span className={estilos.secundario}>{resumoAssinaturas(m)}</span> },
  ];

  return (
    <PageShell titulo="Folha de Pagamento">
      <ComunicacaoCabecalho
        visao="modelos"
        acoes={
          <>
            {p.modelos && <Button variante="secondary" href={ROTA_EMPRESA}>Dados da empresa</Button>}
            {p.modelos && <Button icone="plus" href={rotaModelo('novo')}>Novo modelo</Button>}
          </>
        }
      />

      {semRazaoSocial && (
        <Alert tom="warning" className={estilos.mensagem}>
          Os dados da empresa ainda não foram preenchidos — nenhum documento pode ser emitido sem a razão social.
          {p.modelos ? ' Preencha em “Dados da empresa”.' : ' Peça a quem administra os modelos.'}
        </Alert>
      )}
      {aviso && <Alert tom="success" className={estilos.mensagem}>{aviso}</Alert>}
      {erro && <Alert tom="danger" className={estilos.mensagem}>{erro}</Alert>}

      <div className={estilos.visoes}>
        <Field label="Situação">
          <Select value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </Select>
        </Field>
      </div>

      {carregando ? (
        <p role="status">Carregando modelos...</p>
      ) : modelos.length === 0 ? (
        <EmptyState>{p.modelos ? 'Nenhum modelo criado. Comece por “Novo modelo”.' : 'Nenhum modelo criado ainda.'}</EmptyState>
      ) : visiveis.length === 0 ? (
        <EmptyState>Nenhum modelo nesta situação.</EmptyState>
      ) : (
        <DataTable
          rotulo="Modelos de documento"
          colunas={colunas}
          linhas={visiveis}
          chaveLinha={(m) => m.id}
          cartoesAte={900}
          destaque={(m) => (m.ativo ? undefined : 'inativo')}
          renderAcoes={(m) => (
            <div className={estilos.acoesDocumento}>
              {p.emitir && m.ativo && (
                <Button tamanho="sm" variante="secondary" href={`${ROTA_GERAR}?modelo=${m.id}`}>Gerar</Button>
              )}
              {p.modelos && (
                <Button tamanho="sm" variante="secondary" icone="pencil" href={rotaModelo(m.id)}>Editar</Button>
              )}
              {p.modelos && (
                <Button tamanho="sm" variante={m.ativo ? 'dangerOutline' : 'secondary'} disabled={alterando === m.id} onClick={() => alternarAtivo(m)}>
                  {m.ativo ? 'Inativar' : 'Reativar'}
                </Button>
              )}
            </div>
          )}
        />
      )}
    </PageShell>
  );
}

export default function ComunicacaoModelosPage() {
  return (
    <RequireAuth>
      <AreaComunicacao>
        <ModelosConteudo />
      </AreaComunicacao>
    </RequireAuth>
  );
}
