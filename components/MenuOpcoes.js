import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';

export default function MenuOpcoes({ corPrimaria }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const menuRef = useRef(null);

  // Fecha menu ao clicar fora
  useEffect(() => {
    const handleClickFora = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setAberto(false);
      }
    };

    document.addEventListener('mousedown', handleClickFora);
    return () => document.removeEventListener('mousedown', handleClickFora);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('usuario');
    localStorage.removeItem('token');
    router.push('/');
  };

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
          <button
            onClick={() => {
              router.push('/admin-aparencia');
              setAberto(false);
            }}
            style={{
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
            }}
            onMouseOver={(e) => (e.target.style.backgroundColor = '#f5f5f5')}
            onMouseOut={(e) => (e.target.style.backgroundColor = 'transparent')}
          >
            🎨 Aparência
          </button>

          <button
            onClick={() => {
              router.push('/perfil');
              setAberto(false);
            }}
            style={{
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
            }}
            onMouseOver={(e) => (e.target.style.backgroundColor = '#f5f5f5')}
            onMouseOut={(e) => (e.target.style.backgroundColor = 'transparent')}
          >
            👤 Perfil
          </button>

          <button
            onClick={() => {
              router.push('/preferencias');
              setAberto(false);
            }}
            style={{
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
            }}
            onMouseOver={(e) => (e.target.style.backgroundColor = '#f5f5f5')}
            onMouseOut={(e) => (e.target.style.backgroundColor = 'transparent')}
          >
            ⚡ Preferências
          </button>

          <button
            onClick={handleLogout}
            style={{
              display: 'block',
              width: '100%',
              padding: '12px 20px',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: '16px',
              color: '#f44336',
              fontWeight: 'bold',
            }}
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
