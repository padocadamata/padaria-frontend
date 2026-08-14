import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAparencia } from '../hooks/useAparencia';

export default function Producao() {
  const router = useRouter();
  const aparencia = useAparencia();
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const usuario = localStorage.getItem('usuario');
    if (!usuario) {
      router.push('/');
    } else {
      carregarProducao();
    }
  }, []);

  const carregarProducao = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/producao?limit=30`
      );
      const data = await response.json();
      
      if (data.success && data.data) {
        setRegistros(data.data);
      } else if (Array.isArray(data)) {
        setRegistros(data);
      } else {
        setRegistros([]);
      }
    } catch (error) {
      console.error('Erro:', error);
      setRegistros([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ ...styles.container, backgroundColor: aparencia.corFundo }}>
      <div style={{ ...styles.header, backgroundColor: aparencia.corPrimaria }}>
        <div style={styles.headerContent}>
          <h1 style={styles.titulo}>Histórico de Produção</h1>
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
            backgroundColor: aparencia.corPrimaria,
            color: 'white',
          }}
        >
          Produção
        </button>
      </div>

      <div style={styles.conteudo}>
        {loading ? (
          <p>Carregando dados...</p>
        ) : registros.length > 0 ? (
          <div style={styles.tabela}>
            <div style={{ ...styles.linhaHeader, backgroundColor: aparencia.corPrimaria, color: 'white' }}>
              <div style={styles.coluna}>Data</div>
              <div style={styles.coluna}>Produção Manhã</div>
              <div style={styles.coluna}>Produção Tarde</div>
              <div style={styles.coluna}>Total</div>
              <div style={styles.coluna}>Vendas</div>
              <div style={styles.coluna}>Sobra</div>
            </div>
            {registros.map((r, idx) => {
              const data = r.data ? new Date(r.data).toLocaleDateString('pt-BR') : '-';
              const prodManha = r.producao_manha || 0;
              const prodTarde = r.producao_tarde || 0;
              const total = prodManha + prodTarde;
              
              return (
                <div key={idx} style={styles.linha}>
                  <div style={styles.coluna}>{data}</div>
                  <div style={styles.coluna}>{prodManha}</div>
                  <div style={styles.coluna}>{prodTarde}</div>
                  <div style={styles.coluna}>{total}</div>
                  <div style={styles.coluna}>{r.vendas || 0}</div>
                  <div style={styles.coluna}>{r.sobra || 0}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <p>Nenhum registro de produção encontrado</p>
        )}

        <p style={styles.total}>Total: {registros.length} registros</p>
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
  tabela: {
    backgroundColor: 'white',
    borderRadius: '5px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
    overflow: 'hidden',
  },
  linhaHeader: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    fontWeight: 'bold',
    padding: '15px',
  },
  linha: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
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
