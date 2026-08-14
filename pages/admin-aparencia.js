import { useState } from 'react';
import { useRouter } from 'next/router';

export default function AdminAparencia() {
  const router = useRouter();
  const [msg, setMsg] = useState('');

  const clickar = () => {
    setMsg('BOTAO CLICADO!');
    localStorage.setItem('aparenciaConfig', JSON.stringify({ corPrimaria: '#1976D2' }));
    window.dispatchEvent(new Event('aparenciaAlterada'));
  };

  return (
    <div style={{ padding: '30px', backgroundColor: '#f0f0f0', minHeight: '100vh' }}>
      <h1>Aparência</h1>
      {msg && <p style={{ color: 'green', fontSize: '18px' }}>{msg}</p>}
      <button 
        onClick={clickar}
        style={{ padding: '15px 30px', fontSize: '18px', cursor: 'pointer', backgroundColor: '#8B4513', color: 'white', border: 'none', borderRadius: '5px' }}
      >
        Aplicar Tema
      </button>
      <button 
        onClick={() => router.push('/dashboard')}
        style={{ padding: '15px 30px', fontSize: '18px', cursor: 'pointer', marginLeft: '10px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px' }}
      >
        Voltar
      </button>
    </div>
  );
}
