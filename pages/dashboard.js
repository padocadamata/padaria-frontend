import { useRouter } from 'next/router';
import { useAparencia } from '../hooks/useAparencia';

export default function Dashboard() {
  const router = useRouter();
  const aparencia = useAparencia();

  const handleLogout = () => {
    localStorage.removeItem('usuario');
    localStorage.removeItem('token');
    router.push('/');
  };

  return (
    <div style={{ ...styles.container, backgroundColor: aparencia.corFundo }}>
      <div style={{ ...styles.header, backgroundColor: aparencia.corPrimaria }}>
        <div style={styles.headerContent}>
          <h1 style={styles.titulo}>{aparencia.nomeEmpresa || 'Padaria Sistema'}</h1>
          <div style={styles.userSection}>
            <span style={styles.userName}>Gerente Padoca</span>
            <button
              onClick={() => router.push('/admin-aparencia')}
              style={{ ...styles.botaoOpcoes, backgroundColor: 'white', color: aparencia.corPrimaria }}
            >
              Opções
            </button>
          </div>
        </div>
      </div>

      <div style={styles.navBar}>
        <button
          onClick={() => router.push('/dashboard')}
          style={{
            ...styles.navBotao,
            backgroundColor: aparencia.corPrimaria,
            color: 'white',
          }}
        >
          Dashboard
        </button>
        <button
          onClick={() => router.push('/fornecedores')}
          style={{
            ...styles.navBotao,
            backgroundColor: 'white',
            color: aparencia.corPrimaria,
          }}
        >
          Fornecedores
        </button>
        <button
          onClick={() => router.push('/producao')}
          style={{
            ...styles.navBotao,
            backgroundColor: 'white',
            color: aparencia.corPrimaria,
          }}
        >
          Produção
        </button>
      </div>

      <div style={styles.conteudo}>
        <h2 style={{ color: aparencia.corPrimaria }}>Bem-vindo ao Dashboard</h2>

        <div style={styles.cards}>
          <div style={{ ...styles.card, borderTopColor: aparencia.corPrimaria }}>
            <h3>Fornecedores</h3>
            <p style={{ color: aparencia.corPrimaria, fontSize: '32px' }}>28</p>
          </div>
          <div style={{ ...styles.card, borderTopColor: aparencia.corPrimaria }}>
            <h3>Produtos</h3>
            <p style={{ color: aparencia.corPrimaria, fontSize: '32px' }}>390</p>
          </div>
          <div style={{ ...styles.card, borderTopColor: aparencia.corPrimaria }}>
            <h3>Receitas</h3>
            <p style={{ color: aparencia.corPrimaria, fontSize: '32px' }}>45</p>
          </div>
          <div style={{ ...styles.card, borderTopColor: aparencia.corPrimaria }}>
            <h3>Registros de Produção</h3>
            <p style={{ color: aparencia.corPrimaria, fontSize: '32px' }}>0</p>
          </div>
        </div>

        <div style={{ marginTop: '30px', textAlign: 'center' }}>
          <button
            onClick={handleLogout}
            style={{
              ...styles.botaoSair,
              backgroundColor: aparencia.corErro,
            }}
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    fontFamily: 'Arial, sans-serif',
  },
  header: {
    color: 'white',
    padding: '20px',
  },
  headerContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  titulo: {
    margin: 0,
    fontSize: '28px',
  },
  userSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  userName: {
    color: 'white',
  },
  botaoOpcoes: {
    padding: '8px 15px',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  navBar: {
    display: 'flex',
    gap: '0',
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '0 20px',
    borderBottom: '1px solid #ddd',
  },
  navBotao: {
    padding: '12px 20px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  conteudo: {
    maxWidth: '1200px',
    margin: '30px auto',
    padding: '0 20px',
  },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginTop: '20px',
  },
  card: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '5px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
    borderTop: '4px solid',
  },
  botaoSair: {
    padding: '12px 30px',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 'bold',
  },
};
