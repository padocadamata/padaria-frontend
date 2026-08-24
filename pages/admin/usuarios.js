import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import MenuOpcoes from '../../components/MenuOpcoes';
import RequireAuth from '../../components/RequireAuth';
import { PERMISSOES } from '../../lib/auth/permissoes';
import { createClient } from '../../lib/supabase/client';

function UsuariosConteudo() {
  const router = useRouter();
  const [usuarios, setUsuarios] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aparencia, setAparencia] = useState({
    corPrimaria: '#8B4513',
    corFundo: '#f5f5f5',
    nomeEmpresa: 'Padaria Sistema',
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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>Usuários</h1>
          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
          <p style={{ color: '#666', marginBottom: '16px' }}>
            Clique em <strong>Gerenciar acessos</strong> para alterar perfil-base, ativar/desativar ou ajustar
            permissões individuais de um usuário. Criar um usuário novo ainda exige o painel do Supabase
            (Authentication → Users) e a migration{' '}
            <code>supabase/migrations/0006_bootstrap_admins_TEMPLATE.sql</code> — isso depende da chave privilegiada
            (service role), que não deve rodar no navegador, e fica para uma etapa futura com uma rota server-side
            dedicada.
          </p>

          {carregando ? (
            <p>Carregando usuários…</p>
          ) : erro ? (
            <p style={{ color: '#f44336' }}>{erro}</p>
          ) : usuarios.length === 0 ? (
            <p>Nenhum usuário cadastrado ainda em public.usuarios.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  <th style={thStyle(aparencia)}>Nome</th>
                  <th style={thStyle(aparencia)}>Email</th>
                  <th style={thStyle(aparencia)}>Perfil</th>
                  <th style={thStyle(aparencia)}>Status</th>
                  <th style={thStyle(aparencia)}>Último acesso</th>
                  <th style={thStyle(aparencia)}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #ddd' }}>
                    <td style={{ padding: '12px' }}>{u.nome || '-'}</td>
                    <td style={{ padding: '12px' }}>{u.email || '-'}</td>
                    <td style={{ padding: '12px' }}>{u.perfil}</td>
                    <td style={{ padding: '12px' }}>{u.ativo ? 'Ativo' : 'Inativo'}</td>
                    <td style={{ padding: '12px' }}>
                      {u.ultimo_acesso_em ? new Date(u.ultimo_acesso_em).toLocaleString('pt-BR') : 'Nunca'}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <button
                        onClick={() => router.push(`/admin/usuarios/${u.id}`)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: aparencia.corPrimaria,
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontSize: '13px',
                        }}
                      >
                        Gerenciar acessos
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function thStyle(aparencia) {
  return { padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold' };
}

export default function Usuarios() {
  return (
    <RequireAuth permissao={PERMISSOES.USUARIOS_ADMINISTRAR}>
      <UsuariosConteudo />
    </RequireAuth>
  );
}
