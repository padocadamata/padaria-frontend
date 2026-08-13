import { useState } from 'react';
import { useRouter } from 'next/router';

export default function Login() {
  const [email, setEmail] = useState('gerente@padoca.com.br');
  const [senha, setSenha] = useState('senha123');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    setCarregando(true);
    setErro('');

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha }),
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('usuario', JSON.stringify(data.usuario));
        localStorage.setItem('token', data.token);
        router.push('/dashboard');
      } else {
        setErro(data.mensagem || 'Erro ao fazer login');
      }
    } catch (error) {
      setErro('Erro de conexão. Tente novamente.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.titulo}>🍞 Padaria Sistema</h1>
        <p style={styles.subtitulo}>Sistema de Gestão</p>

        <form onSubmit={handleLogin} style={styles.form}>
          <div style={styles.grupo}>
            <label style={styles.label}>Email:</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              disabled={carregando}
            />
          </div>

          <div style={styles.grupo}>
            <label style={styles.label}>Senha:</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              style={styles.input}
              disabled={carregando}
            />
          </div>

          {erro && <p style={styles.erro}>❌ {erro}</p>}

          <button 
            type="submit" 
            style={styles.botao}
            disabled={carregando}
          >
            {carregando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p style={styles.dica}>
          Email: gerente@padoca.com.br<br/>
          Senha: senha123
        </p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    fontFamily: 'Arial, sans-serif',
  },
  card: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '10px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    width: '100%',
    maxWidth: '400px',
  },
  titulo: {
    margin: '0 0 10px 0',
    color: '#8B4513',
    textAlign: 'center',
    fontSize: '28px',
  },
  subtitulo: {
    margin: '0 0 30px 0',
    color: '#666',
    textAlign: 'center',
    fontSize: '14px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  grupo: {
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    marginBottom: '5px',
    fontWeight: 'bold',
    color: '#333',
  },
  input: {
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '5px',
    fontSize: '14px',
    fontFamily: 'Arial',
  },
  botao: {
    padding: '12px',
    backgroundColor: '#8B4513',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '10px',
  },
  erro: {
    color: '#d32f2f',
    fontSize: '14px',
    margin: '10px 0',
  },
  dica: {
    fontSize: '12px',
    color: '#999',
    marginTop: '20px',
    textAlign: 'center',
    lineHeight: '1.6',
  },
};
