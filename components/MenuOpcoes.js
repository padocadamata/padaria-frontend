import { useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../hooks/useAuth';
import { MODULOS, hasPermissao } from '../lib/auth/permissoes';

// Itens do menu na ordem em que devem aparecer. Cada um só é renderizado se
// o usuário tiver a permissão correspondente (MODULOS, em lib/auth/permissoes.js)
// — não é mais uma lista de botões fixa. Lembrando: esconder o item do menu
// é só UX; quem protege de verdade é a policy de RLS no banco (o usuário
// não conseguiria carregar dado nenhum mesmo digitando a URL direto).
const ITENS_MENU = ['dashboard', 'perfil', 'aparencia', 'fornecedores', 'producao', 'pedidos', 'usuarios'];

export default function MenuOpcoes({ corPrimaria }) {
  const router = useRouter();
  const { permissoes, signOut } = useAuth();
  const [aberto, setAberto] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickFora = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setAberto(false);
      }
    };

    document.addEventListener('mousedown', handleClickFora);
    return () => document.removeEventListener('mousedown', handleClickFora);
  }, []);

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  const itensVisiveis = ITENS_MENU
    .map((chave) => MODULOS[chave])
    .filter((modulo) => hasPermissao(permissoes, modulo.permissao));

  return (
    <div style={{ position: 'relative' }} ref={menuRef}>
      <button
        onClick={() => setAberto(!aberto)}
        style={{
          padding: '10px 20px',
          backgroundColor: 'white',
          color: corPrimaria,
          border: 'none',
          cursor: 'pointer',
          borderRadius: '5px',
          fontWeight: 'bold',
        }}
      >
        ⚙️ Opções {aberto ? '▲' : '▼'}
      </button>

      {aberto && (
        <div
          style={{
            position: 'absolute',
            top: '45px',
            right: 0,
            backgroundColor: 'white',
            border: `2px solid ${corPrimaria}`,
            borderRadius: '5px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            minWidth: '200px',
          }}
        >
          {itensVisiveis.map((modulo) => (
            <button
              key={modulo.rota}
              onClick={() => {
                router.push(modulo.rota);
                setAberto(false);
              }}
              style={itemEstilo}
              onMouseOver={(e) => (e.target.style.backgroundColor = '#f5f5f5')}
              onMouseOut={(e) => (e.target.style.backgroundColor = 'transparent')}
            >
              {modulo.label}
            </button>
          ))}

          <button
            onClick={handleLogout}
            style={{ ...itemEstilo, color: '#f44336', fontWeight: 'bold', borderBottom: 'none' }}
            onMouseOver={(e) => (e.target.style.backgroundColor = '#ffebee')}
            onMouseOut={(e) => (e.target.style.backgroundColor = 'transparent')}
          >
            🚪 Sair
          </button>
        </div>
      )}
    </div>
  );
}

const itemEstilo = {
  display: 'block',
  width: '100%',
  padding: '12px 20px',
  border: 'none',
  backgroundColor: 'transparent',
  cursor: 'pointer',
  textAlign: 'left',
  fontSize: '16px',
  color: '#333',
  borderBottom: '1px solid #eee',
};
