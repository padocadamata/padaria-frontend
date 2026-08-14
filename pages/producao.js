import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import MenuOpcoes from '../components/MenuOpcoes';

export default function Producao() {
  const router = useRouter();
  const [producoes, setProducoes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [aparencia, setAparencia] = useState({
    corPrimaria: '#8B4513',
    corFundo: '#f5f5f5',
    nomeEmpresa: 'Padaria Sistema',
    logoBase64: null,
  });

  useEffect(() => {
    const config = localStorage.getItem('aparenciaConfig');
    if (config) {
      try {
        setAparencia(JSON.parse(config));
      } catch (e) {
        console.error('Erro ao carregar aparência:', e);
      }
    }

    const handleAparenciaAlterada = () => {
      const config = localStorage.getItem('aparenciaConfig');
      if (config) {
        try {
          setAparencia(JSON.parse(config));
        } catch (e) {
          console.error('Erro ao carregar aparência:', e);
        }
      }
    };

    window.addEventListener('aparenciaAlterada', handleAparenciaAlterada);

    fetch('https://padaria-api-5l4u.onrender.com/producao')
      .then(res => res.json())
      .then(data => {
        console.log('Produção carregada:', data);
        setProducoes(Array.isArray(data) ? data : []);
        setCarregando(false);
      })
      .catch(err => {
        console.error('Erro ao carregar produção:', err);
        setCarregando(false);
      });

    return () => window.removeEventListener('aparenciaAlterada', handleAparenciaAlterada);
  }, []);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      <div style={{ backgroundColor: aparencia.corPrimaria, color: 'white', padding: '20px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {aparencia.logoBase64 && (
              <img 
                src={aparencia.logoBase64} 
                style={{ height: '50px', maxWidth: '150px', borderRadius: '5px' }}
                alt="Logo"
              />
            )}
            <h1 style={{ margin: 0 }}>{aparencia.nomeEmpresa || 'Padaria Sistema'}</h1>
          </div>
          <MenuOpcoes corPrimaria={aparencia.corPrimaria} />
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '30px', flexWrap: 'wrap' }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{ padding: '10px 20px', backgroundColor: 'white', color: aparencia.corPrimaria, border: '1px solid ' + aparencia.corPrimaria, cursor: 'pointer', borderRadius: '5px' }}
          >
            Dashboard
          </button>
          <button
            onClick={() => router.push('/fornecedores')}
            style={{ padding: '10px 20px', backgroundColor: 'white', color: aparencia.corPrimaria, border: '1px solid ' + aparencia.corPrimaria, cursor: 'pointer', borderRadius: '5px' }}
          >
            Fornecedores
          </button>
          <button
            onClick={() => router.push('/producao')}
            style={{ padding: '10px 20px', backgroundColor: aparencia.corPrimaria, color: 'white', border: 'none', cursor: 'pointer', borderRadius: '5px' }}
          >
            Produção
          </button>
        </div>

        <h2 style={{ color: aparencia.corPrimaria }}>Registros de Produção</h2>

        {carregando ? (
          <p>Carregando registros de produção...</p>
        ) : producoes.length === 0 ? (
          <p>Nenhum registro de produção encontrado.</p>
        ) : (
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold' }}>Data</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold' }}>Produto</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold' }}>Quantidade</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: aparencia.corPrimaria, fontWeight: 'bold' }}>Descrição</th>
                </tr>
              </thead>
              <tbody>
                {producoes.map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
                    <td style={{ padding: '12px' }}>{p.data || '-'}</td>
                    <td style={{ padding: '12px' }}>{p.produto || '-'}</td>
                    <td style={{ padding: '12px' }}>{p.quantidade || '-'}</td>
                    <td style={{ padding: '12px' }}>{p.descricao || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ marginTop: '15px', color: '#666', fontSize: '14px' }}>
              Total de registros: <strong>{producoes.length}</strong>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
