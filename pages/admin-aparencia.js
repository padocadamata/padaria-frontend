import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

export default function AdminAparencia() {
  const router = useRouter();
  const [config, setConfig] = useState({
    corPrimaria: '#8B4513',
    corSucesso: '#4CAF50',
  });
  const [status, setStatus] = useState('');

  useEffect(() => {
    console.log('✅ PÁGINA DE APARÊNCIA CARREGADA');
  }, []);

  const aplicarTema = () => {
    console.log('🎨 CLICOU EM APLICAR TEMA');
    setConfig({ ...config, corPrimaria: '#1976D2' });
    localStorage.setItem('aparenciaConfig', JSON.stringify(config));
    window.dispatchEvent(new Event('aparenciaAlterada'));
    setStatus('✅ TEMA APLICADO!');
  };

  return (
    <div style={{ backgroundColor: '#f5f5f5', minHeight: '100vh', padding: '20px' }}>
      <div style={{ backgroundColor: config.corPrimaria, color: 'white', padding: '20px', borderRadius: '5px', marginBottom: '20px' }}>
        <h1>Configuração de Aparência - TESTE</h1>
      </div>

      {status && <div style={{ backgroundColor: '#4CAF50', color: 'white', padding: '15px', marginBottom: '20px', borderRadius: '5px' }}>{status}</div>}

      <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', marginBottom: '20px' }}>
        <h2>Teste de Botão</h2>
        <p>Cor atual: {config.corPrimaria}</p>
        
        <div style={{ display: 'flex', gap: '15px', marginTop: '20px' }}>
          <button 
            onClick={aplicarTema}
            style={{
              padding: '14px 35px',
              backgroundColor: config.corPrimaria,
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            🎨 APLICAR TEMA - CLIQUE AQUI
          </button>
          
          <button 
            onClick={() => router.push('/dashboard')}
            style={{
              padding: '14px 35px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            💾 VOLTAR AO DASHBOARD
          </button>
        </div>
      </div>

      <p style={{ textAlign: 'center', color: '#666', marginTop: '30px' }}>
        💡 Abra o console (F12) para ver os logs
      </p>
    </div>
  );
}
