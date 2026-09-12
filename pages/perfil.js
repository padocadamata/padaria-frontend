import CabecalhoPrincipal from '../components/CabecalhoPrincipal';
import RequireAuth from '../components/RequireAuth';
import { useAuth } from '../hooks/useAuth';
import { PERMISSOES } from '../lib/auth/permissoes';
import { APARENCIA_FIXA } from '../lib/branding/tema';

function PerfilConteudo() {
  const { usuarioAuth, perfilUsuario } = useAuth();
  const aparencia = APARENCIA_FIXA;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <CabecalhoPrincipal modulo="Perfil" />

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
          <h2 style={{ color: aparencia.corPrimaria }}>Informações do Usuário</h2>

          <div style={{ marginTop: '20px', display: 'grid', gap: '12px', maxWidth: '480px' }}>
            <Campo label="Nome" valor={perfilUsuario?.nome || '—'} />
            <Campo label="Email" valor={usuarioAuth?.email || '—'} />
            <Campo label="Perfil de acesso" valor={perfilUsuario?.perfil || '—'} />
            <Campo
              label="Último acesso registrado"
              valor={perfilUsuario?.ultimo_acesso_em ? new Date(perfilUsuario.ultimo_acesso_em).toLocaleString('pt-BR') : '—'}
            />
          </div>

          <p style={{ color: '#666', marginTop: '24px' }}>
            Edição de dados de perfil, troca de senha e foto ainda estão em desenvolvimento.
          </p>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, valor }) {
  return (
    <div>
      <div style={{ fontSize: '12px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: '16px', color: '#333' }}>{valor}</div>
    </div>
  );
}

export default function Perfil() {
  return (
    <RequireAuth permissao={PERMISSOES.PERFIL_VISUALIZAR}>
      <PerfilConteudo />
    </RequireAuth>
  );
}
