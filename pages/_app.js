import { useEffect } from 'react';
import '../styles/globals.css';

function MyApp({ Component, pageProps }) {
  useEffect(() => {
    // Aplicar aparência ao carregar a página
    aplicarAparencia();

    // Ouvir mudanças de aparência em tempo real
    window.addEventListener('storage', aplicarAparencia);
    
    // Verificar a cada 500ms se houve mudança (fallback)
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
        
        // Aplicar cores via CSS Variables
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
        
        // Aplicar logo se existir
        if (aparencia.logoBase64) {
          const logos = document.querySelectorAll('[data-logo-empresa]');
          logos.forEach(logo => {
            logo.src = aparencia.logoBase64;
          });
        }
        
        // Aplicar nome da empresa
        if (aparencia.nomeEmpresa) {
          const nomes = document.querySelectorAll('[data-nome-empresa]');
          nomes.forEach(nome => {
            nome.textContent = aparencia.nomeEmpresa;
          });
        }
      }
    } catch (error) {
      console.error('Erro ao aplicar aparência:', error);
    }
  };

  return <Component {...pageProps} />;
}

export default MyApp;
