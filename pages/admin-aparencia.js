import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAparencia } from '../hooks/useAparencia';

export default function AdminAparencia() {
  const router = useRouter();
  const aparenciaAtual = useAparencia();
  
  const [config, setConfig] = useState({
    corPrimaria: '#8B4513',
    corSecundaria: '#D2691E',
    corSucesso: '#4CAF50',
    corErro: '#f44336',
    corFundo: '#f5f5f5',
    corTexto: '#333',
    fonte: 'Arial',
    tamanhoTitulo: '28',
    tamanhoCorp: '14',
    nomeEmpresa: 'Padaria Sistema',
    logoBase64: null,
  });

  const [tema, setTema] = useState('padrao');
  const [preview, setPreview] = useState(false);
  const [aplicado, setAplicado] = useState(false);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    const usuario = localStorage.getItem('usuario');
    if (!usuario) {
      router.push('/');
    } else {
      carregarConfiguracao();
    }
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
    setAplicado(false);
    setSalvo(false);
  };

  const handleChange = (campo, valor) => {
    setConfig({ ...config, [campo]: valor });
    setAplicado(false);
    setSalvo(false);
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setConfig({ ...config, logoBase64: event.target.result });
        setAplicado(false);
        setSalvo(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const aplicarConfiguracao = () => {
    try {
      localStorage.setItem('aparenciaConfig', JSON.stringify(config));
      window.dispatchEvent(new Event('aparenciaAlterada'));
      
      setAplicado(true);
      setTimeout(() => setAplicado(false), 3000);
    } catch (error) {
      console.error('Erro ao aplicar:', error);
    }
  };

  const salvarConfiguracao = () => {
    try {
      localStorage.setItem('aparenciaConfig', JSON.stringify(config));
      setSalvo(true);
      setTimeout(() => setSalvo(false), 3000);
    } catch (error) {
      console.error('Erro ao salvar:', error);
    }
  };

  return (
    <div style={{ ...styles.container, backgroundColor: aparenciaAtual.corFundo }}>
      <div style={{ ...styles.header, backgroundColor: aparenciaAtual.corPrimaria }}>
        <h1 style={styles.titulo}>Configuração de Aparência</h1>
        <button onClick={() => router.push('/dashboard')} style={styles.botaoVoltar}>
          Voltar
        </button>
      </div>

      <div style={styles.conteudo}>
        {aplicado && (
          <div style={{ ...styles.msgSucesso, backgroundColor: '#4CAF50' }}>
            ✅ Tema aplicado nas outras páginas! Volte para ver as mudanças.
          </div>
        )}
        {salvo && (
          <div style={{ ...styles.msgSucesso, backgroundColor: '#4CAF50' }}>
            ✅ Configurações salvas com sucesso!
          </div>
        )}

        <div style={styles.secao}>
          <h2>Temas Pré-definidos</h2>
          <div style={styles.temas}>
            {['padrao', 'moderno', 'corporativo', 'claro'].map((t) => (
              <button
                key={t}
                onClick={() => aplicarTema(t)}
                style={{
                  ...styles.botaoTema,
                  backgroundColor: tema === t ? config.corPrimaria : '#ddd',
                  color: tema === t ? 'white' : '#333',
                }}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.secao}>
          <h2>Cores</h2>
          <div style={styles.grade}>
            {[
              { label: 'Cor Primária', campo: 'corPrimaria' },
              { label: 'Cor Secundária', campo: 'corSecundaria' },
              { label: 'Cor Sucesso', campo: 'corSucesso' },
              { label: 'Cor Erro', campo: 'corErro' },
              { label: 'Cor Fundo', campo: 'corFundo' },
              { label: 'Cor Texto', campo: 'corTexto' },
            ].map((item) => (
              <div key={item.campo} style={styles.grupo}>
                <label>{item.label}</label>
                <div style={styles.inputCor}>
                  <input
                    type="color"
                    value={config[item.campo]}
                    onChange={(e) => handleChange(item.campo, e.target.value)}
                    style={styles.colorInput}
                  />
                  <input
                    type="text"
                    value={config[item.campo]}
                    onChange={(e) => handleChange(item.campo, e.target.value)}
                    style={styles.textInput}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.secao}>
          <h2>Fontes e Tamanhos</h2>
          <div style={styles.grade}>
            <div style={styles.grupo}>
              <label>Tipo de Fonte</label>
              <select
                value={config.fonte}
                onChange={(e) => handleChange('fonte', e.target.value)}
                style={styles.select}
              >
                <option>Arial</option>
                <option>Roboto</option>
                <option>Times New Roman</option>
                <option>Courier New</option>
              </select>
            </div>
            <div style={styles.grupo}>
              <label>Tamanho Título ({config.tamanhoTitulo}px)</label>
              <input
                type="range"
                min="20"
                max="36"
                value={config.tamanhoTitulo}
                onChange={(e) => handleChange('tamanhoTitulo', e.target.value)}
                style={styles.slider}
              />
            </div>
            <div style={styles.grupo}>
              <label>Tamanho Corpo ({config.tamanhoCorp}px)</label>
              <input
                type="range"
                min="12"
                max="18"
                value={config.tamanhoCorp}
                onChange={(e) => handleChange('tamanhoCorp', e.target.value)}
                style={styles.slider}
              />
            </div>
          </div>
        </div>

        <div style={styles.secao}>
          <h2>Branding</h2>
          <div style={styles.grade}>
            <div style={styles.grupo}>
              <label>Nome da Empresa</label>
              <input
                type="text"
                value={config.nomeEmpresa}
                onChange={(e) => handleChange('nomeEmpresa', e.target.value)}
                style={styles.input}
              />
            </div>
            <div style={styles.grupo}>
              <label>Logo da Empresa</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                style={styles.input}
              />
              {config.logoBase64 && (
                <img 
                  src={config.logoBase64} 
                  style={styles.logoPreview}
                  alt="Logo"
                />
              )}
            </div>
          </div>
        </div>

        <div style={styles.secao}>
          <button 
            onClick={() => setPreview(!preview)} 
            style={{
              ...styles.botaoPreview, 
              backgroundColor: config.corPrimaria
            }}
          >
            {preview ? 'Esconder Preview' : 'Ver Preview'}
          </button>
          {preview && (
            <div style={{
              ...styles.preview,
              backgroundColor: config.corFundo,
              color: config.corTexto,
              fontFamily: config.fonte,
            }}>
              <div style={{
                ...styles.previewHeader,
                backgroundColor: config.corPrimaria,
              }}>
                <h1>{config.nomeEmpresa}</h1>
              </div>
              <p>Este é um preview de como seu sistema ficará com as novas cores e fontes.</p>
              <button style={{
                ...styles.previewBotao,
                backgroundColor: config.corSucesso,
              }}>Botão</button>
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button 
            onClick={aplicarConfiguracao} 
            style={{
              ...styles.botaoAplicar,
              backgroundColor: config.corPrimaria,
            }}
          >
            🎨 Aplicar Tema
          </button>
          <button 
            onClick={salvarConfiguracao} 
            style={{
              ...styles.botaoSalvar,
              backgroundColor: config.corSucesso,
            }}
          >
            💾 Salvar Configurações
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    fontFamily: 'Arial, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    color: 'white',
    padding: '20px',
  },
  titulo: {
    margin: 0,
  },
  botaoVoltar: {
    padding: '10px 20px',
    backgroundColor: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  conteudo: {
    maxWidth: '1000px',
    margin: '20px auto',
    padding: '20px',
  },
  msgSucesso: {
    color: 'white',
    padding: '15px',
    borderRadius: '5px',
    marginBottom: '20px',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  secao: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '5px',
    marginBottom: '20px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
  },
  temas: {
    display: 'flex',
    gap: '10px',
    marginTop: '10px',
    flexWrap: 'wrap',
  },
  botaoTema: {
    padding: '10px 20px',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  grade: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginTop: '15px',
  },
  grupo: {
    display: 'flex',
    flexDirection: 'column',
  },
  inputCor: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  colorInput: {
    width: '50px',
    height: '40px',
    border: '1px solid #ddd',
    borderRadius: '5px',
    cursor: 'pointer',
  },
  textInput: {
    flex: 1,
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '5px',
  },
  select: {
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '5px',
  },
  slider: {
    width: '100%',
  },
  input: {
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '5px',
  },
  logoPreview: {
    maxWidth: '150px',
    maxHeight: '150px',
    marginTop: '10px',
    borderRadius: '5px',
  },
  preview: {
    padding: '20px',
    borderRadius: '5px',
    marginTop: '15px',
    border: '2px solid #ddd',
  },
  previewHeader: {
    color: 'white',
    padding: '15px',
    borderRadius: '5px',
    marginBottom: '10px',
  },
  previewBotao: {
    color: 'white',
    padding: '10px 20px',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    marginTop: '10px',
  },
  botaoPreview: {
    padding: '10px 20px',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
  },
  footer: {
    display: 'flex',
    gap: '15px',
    justifyContent: 'center',
    marginTop: '30px',
    flexWrap: 'wrap',
  },
  botaoAplicar: {
    padding: '14px 35px',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  botaoSalvar: {
    padding: '14px 35px',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
};
