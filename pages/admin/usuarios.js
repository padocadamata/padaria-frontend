import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../components/RequireAuth';
import NovoUsuarioModal from '../../components/admin/NovoUsuarioModal';
import PageShell from '../../components/shell/PageShell';
import PageHeader from '../../components/ui/PageHeader';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import DataTable from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import { PERMISSOES } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import estilos from '../../components/admin/usuarios.module.css';
import { useOrdenacao } from '../../lib/ordenacao/useOrdenacao';

function BadgeStatus({ ativo }) {
  return <Badge tom={ativo ? 'success' : 'neutral'}>{ativo ? 'Ativo' : 'Inativo'}</Badge>;
}

function formatarDataHora(iso, vazio = 'Nunca') {
  return iso ? new Date(iso).toLocaleString('pt-BR') : vazio;
}

// RPC da migration 0072 ainda não aplicada no banco -> a seção de logins
// sem vínculo simplesmente não aparece (nada quebra na lista principal).
function funcaoAusente(error) {
  const msg = error?.message || '';
  return error?.code === 'PGRST202' || msg.includes('Could not find the function');
}

function UsuariosConteudo() {
  const router = useRouter();
  const [usuarios, setUsuarios] = useState([]);
  const [perfis, setPerfis] = useState([]);
  const [semVinculo, setSemVinculo] = useState([]);
  const [semVinculoDisponivel, setSemVinculoDisponivel] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modal, setModal] = useState(null); // { modo: 'novo' } | { modo: 'vincular', login }
  // Ordenação do cabeçalho de cada tabela, guardada durante a sessão de login.
  const ordenacaoUsuarios = useOrdenacao({ persistirEm: 'admin.usuarios' });
  const ordenacaoSemVinculo = useOrdenacao({ persistirEm: 'admin.usuarios.sem-vinculo' });

  async function carregar() {
    const supabase = createClient();
    // RLS (migration 0005) já garante que só admin consegue ver todas as
    // linhas — um usuário não-admin só veria a própria linha, mesmo que
    // esta página fosse aberta por engano.
    const [resUsuarios, resPerfis, resSemVinculo] = await Promise.all([
      supabase
        .from('usuarios')
        .select('id, nome, email, perfil, ativo, ultimo_acesso_em, criado_em')
        .order('criado_em', { ascending: true }),
      supabase.from('perfis').select('nome, descricao').eq('ativo', true).order('nivel', { ascending: false }),
      supabase.rpc('admin_listar_auth_sem_vinculo'),
    ]);

    if (resUsuarios.error) {
      setErro('Não foi possível carregar a lista de usuários.');
    } else {
      setErro('');
      setUsuarios(resUsuarios.data || []);
    }
    setPerfis(resPerfis.data || []);

    if (resSemVinculo.error) {
      setSemVinculo([]);
      setSemVinculoDisponivel(!funcaoAusente(resSemVinculo.error));
    } else {
      setSemVinculo(resSemVinculo.data || []);
      setSemVinculoDisponivel(true);
    }
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  function concluido(usuarioId) {
    setModal(null);
    router.push(`/admin/usuarios/${usuarioId}?criado=1`);
  }

  const colunas = [
    { chave: 'nome', rotulo: 'Nome', mobile: 'titulo', cartaoOrdem: 0, ordenavel: true, render: (u) => u.nome || '—' },
    { chave: 'status', rotulo: 'Status', mobile: 'titulo', cartaoOrdem: 1, ordenavel: { tipo: 'booleano', valor: (u) => u.ativo }, render: (u) => <BadgeStatus ativo={u.ativo} /> },
    { chave: 'email', rotulo: 'Email', ordenavel: true, render: (u) => u.email || '—' },
    { chave: 'perfil', rotulo: 'Perfil', ordenavel: true, render: (u) => u.perfil },
    { chave: 'ultimoAcesso', rotulo: 'Último acesso', ordenavel: { tipo: 'data', valor: (u) => u.ultimo_acesso_em }, render: (u) => formatarDataHora(u.ultimo_acesso_em) },
  ];

  const colunasSemVinculo = [
    { chave: 'email', rotulo: 'E-mail do login', mobile: 'titulo', cartaoOrdem: 0, ordenavel: true, render: (l) => l.email || '—' },
    { chave: 'criado', rotulo: 'Criado em', ordenavel: { tipo: 'data', valor: (l) => l.criado_em }, render: (l) => formatarDataHora(l.criado_em, '—') },
    {
      chave: 'confirmado',
      rotulo: 'E-mail confirmado',
      ordenavel: { tipo: 'booleano', valor: (l) => !!l.email_confirmado_em },
      render: (l) => (l.email_confirmado_em ? 'Sim' : <Badge tom="warning">Não</Badge>),
    },
    { chave: 'login', rotulo: 'Último login', ordenavel: { tipo: 'data', valor: (l) => l.ultimo_login_em }, render: (l) => formatarDataHora(l.ultimo_login_em) },
  ];

  return (
    <PageShell titulo="Usuários">
      <PageHeader
        titulo="Usuários e Acessos"
        acoes={
          <Button icone="plus" onClick={() => setModal({ modo: 'novo' })} disabled={carregando || perfis.length === 0}>
            Novo usuário
          </Button>
        }
      />

      <Alert tom="info" className={estilos.mensagem}>
        <span className={estilos.nota}>
          <strong>Novo usuário</strong> cria o login e o cadastro no sistema de uma vez, com o perfil escolhido. Clique em{' '}
          <strong>Gerenciar acessos</strong> para alterar perfil-base, ativar/desativar ou ajustar permissões
          individuais.
        </span>
      </Alert>

      {carregando ? (
        <p role="status">Carregando usuários…</p>
      ) : erro ? (
        <Alert tom="danger">{erro}</Alert>
      ) : usuarios.length === 0 ? (
        <EmptyState>Nenhum usuário cadastrado ainda em public.usuarios.</EmptyState>
      ) : (
        <div className={estilos.superficie}>
          <DataTable
            rotulo="Usuários"
            colunas={colunas}
            linhas={ordenacaoUsuarios.ordenar(usuarios, colunas)}
            chaveLinha={(u) => u.id}
            ordenacao={ordenacaoUsuarios.props}
            destaque={(u) => (u.ativo ? null : 'inativo')}
            cartoesAte={900}
            renderAcoes={(u) => (
              <Button variante="secondary" tamanho="sm" onClick={() => router.push(`/admin/usuarios/${u.id}`)}>
                Gerenciar acessos
              </Button>
            )}
          />
        </div>
      )}

      {!carregando && semVinculoDisponivel && semVinculo.length > 0 && (
        <div className={estilos.secaoSemVinculo}>
          <Card titulo={`Logins sem vínculo (${semVinculo.length})`}>
            <Alert tom="warning" className={estilos.mensagem}>
              Estes logins existem no Authentication mas não têm cadastro no sistema — conseguem entrar, porém sem
              nenhuma permissão. Vincule cada um a um nome e perfil.
            </Alert>
            <DataTable
              rotulo="Logins sem vínculo"
              colunas={colunasSemVinculo}
              linhas={ordenacaoSemVinculo.ordenar(semVinculo, colunasSemVinculo)}
              chaveLinha={(l) => l.id}
              ordenacao={ordenacaoSemVinculo.props}
              cartoesAte={900}
              renderAcoes={(l) => (
                <Button tamanho="sm" onClick={() => setModal({ modo: 'vincular', login: l })} disabled={perfis.length === 0}>
                  Vincular
                </Button>
              )}
            />
          </Card>
        </div>
      )}

      {modal && (
        <NovoUsuarioModal
          modo={modal.modo}
          login={modal.login || null}
          perfis={perfis}
          onFechar={() => setModal(null)}
          onConcluido={concluido}
        />
      )}
    </PageShell>
  );
}

export default function Usuarios() {
  return (
    <RequireAuth permissao={PERMISSOES.USUARIOS_ADMINISTRAR}>
      <UsuariosConteudo />
    </RequireAuth>
  );
}
