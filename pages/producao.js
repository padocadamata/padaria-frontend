import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

export default function Producao() {
  const router = useRouter();
  const [producoes, setProducoes] = useState([]);

  useEffect(() => {
    fetch('https://padaria-api-5l4u.onrender.com/producao')
      .then(res => res.json())
      .then(data => setProducoes(data))
      .catch(err => console.error('Erro ao carregar produção:', err));
  }, []);

  return (
    <div style={{ padding: '20px', backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      <h1>Produção</h1>
      <button onClick={() => router.push('/dashboard')} style={{ padding: '10px 20px', marginBottom: '20px', cursor: 'pointer' }}>
        Voltar
      </button>
      
      <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px' }}>
        {producoes.length === 0 ? (
          <p>Nenhum registro de produção ainda.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '10px', textAlign: 'left' }}>ID</th>
                <th style={{ padding: '10px', textAlign: 'left' }}>Data</th>
                <th style={{ padding: '10px', textAlign: 'left' }}>Descrição</th>
              </tr>
            </thead>
            <tbody>
              {producoes.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
                  <td style={{ padding: '10px' }}>{p.id}</td>
                  <td style={{ padding: '10px' }}>{p.data}</td>
                  <td style={{ padding: '10px' }}>{p.descricao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
