import { useState, useEffect } from 'react';

export function useAparencia() {
  const [aparencia, setAparencia] = useState({
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

  useEffect(() => {
    // Carregar aparência ao montar
    carregarAparencia();

    // Listener para quando mudanças acontecem
    const handleAparenciaAlterada = () => {
      console.log('Aparência alterada detectada, recarregando...');
      setTimeout(() => carregarAparencia(), 100);
    };

    window.addEventListener('aparenciaAlterada', handleAparenciaAlterada);
    window.addEventListener('storage', handleAparenciaAlterada);

    return () => {
      window.removeEventListener('aparenciaAlterada', handleAparenciaAlterada);
      window.removeEventListener('storage', handleAparenciaAlterada);
    };
  }, []);

  const carregarAparencia = () => {
    try {
      const config = localStorage.getItem('aparenciaConfig');
      if (config) {
        const aparenciaCarregada = JSON.parse(config);
        setAparencia(aparenciaCarregada);
        console.log('Aparência carregada:', aparenciaCarregada.corPrimaria);
      }
    } catch (error) {
      console.error('Erro ao carregar aparência:', error);
    }
  };

  return aparencia;
}
