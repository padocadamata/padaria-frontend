import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../hooks/useAuth';
import { hasPermissao } from '../lib/auth/permissoes';

// Protege uma página no cliente: não renderiza nada sensível enquanto a
// sessão ainda está sendo verificada, redireciona para o login se não
// houver usuário autenticado, e mostra "Acesso negado" (em vez de
// simplesmente esconder) se o usuário estiver autenticado mas sem a
// permissão exigida.
//
// middleware.js já bloqueia o acesso não autenticado no servidor antes da
// página carregar — este componente é a segunda camada (permissão fina +
// UX), não a única. A proteção que realmente importa para os DADOS é a
// policy de RLS no Supabase: mesmo que alguém burlasse as duas camadas de
// UI, a query ao banco não devolveria nada sem a permissão certa.
export default function RequireAuth({ permissao, children }) {
  const router = useRouter();
  const { carregando, autenticado, perfilUsuario, permissoes } = useAuth();

  useEffect(() => {
    if (!carregando && !autenticado) {
      router.replace('/');
    }
  }, [carregando, autenticado, router]);

  if (carregando) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
        Verificando sessão…
      </div>
    );
  }

  if (!autenticado) {
    return null;
  }

  if (!perfilUsuario || !perfilUsuario.ativo) {
    return (
      <TelaAcessoNegado mensagem="Seu usuário ainda não tem um perfil de acesso configurado, ou está inativo. Fale com um administrador." />
    );
  }

  if (permissao && !hasPermissao(permissoes, permissao)) {
    return <TelaAcessoNegado mensagem="Você não tem permissão para acessar esta página." />;
  }

  return children;
}

function TelaAcessoNegado({ mensagem }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', textAlign: 'center', padding: '20px' }}>
      <h1 style={{ color: '#8B4513' }}>Acesso negado</h1>
      <p style={{ color: '#666', maxWidth: '420px' }}>{mensagem}</p>
    </div>
  );
}
