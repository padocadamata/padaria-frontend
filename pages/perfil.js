import RequireAuth from '../components/RequireAuth';
import PageShell from '../components/shell/PageShell';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import { useAuth } from '../hooks/useAuth';
import { PERMISSOES } from '../lib/auth/permissoes';

const grade = {
  display: 'grid',
  gap: 'var(--ds-sp-3)',
  maxWidth: '480px',
};

const rotuloEstilo = {
  fontSize: 'var(--ds-fs-aux)',
  color: 'var(--ds-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const valorEstilo = {
  fontSize: 'var(--ds-fs-card)',
  color: 'var(--ds-text)',
};

function Campo({ label, valor }) {
  return (
    <div>
      <div style={rotuloEstilo}>{label}</div>
      <div style={valorEstilo}>{valor}</div>
    </div>
  );
}

function PerfilConteudo() {
  const { usuarioAuth, perfilUsuario } = useAuth();

  return (
    <PageShell titulo="Perfil">
      <PageHeader titulo="Meu perfil" />

      <Card titulo="Informações do usuário">
        <div style={grade}>
          <Campo label="Nome" valor={perfilUsuario?.nome || '—'} />
          <Campo label="Email" valor={usuarioAuth?.email || '—'} />
          <Campo label="Perfil de acesso" valor={perfilUsuario?.perfil || '—'} />
          <Campo
            label="Último acesso registrado"
            valor={perfilUsuario?.ultimo_acesso_em ? new Date(perfilUsuario.ultimo_acesso_em).toLocaleString('pt-BR') : '—'}
          />
        </div>

        <p style={{ color: 'var(--ds-text-muted)', marginTop: 'var(--ds-sp-5)', fontSize: 'var(--ds-fs-label)' }}>
          Edição de dados de perfil, troca de senha e foto ainda estão em desenvolvimento.
        </p>
      </Card>
    </PageShell>
  );
}

export default function Perfil() {
  return (
    <RequireAuth permissao={PERMISSOES.PERFIL_VISUALIZAR}>
      <PerfilConteudo />
    </RequireAuth>
  );
}
