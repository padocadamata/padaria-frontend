import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { AuthProvider } from '../hooks/useAuth';

function MyApp({ Component, pageProps }) {
  const router = useRouter();

  useEffect(() => {
    // Aplicar aparência ao carregar
    aplicarAparencia();

    // Listener para quando mudanças acontecem no localStorage (outra aba)
    const handleStorageChange = () => {
      console.log('Mudança detectada no localStorage, reaplicando aparência...');
      aplicarAparencia();
    };
    window.addEventListener('storage', handleStorageChange);

    // Listener para evento customizado
    const handleAparenciaAlterada = () => {
      console.log('Evento aparenciaAlterada disparado, reaplicando...');
      setTimeout(() => aplicarAparencia(), 100);
    };
    window.addEventListener('aparenciaAlterada', handleAparenciaAlterada);

    // Verificar mudanças a cada 500ms
    const interval = setInterval(() => {
      aplicarAparencia();
    }, 500);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('aparenciaAlterada', handleAparenciaAlterada);
      clearInterval(interval);
    };
  }, []);

  // Reaplicar aparência quando muda de página
  useEffect(() => {
    console.log('Página mudou para:', router.pathname);
    setTimeout(() => aplicarAparencia(), 100);
  }, [router.pathname]);

  const aplicarAparencia = () => {
    try {
      const config = localStorage.getItem('aparenciaConfig');
      if (config) {
        const aparencia = JSON.parse(config);
        console.log('Aplicando aparência:', aparencia.corPrimaria);

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

        // Aplicar colors inline nos elementos existentes
        setTimeout(() => {
          const headers = document.querySelectorAll('[style*="backgroundColor: #8B4513"]');
          headers.forEach(el => {
            el.style.backgroundColor = aparencia.corPrimaria || '#8B4513';
          });
        }, 50);
      }
    } catch (error) {
      console.error('Erro ao aplicar aparência:', error);
    }
  };

  return (
    <AuthProvider>
      <Component {...pageProps} />
    </AuthProvider>
  );
}

export default MyApp;
