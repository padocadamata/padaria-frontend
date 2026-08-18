import { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErro('');

    const resultado = await signIn(email, senha);

    if (resultado.sucesso) {
      router.push('/dashboard');
    } else {
      setErro(
        resultado.erro === 'Invalid login credentials'
          ? 'Email ou senha incorretos.'
          : 'Não foi possível entrar. Tente novamente em instantes.'
      );
    }

    setLoading(false);
  };

  return (
    <div style={styles.container}>
      <div style={styles.formulario}>
        <h1 style={styles.titulo}>Padaria Sistema</h1>
        <p style={styles.subtitulo}>Faça login para continuar</p>

        {erro && <div style={styles.erro}>{erro}</div>}

        <form onSubmit={handleLogin}>
          <div style={styles.grupo}>
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              autoComplete="username"
              required
            />
          </div>

          <div style={styles.grupo}>
            <label>Senha</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              style={styles.input}
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            style={{ ...styles.botao, opacity: loading ? 0.7 : 1 }}
            disabled={loading}
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    fontFamily: 'Arial, sans-serif',
  },
  formulario: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '10px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    width: '100%',
    maxWidth: '400px',
  },
  titulo: {
    margin: '0 0 10px 0',
    fontSize: '28px',
    color: '#8B4513',
    textAlign: 'center',
  },
  subtitulo: {
    margin: '0 0 30px 0',
    color: '#666',
    textAlign: 'center',
  },
  erro: {
    backgroundColor: '#f44336',
    color: 'white',
    padding: '12px',
    borderRadius: '5px',
    marginBottom: '20px',
    textAlign: 'center',
  },
  grupo: {
    marginBottom: '20px',
  },
  input: {
    width: '100%',
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '5px',
    fontSize: '14px',
    boxSizing: 'border-box',
  },
  botao: {
    width: '100%',
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
};
