import { useAuth } from '../../hooks/useAuth';
import { isAdmin } from '../../lib/auth/permissoes';

// Central de Importações do G3 (migration 0081): EXCLUSIVA do perfil
// proprietario_admin ativo -- por PERFIL, não por permissão (não existe
// código em `permissoes` para ela; overrides individuais não liberam).
// Esta checagem é só UX: a garantia real é is_admin() na RLS e em cada RPC.
// Use dentro de <RequireAuth>, que já trata sessão carregando/ausente.
export default function SomenteAdmin({ children }) {
  const { perfilUsuario } = useAuth();
  if (!isAdmin(perfilUsuario)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', textAlign: 'center', padding: '20px' }}>
        <h1 style={{ color: '#8B4513' }}>Acesso negado</h1>
        <p style={{ color: '#666', maxWidth: '420px' }}>
          A Central de Importações do G3 é exclusiva do perfil proprietário/administrador.
        </p>
      </div>
    );
  }
  return children;
}
