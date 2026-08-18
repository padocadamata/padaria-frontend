import { useState, useEffect } from 'react';
import MenuOpcoes from '../components/MenuOpcoes';
import RequireAuth from '../components/RequireAuth';
import { useAuth } from '../hooks/useAuth';
import { PERMISSOES } from '../lib/auth/permissoes';

function PerfilConteudo() {
  const { usuarioAuth, perfilUsuario } = useAuth();
  const [aparencia, setAparencia] = useState({
    corPrimaria: '#8B4513',
    corFundo: '#f5f5f5',
    nomeEmpresa: 'Padaria Sistema',
    logoBase64: null,
  });

  useEffect(() => {
    const config = localStorage.getItem('aparenciaConfig');
    if (config) {
      try {
        setAparencia(JSON.parse(config));
      } catch (e) {
        console.error('Erro ao carregar aparência:', e);
      }
    }

    const handleAparenciaAlterada = () => {
      const config = localStorage.getItem('aparenciaConfig');
      if (config) {
        try {
          setAparencia(JSON.parse(config));
        } catch (e) {
          console.error('Erro ao carregar aparência:', e);
        }
      }
    };

    window.addEventListener('aparenciaAlterada', handleAparenciaAlterada);
    return () => window.removeEventListener('aparenciaAlterada', handleAparenciaAlterada);
  }, []);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>Meu Perfil</h1>
          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

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
