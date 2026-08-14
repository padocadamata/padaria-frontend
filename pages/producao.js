import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import MenuOpcoes from '../components/MenuOpcoes';

export default function Producao() {
  const router = useRouter();
  const [abaAtiva, setAbaAtiva] = useState('vendas');
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
    return () => window.removeEventListener('aparenciaAlterada', handleAparenciaAlterada);
  }, []);

  const abas = [
    { id: 'vendas', nome: '📊 Vendas e Sobras', icone: '📊' },
    { id: 'fluxo', nome: '📦 Fluxo de Mercadorias', icone: '📦' },
    { id: 'estoque', nome: '🧊 Controle de Estoque', icone: '🧊' },
  ];

  return (
    <div style={{ minHeight: '100vh', backgroundColor: aparencia.corFundo }}>
      {/* HEADER */}
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

      {/* NAVEGAÇÃO PRINCIPAL */}
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

        {/* ABAS DE PRODUÇÃO */}
        <div style={{ backgroundColor: 'white', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          {/* HEADERS DAS ABAS */}
          <div style={{ display: 'flex', borderBottom: `2px solid ${aparencia.corPrimaria}` }}>
            {abas.map((aba) => (
              <button
                key={aba.id}
                onClick={() => setAbaAtiva(aba.id)}
                style={{
                  flex: 1,
                  padding: '15px 20px',
                  backgroundColor: abaAtiva === aba.id ? aparencia.corPrimaria : 'white',
                  color: abaAtiva === aba.id ? 'white' : aparencia.corPrimaria,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  transition: 'all 0.3s ease',
                  borderBottom: abaAtiva === aba.id ? `3px solid ${aparencia.corPrimaria}` : 'none',
                }}
                onMouseOver={(e) => {
                  if (abaAtiva !== aba.id) {
                    e.target.style.backgroundColor = '#f9f9f9';
                  }
                }}
                onMouseOut={(e) => {
                  if (abaAtiva !== aba.id) {
                    e.target.style.backgroundColor = 'white';
                  }
                }}
              >
                {aba.nome}
              </button>
            ))}
          </div>

          {/* CONTEÚDO DAS ABAS */}
          <div style={{ padding: '20px' }}>
            {/* ABA: VENDAS E SOBRAS */}
            {abaAtiva === 'vendas' && (
              <div>
                <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>📊 Vendas e Sobras</h2>
                <p style={{ color: '#666', marginBottom: '20px' }}>
                  Registre aqui a quantidade de vendas e sobras do dia.
                </p>
                
                <div style={{
                  backgroundColor: '#f9f9f9',
                  padding: '20px',
                  borderRadius: '5px',
                  border: `2px dashed ${aparencia.corPrimaria}`,
                  textAlign: 'center',
                  color: '#999',
                  minHeight: '300px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                }}>
                  <p style={{ fontSize: '18px', marginBottom: '10px' }}>🏗️ Base de estrutura</p>
                  <p>Campos para Vendas e Sobras serão adicionados aqui</p>
                </div>
              </div>
            )}

            {/* ABA: FLUXO DE MERCADORIAS */}
            {abaAtiva === 'fluxo' && (
              <div>
                <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>📦 Fluxo de Mercadorias</h2>
                <p style={{ color: '#666', marginBottom: '20px' }}>
                  Controle de produtos dos expositores (Entrada e Saída).
                </p>
                
                <div style={{
                  backgroundColor: '#f9f9f9',
                  padding: '20px',
                  borderRadius: '5px',
                  border: `2px dashed ${aparencia.corPrimaria}`,
                  textAlign: 'center',
                  color: '#999',
                  minHeight: '300px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                }}>
                  <p style={{ fontSize: '18px', marginBottom: '10px' }}>🏗️ Base de estrutura</p>
                  <p>Campos para controle de fluxo de mercadorias serão adicionados aqui</p>
                </div>
              </div>
            )}

            {/* ABA: CONTROLE DE ESTOQUE */}
            {abaAtiva === 'estoque' && (
              <div>
                <h2 style={{ color: aparencia.corPrimaria, marginTop: 0 }}>🧊 Controle de Estoque</h2>
                <p style={{ color: '#666', marginBottom: '20px' }}>
                  Controle de sacos congelados dos fornecedores (Entrada e Saída).
                </p>
                
                <div style={{
                  backgroundColor: '#f9f9f9',
                  padding: '20px',
                  borderRadius: '5px',
                  border: `2px dashed ${aparencia.corPrimaria}`,
                  textAlign: 'center',
                  color: '#999',
                  minHeight: '300px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                }}>
                  <p style={{ fontSize: '18px', marginBottom: '10px' }}>🏗️ Base de estrutura</p>
                  <p>Campos para controle de estoque serão adicionados aqui</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
