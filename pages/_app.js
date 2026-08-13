import { useEffect } from 'react';

function MyApp({ Component, pageProps }) {
  useEffect(() => {
    // Carregar e aplicar configurações de aparência ao iniciar
    aplicarAparenciaSalva();

    // Ouvir mudanças de aparência (quando user salvar em outra aba)
    window.addEventListener('storage', aplicarAparenciaSalva);
    
    return () => {
      window.removeEventListener('storage', aplicarAparenciaSalva);
    };
  }, []);

  const aplicarAparenciaSalva = () => {
    const configSalva = localStorage.getItem('aparenciaConfig');
    if (configSalva) {
      try {
        const config = JSON.parse(configSalva);
        aplicarTemasGlobal(config);
      } catch (error) {
        console.error('Erro ao carregar aparência:', error);
      }
    }
  };

  const aplicarTemasGlobal = (config) => {
    const root = document.documentElement;
    root.style.setProperty('--cor-primaria', config.corPrimaria || '#8B4513');
    root.style.setProperty('--cor-secundaria', config.corSecundaria || '#D2691E');
    root.style.setProperty('--cor-sucesso', config.corSucesso || '#4CAF50');
    root.style.setProperty('--cor-erro', config.corErro || '#f44336');
    root.style.setProperty('--cor-fundo', config.corFundo || '#f5f5f5');
    root.style.setProperty('--cor-texto', config.corTexto || '#333');
    root.style.setProperty('--fonte', config.fonte || 'Arial');
    root.style.setProperty('--tamanho-titulo', `${config.tamanhoTitulo || 28}px`);
    root.style.setProperty('--tamanho-corp', `${config.tamanhoCorp || 14}px`);
    
    // Aplicar logo se existir
    if (config.logoBase64) {
      const logo = document.getElementById('logo-empresa');
      if (logo) {
        logo.src = config.logoBase64;
      }
    }
  };

  return <Component {...pageProps} />;
}

export default MyApp;
