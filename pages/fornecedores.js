import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

export default function Fornecedores() {
  const router = useRouter();
  const [fornecedores, setFornecedores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');

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
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/fornecedores`
      );
      const data = await response.json();
      if (data.success) {
        setFornecedores(data.data || []);
      }
    } catch (error) {
      console.error('Erro ao carregar:', error);
    } finally {
      setLoading(false);
    }
  };

  const filtrados = fornecedores.filter(f =>
    f.nome.toLowerCase().includes(busca.toLowerCase()) ||
    f.cnpj.includes(busca)
  );

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.titulo}>Fornecedores</h1>
        <button onClick={() => router.push('/dashboard')} style={styles.botaoVoltar}>
          Voltar
        </button>
      </div>

      <div style={styles.conteudo}>
        <div style={styles.barra}>
          <input
            type="text"
            placeholder="Buscar por nome ou CNPJ..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={styles.input}
          />
        </div>

        {loading ? (
          <p>Carregando...</p>
        ) : filtrados.length > 0 ? (
          <div style={styles.tabela}>
            <div style={styles.linhaHeader}>
              <div style={styles.coluna}>Nome</div>
              <div style={styles.coluna}>CNPJ</div>
              <div style={styles.coluna}>Telefone</div>
              <div style={styles.coluna}>Forma de Pagamento</div>
            </div>
            {filtrados.map((f) => (
              <div key={f.id} style={styles.linha}>
                <div style={styles.coluna}>{f.nome}</div>
                <div style={styles.coluna}>{f.cnpj}</div>
                <div style={styles.coluna}>{f.telefone}</div>
                <div style={styles.coluna}>{f.forma_pagamento}</div>
              </div>
            ))}
          </div>
        ) : (
          <p>Nenhum fornecedor encontrado</p>
        )}

        <p style={styles.total}>Total: {filtrados.length} fornecedores</p>
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
  barra: {
    marginBottom: '20px',
  },
  input: {
    width: '100%',
    maxWidth: '400px',
    padding: '10px',
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
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    backgroundColor: '#8B4513',
    color: 'white',
    fontWeight: 'bold',
    padding: '15px',
  },
  linha: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
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
