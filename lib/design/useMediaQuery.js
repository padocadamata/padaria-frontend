import { useEffect, useState } from 'react';

// true enquanto a media query casa. O valor inicial já vem do matchMedia
// (nas telas migradas o conteúdo só renderiza depois do carregamento da
// sessão, ou seja, sempre no cliente -- sem risco de divergência de SSR),
// evitando um primeiro quadro "errado" ao alternar tabela <-> cartões.
export function useMediaQuery(query) {
  const [casa, setCasa] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const consulta = window.matchMedia(query);
    const atualizar = () => setCasa(consulta.matches);
    atualizar();
    if (consulta.addEventListener) consulta.addEventListener('change', atualizar);
    else consulta.addListener(atualizar);
    return () => {
      if (consulta.removeEventListener) consulta.removeEventListener('change', atualizar);
      else consulta.removeListener(atualizar);
    };
  }, [query]);

  return casa;
}
