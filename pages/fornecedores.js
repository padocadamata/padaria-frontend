import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAparencia } from '../hooks/useAparencia';

export default function Fornecedores() {
  const router = useRouter();
  const aparencia = useAparencia();
  const [fornecedores, setFornecedores] = useState([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const usuario = localStorage.getItem('usuario');
    if (!usuario) {
      router.push('/');
    } else {
      carregarFornecedores();
    }
  }, []);

  const carregarFornecedores = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/fornecedores?limit=100`
      );
      const data = await response.json();
      
      if (data.success && data.data) {
        setFornecedores(data.data);
      } else if (Array.isArray(data)) {
        setFornecedores(data);
      } else {
        setFornecedores([]);
      }
    } catch (error) {
      console.error('Erro:', error);
      setFornecedores([]);
    } finally {
      setLoading(false);
    }
  };

  const fornecedoresFiltrados = fornecedores.filter(f =>
    f.nome?.toLowerCase().includes(busca.toLowerCase()) ||
    f.cnpj?.toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <div style={{ ...styles.container, backgroundColor: aparencia.corFundo }}>
      <div style={{ ...styles.header, backgroundColor: aparencia.corPrimaria }}>
        <div style={styles.headerContent}>
          <h1 style={styles.titulo}>Fornecedores</h1>
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
            backgroundColor: 'white',
            color: aparencia.corPrimaria,
          }}
        >
          Dashboard
        </button>
        <button
          onClick={() => router.push('/fornecedores')}
          style={{
            ...styles.navBotao,
            backgroundColor: aparencia.corPrimaria,
            color: 'white',
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
        <div style={styles.busca}>
          <input
            type="text"
            placeholder="Buscar por nome ou CNPJ..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={styles.inputBusca}
          />
        </div>

        {loading ? (
          <p>Carregando fornecedores...</p>
        ) : fornecedoresFiltrados.length > 0 ? (
          <div style={styles.tabela}>
            <div style={{ ...styles.linhaHeader, backgroundColor: aparencia.corPrimaria, color: 'white' }}>
              <div style={styles.coluna}>Nome</div>
              <div style={styles.coluna}>CNPJ</div>
              <div style={styles.coluna}>Contato</div>
              <div style={styles.coluna}>Email</div>
            </div>
            {fornecedoresFiltrados.map((f, idx) => (
              <div key={idx} style={styles.linha}>
                <div style={styles.coluna}>{f.nome}</div>
                <div style={styles.coluna}>{f.cnpj}</div>
                <div style={styles.coluna}>{f.telefone || '-'}</div>
                <div style={styles.coluna}>{f.email || '-'}</div>
              </div>
            ))}
          </div>
        ) : (
          <p>Nenhum fornecedor encontrado</p>
        )}

        <p style={styles.total}>Total: {fornecedoresFiltrados.length} fornecedores</p>
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
  busca: {
    marginBottom: '20px',
  },
  inputBusca: {
    width: '100%',
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '5px',
    fontSize: '14px',
  },
  tabela: {
    backgroundColor: 'white',
    borderRadius: '5px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
    overflow: 'hidden',
  },
  linhaHeader: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    fontWeight: 'bold',
    padding: '15px',
  },
  linha: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    borderBottom: '1px solid #eee',
    padding: '15px',
  },
  coluna: {
    padding: '5px 0',
  },
  total: {
    marginTop: '20px',
    color: '#666',
    textAlign: 'center',
  },
};
