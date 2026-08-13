import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

export default function Fornecedores() {
  const router = useRouter();
  const [fornecedores, setFornecedores] = useState([]);
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
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/fornecedores`
      );
      const data = await response.json();
      if (data.success) {
        setFornecedores(data.data);
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
        <h1 style={styles.titulo}>📋 Fornecedores</h1>
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
                <th>Nome</th>
                <th>CNPJ</th>
                <th>Telefone</th>
                <th>Forma de Pagamento</th>
              </tr>
            </thead>
            <tbody>
              {fornecedores.map((f) => (
                <tr key={f.id}>
                  <td>{f.nome}</td>
                  <td>{f.cnpj}</td>
                  <td>{f.telefone || '-'}</td>
                  <td>{f.forma_pagamento || '-'}</td>
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
