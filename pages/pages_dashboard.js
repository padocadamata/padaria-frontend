import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

export default function Dashboard() {
  const router = useRouter();
  const [usuario, setUsuario] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState('inicio');

  useEffect(() => {
    const usuarioLocal = localStorage.getItem('usuario');
    if (!usuarioLocal) {
      router.push('/');
    } else {
      setUsuario(JSON.parse(usuarioLocal));
      carregarDados();
    }
  }, []);

  const carregarDados = async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/dashboard`
      );
      const data = await response.json();
      if (data.success) {
        setStats(data.data);
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('usuario');
    localStorage.removeItem('token');
    router.push('/');
  };

  if (!usuario) return <div>Carregando...</div>;

  return (
    <div style={styles.container}>
      {/* HEADER */}
      <div style={styles.header}>
        <h1 style={styles.titulo}>🍞 Padaria Sistema</h1>
        <div style={styles.userInfo}>
          <span>👋 {usuario.nome}</span>
          <button onClick={handleLogout} style={styles.botaoLogout}>
            Sair
          </button>
        </div>
      </div>

      {/* MENU */}
      <div style={styles.menu}>
        <button
          onClick={() => setAba('inicio')}
          style={{
            ...styles.menuItem,
            backgroundColor: aba === 'inicio' ? '#8B4513' : '#f0f0f0',
            color: aba === 'inicio' ? 'white' : '#333',
          }}
        >
          📊 Dashboard
        </button>
        <button
          onClick={() => setAba('fornecedores')}
          style={{
            ...styles.menuItem,
            backgroundColor: aba === 'fornecedores' ? '#8B4513' : '#f0f0f0',
            color: aba === 'fornecedores' ? 'white' : '#333',
          }}
        >
          📋 Fornecedores
        </button>
        <button
          onClick={() => setAba('producao')}
          style={{
            ...styles.menuItem,
            backgroundColor: aba === 'producao' ? '#8B4513' : '#f0f0f0',
            color: aba === 'producao' ? 'white' : '#333',
          }}
        >
          🥖 Produção
        </button>
      </div>

      {/* CONTEÚDO */}
      <div style={styles.conteudo}>
        {aba === 'inicio' && (
          <div>
            <h2>Bem-vindo ao Dashboard!</h2>
            {loading ? (
              <p>Carregando dados...</p>
            ) : stats ? (
              <div style={styles.cards}>
                <div style={styles.card}>
                  <h3>📦 Fornecedores</h3>
                  <p style={styles.numero}>{stats.total_fornecedores}</p>
                </div>
                <div style={styles.card}>
                  <h3>🛍️ Produtos</h3>
                  <p style={styles.numero}>{stats.total_produtos}</p>
                </div>
                <div style={styles.card}>
                  <h3>🥖 Receitas</h3>
                  <p style={styles.numero}>{stats.total_receitas}</p>
                </div>
                <div style={styles.card}>
                  <h3>📊 Registros Produção</h3>
                  <p style={styles.numero}>{stats.registros_producao}</p>
                </div>
              </div>
            ) : (
              <p>Erro ao carregar dados</p>
            )}
          </div>
        )}

        {aba === 'fornecedores' && (
          <div>
            <h2>Fornecedores</h2>
            <p>Clique para visualizar lista completa de fornecedores.</p>
            <button 
              onClick={() => router.push('/fornecedores')}
              style={styles.botao}
            >
              Ver Fornecedores
            </button>
          </div>
        )}

        {aba === 'producao' && (
          <div>
            <h2>Histórico de Produção</h2>
            <p>Acompanhe o histórico de produção diária.</p>
            <button 
              onClick={() => router.push('/producao')}
              style={styles.botao}
            >
              Ver Produção
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    fontFamily: 'Arial, sans-serif',
  },
  header: {
    backgroundColor: '#8B4513',
    color: 'white',
    padding: '20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titulo: {
    margin: 0,
    fontSize: '24px',
  },
  userInfo: {
    display: 'flex',
    gap: '15px',
    alignItems: 'center',
  },
  botaoLogout: {
    padding: '8px 15px',
    backgroundColor: 'white',
    color: '#8B4513',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  menu: {
    display: 'flex',
    gap: '10px',
    padding: '15px',
    backgroundColor: 'white',
    borderBottom: '1px solid #ddd',
  },
  menuItem: {
    padding: '10px 20px',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  conteudo: {
    padding: '30px',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginTop: '20px',
  },
  card: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '10px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
    textAlign: 'center',
  },
  numero: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#8B4513',
    margin: '10px 0',
  },
  botao: {
    padding: '10px 20px',
    backgroundColor: '#8B4513',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontWeight: 'bold',
    marginTop: '15px',
  },
};
