import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

export default function Producao() {
  const router = useRouter();
  const [producao, setProducao] = useState([]);
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
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/producao`
      );
      const data = await response.json();
      if (data.success) {
        setProducao(data.data);
      }
    } catch (error) {
      console.error('Erro:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.titulo}>🥖 Histórico de Produção</h1>
        <button onClick={() => router.push('/dashboard')} style={styles.botaoVoltar}>
          ← Voltar
        </button>
      </div>

      {loading ? (
        <p>Carregando...</p>
      ) : (
        <div style={styles.tabela}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Produção Manhã</th>
                <th>Produção Tarde</th>
                <th>Total Produzido</th>
                <th>Vendas</th>
                <th>Sobra</th>
              </tr>
            </thead>
            <tbody>
              {producao.slice(0, 30).map((p) => (
                <tr key={p.id}>
                  <td>{new Date(p.data).toLocaleDateString('pt-BR')}</td>
                  <td>{p.producao_manha}</td>
                  <td>{p.producao_tarde}</td>
                  <td><strong>{p.producao_total}</strong></td>
                  <td>{p.vendas_total}</td>
                  <td>{p.sobra_total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    fontFamily: 'Arial, sans-serif',
    padding: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#8B4513',
    color: 'white',
    padding: '20px',
    borderRadius: '5px',
    marginBottom: '20px',
  },
  titulo: {
    margin: 0,
  },
  botaoVoltar: {
    padding: '10px 20px',
    backgroundColor: 'white',
    color: '#8B4513',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  tabela: {
    backgroundColor: 'white',
    borderRadius: '5px',
    padding: '20px',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
};
