import { useState, useEffect } from 'react';
import MenuOpcoes from '../components/MenuOpcoes';
import RequireAuth from '../components/RequireAuth';
import { PERMISSOES } from '../lib/auth/permissoes';

function AdminAparenciaConteudo() {

  const [config, setConfig] = useState({
    corPrimaria: '#8B4513',
    corSecundaria: '#D2691E',
    corSucesso: '#4CAF50',
    corErro: '#f44336',
    corFundo: '#f5f5f5',
    corTexto: '#333',
    nomeEmpresa: 'Padaria Sistema',
    logoBase64: null,
  });

  const [tema, setTema] = useState('padrao');
  const [status, setStatus] = useState('');

  useEffect(() => {
    carregarConfiguracao();
  }, []);

  const carregarConfiguracao = () => {
    try {
      const configSalva = localStorage.getItem('aparenciaConfig');
      if (configSalva) {
        const aparencia = JSON.parse(configSalva);
        setConfig(aparencia);
      }
    } catch (error) {
      console.error('Erro ao carregar:', error);
    }
  };

  const aplicarTema = (nomeTema) => {
    setTema(nomeTema);
    const temas = {
      padrao: {
        corPrimaria: '#8B4513',
        corSecundaria: '#D2691E',
        corSucesso: '#4CAF50',
        corErro: '#f44336',
        corFundo: '#f5f5f5',
        corTexto: '#333',
      },
      moderno: {
        corPrimaria: '#1976D2',
        corSecundaria: '#42A5F5',
        corSucesso: '#66BB6A',
        corErro: '#EF5350',
        corFundo: '#FAFAFA',
        corTexto: '#212121',
      },
      corporativo: {
        corPrimaria: '#000000',
        corSecundaria: '#424242',
        corSucesso: '#2E7D32',
        corErro: '#C62828',
        corFundo: '#FFFFFF',
        corTexto: '#000000',
      },
      claro: {
        corPrimaria: '#7E57C2',
        corSecundaria: '#AB47BC',
        corSucesso: '#43A047',
        corErro: '#E53935',
        corFundo: '#F5F5F5',
        corTexto: '#212121',
      },
    };
    const novaConfig = { ...config, ...temas[nomeTema] };
    setConfig(novaConfig);
  };

  const handleChange = (campo, valor) => {
    setConfig({ ...config, [campo]: valor });
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setConfig({ ...config, logoBase64: event.target.result });
      };
      reader.readAsDataURL(file);
    }
  };

  const aplicarConfiguracao = () => {
    try {
      localStorage.setItem('aparenciaConfig', JSON.stringify(config));
      window.dispatchEvent(new Event('aparenciaAlterada'));
      setStatus('Tema aplicado! Volte para Dashboard para ver as mudanças.');
      setTimeout(() => setStatus(''), 3000);
    } catch (error) {
      console.error('Erro ao aplicar:', error);
      setStatus('Erro ao aplicar tema');
    }
  };

  const salvarConfiguracao = () => {
    try {
      localStorage.setItem('aparenciaConfig', JSON.stringify(config));
      setStatus('Configurações salvas com sucesso!');
      setTimeout(() => setStatus(''), 3000);
    } catch (error) {
      console.error('Erro ao salvar:', error);
      setStatus('Erro ao salvar');
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: config.corFundo }}>
      <div style={{ backgroundColor: config.corPrimaria, color: 'white', padding: '20px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>Configuração de Aparência</h1>
          <MenuOpcoes corPrimaria={config.corPrimaria} />
        </div>
      </div>

      <div style={{ maxWidth: '1000px', margin: '20px auto', padding: '20px' }}>
        {status && (
          <div style={{ backgroundColor: '#4CAF50', color: 'white', padding: '15px', borderRadius: '5px', marginBottom: '20px', textAlign: 'center', fontWeight: 'bold' }}>
            {status}
          </div>
        )}

        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', marginBottom: '20px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
          <h2>Temas Pré-definidos</h2>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {['padrao', 'moderno', 'corporativo', 'claro'].map((t) => (
              <button
                key={t}
                onClick={() => aplicarTema(t)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: tema === t ? config.corPrimaria : '#ddd',
                  color: tema === t ? 'white' : '#333',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', marginBottom: '20px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
          <h2>Cores</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
            {[
              { label: 'Cor Primária', campo: 'corPrimaria' },
              { label: 'Cor Secundária', campo: 'corSecundaria' },
              { label: 'Cor Sucesso', campo: 'corSucesso' },
              { label: 'Cor Erro', campo: 'corErro' },
              { label: 'Cor Fundo', campo: 'corFundo' },
              { label: 'Cor Texto', campo: 'corTexto' },
            ].map((item) => (
              <div key={item.campo}>
                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>{item.label}</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    type="color"
                    value={config[item.campo]}
                    onChange={(e) => handleChange(item.campo, e.target.value)}
                    style={{ width: '50px', height: '40px', border: '1px solid #ddd', borderRadius: '5px', cursor: 'pointer' }}
                  />
                  <input
                    type="text"
                    value={config[item.campo]}
                    onChange={(e) => handleChange(item.campo, e.target.value)}
                    style={{ flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '5px' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '5px', marginBottom: '20px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
          <h2>Branding</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Nome da Empresa</label>
              <input
                type="text"
                value={config.nomeEmpresa}
                onChange={(e) => handleChange('nomeEmpresa', e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Logo da Empresa</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px' }}
              />
              {config.logoBase64 && (
                <img src={config.logoBase64} style={{ maxWidth: '150px', maxHeight: '150px', marginTop: '10px', borderRadius: '5px' }} alt="Logo" />
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button 
            onClick={aplicarConfiguracao} 
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
            Aplicar Tema
          </button>
          <button 
            onClick={salvarConfiguracao} 
            style={{
              padding: '14px 35px',
              backgroundColor: config.corSucesso,
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Salvar Configurações
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminAparencia() {
  return (
    <RequireAuth permissao={PERMISSOES.APARENCIA_EDITAR}>
      <AdminAparenciaConteudo />
    </RequireAuth>
  );
}
