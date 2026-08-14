import { useRouter } from 'next/router';

export default function Dashboard() {
  const router = useRouter();

  const handleLogout = () => {
    localStorage.removeItem('usuario');
    localStorage.removeItem('token');
    router.push('/');
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <div style={{ backgroundColor: '#8B4513', color: 'white', padding: '20px' }}>
        <h1 style={{ margin: 0 }}>Padaria Sistema - Dashboard</h1>
      </div>

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{ padding: '10px 20px', backgroundColor: '#8B4513', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '5px' }}
          >
            Dashboard
          </button>
          <button
            onClick={() => router.push('/fornecedores')}
            style={{ padding: '10px 20px', backgroundColor: 'white', color: '#8B4513', border: '1px solid #8B4513', cursor: 'pointer', borderRadius: '5px' }}
          >
            Fornecedores
          </button>
          <button
            onClick={() => router.push('/producao')}
            style={{ padding: '10px 20px', backgroundColor: 'white', color: '#8B4513', border: '1px solid #8B4513', cursor: 'pointer', borderRadius: '5px' }}
          >
            Produção
          </button>
          <button
            onClick={() => router.push('/admin-aparencia')}
            style={{ padding: '10px 20px', backgroundColor: 'white', color: '#8B4513', border: '1px solid #8B4513', cursor: 'pointer', borderRadius: '5px', marginLeft: 'auto' }}
          >
            Opções
          </button>
        </div>

        <h2 style={{ color: '#8B4513' }}>Bem-vindo ao Dashboard</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', borderTop: '4px solid #8B4513' }}>
            <h3>Fornecedores</h3>
            <p style={{ color: '#8B4513', fontSize: '32px' }}>28</p>
          </div>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', borderTop: '4px solid #8B4513' }}>
            <h3>Produtos</h3>
            <p style={{ color: '#8B4513', fontSize: '32px' }}>390</p>
          </div>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', borderTop: '4px solid #8B4513' }}>
            <h3>Receitas</h3>
            <p style={{ color: '#8B4513', fontSize: '32px' }}>45</p>
          </div>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', borderTop: '4px solid #8B4513' }}>
            <h3>Registros de Produção</h3>
            <p style={{ color: '#8B4513', fontSize: '32px' }}>0</p>
          </div>
        </div>

        <div style={{ marginTop: '30px', textAlign: 'center' }}>
          <button
            onClick={handleLogout}
            style={{ padding: '12px 30px', backgroundColor: '#f44336', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '5px', fontSize: '16px' }}
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}
