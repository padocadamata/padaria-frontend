import { useEffect } from 'react';

function MyApp({ Component, pageProps }) {
  useEffect(() => {
    aplicarAparencia();
    window.addEventListener('storage', aplicarAparencia);
    
    const interval = setInterval(aplicarAparencia, 500);
    
    return () => {
      window.removeEventListener('storage', aplicarAparencia);
      clearInterval(interval);
    };
  }, []);

  const aplicarAparencia = () => {
    try {
      const config = localStorage.getItem('aparenciaConfig');
      if (config) {
        const aparencia = JSON.parse(config);
        
        const root = document.documentElement;
        root.style.setProperty('--cor-primaria', aparencia.corPrimaria || '#8B4513');
        root.style.setProperty('--cor-secundaria', aparencia.corSecundaria || '#D2691E');
        root.style.setProperty('--cor-sucesso', aparencia.corSucesso || '#4CAF50');
        root.style.setProperty('--cor-erro', aparencia.corErro || '#f44336');
        root.style.setProperty('--cor-fundo', aparencia.corFundo || '#f5f5f5');
        root.style.setProperty('--cor-texto', aparencia.corTexto || '#333');
        root.style.setProperty('--fonte', aparencia.fonte || 'Arial');
        root.style.setProperty('--tamanho-titulo', `${aparencia.tamanhoTitulo || 28}px`);
        root.style.setProperty('--tamanho-corp', `${aparencia.tamanhoCorp || 14}px`);
      }
    } catch (error) {
      console.error('Erro ao aplicar aparência:', error);
    }
  };

  return <Component {...pageProps} />;
}

export default MyApp;
