import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import RequireAuth from '../../components/RequireAuth';
import PageShell from '../../components/shell/PageShell';
import PageHeader from '../../components/ui/PageHeader';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import DataTable from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import { PERMISSOES } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';
import estilos from '../../components/admin/usuarios.module.css';

function BadgeStatus({ ativo }) {
  return <Badge tom={ativo ? 'success' : 'neutral'}>{ativo ? 'Ativo' : 'Inativo'}</Badge>;
}

function formatarUltimoAcesso(iso) {
  return iso ? new Date(iso).toLocaleString('pt-BR') : 'Nunca';
}

function UsuariosConteudo() {
  const router = useRouter();
  const [usuarios, setUsuarios] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    async function carregar() {
      const supabase = createClient();
      // RLS (migration 0005) já garante que só admin consegue ver todas as
      // linhas — um usuário não-admin só veria a própria linha, mesmo que
      // esta página fosse aberta por engano.
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nome, email, perfil, ativo, ultimo_acesso_em, criado_em')
        .order('criado_em', { ascending: true });

      if (error) {
        setErro('Não foi possível carregar a lista de usuários.');
      } else {
        setUsuarios(data || []);
      }
      setCarregando(false);
    }

    carregar();
  }, []);

  const colunas = [
    { chave: 'nome', rotulo: 'Nome', mobile: 'titulo', cartaoOrdem: 0, render: (u) => u.nome || '—' },
    { chave: 'status', rotulo: 'Status', mobile: 'titulo', cartaoOrdem: 1, render: (u) => <BadgeStatus ativo={u.ativo} /> },
    { chave: 'email', rotulo: 'Email', render: (u) => u.email || '—' },
    { chave: 'perfil', rotulo: 'Perfil', render: (u) => u.perfil },
    { chave: 'ultimoAcesso', rotulo: 'Último acesso', render: (u) => formatarUltimoAcesso(u.ultimo_acesso_em) },
  ];

  return (
    <PageShell titulo="Usuários">
      <PageHeader titulo="Usuários e Acessos" />

      <Alert tom="info" className={estilos.mensagem}>
        <span className={estilos.nota}>
          Clique em <strong>Gerenciar acessos</strong> para alterar perfil-base, ativar/desativar ou ajustar
          permissões individuais de um usuário. Criar um usuário novo ainda exige o painel do Supabase
          (Authentication → Users) e a migration <code>supabase/migrations/0006_bootstrap_admins_TEMPLATE.sql</code> —
          isso depende da chave privilegiada (service role), que não deve rodar no navegador, e fica para uma etapa
          futura com uma rota server-side dedicada.
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
            linhas={usuarios}
            chaveLinha={(u) => u.id}
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
