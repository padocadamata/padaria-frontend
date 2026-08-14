import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

export default function Producao() {
  const router = useRouter();
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

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
      setErro('');
      console.log('Buscando produção...');
      
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/producao?limit=30`
      );
      
      console.log('Status:', response.status);
      
      const data = await response.json();
      console.log('Dados recebidos:', data);
      
      if (data.success && data.data) {
        setRegistros(data.data);
      } else if (Array.isArray(data)) {
        // Se a resposta for diretamente um array
        setRegistros(data);
      } else {
        setErro('Nenhum dado de produção disponível');
        setRegistros([]);
      }
    } catch (error) {
      console.error('Erro ao carregar:', error);
      setErro('Erro ao carregar dados de produção');
      setRegistros([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.titulo}>Histórico de Produção</h1>
        <button onClick={() => router.push('/dashboard')} style={styles.botaoVoltar}>
          Voltar
        </button>
      </div>

      <div style={styles.conteudo}>
        {erro && <div style={styles.msgErro}>{erro}</div>}
        
        {loading ? (
          <p>Carregando dados...</p>
        ) : registros.length > 0 ? (
          <div style={styles.tabela}>
            <div style={styles.linhaHeader}>
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
  conteudo: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '30px 20px',
  },
  msgErro: {
    backgroundColor: '#f44336',
    color: 'white',
    padding: '15px',
    borderRadius: '5px',
    marginBottom: '20px',
    textAlign: 'center',
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
    backgroundColor: '#8B4513',
    color: 'white',
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
