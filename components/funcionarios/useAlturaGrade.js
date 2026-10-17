import { useEffect, useRef, useState } from 'react';
import { calcularAlturaGrade } from '../../lib/funcionarios/escalaAltura';

// Mede a posição REAL do topo da grade no documento (não depende de quantas
// linhas o cabeçalho da visão ocupa naquela largura) e devolve o maxHeight
// para o container da grade. Recalcula ao redimensionar a janela e quando
// algo acima da grade muda de altura (ResizeObserver no body -- o topo não
// depende da altura da própria grade, então não há laço). Antes da 1ª
// medição devolve undefined: vale o max-height do CSS (70vh).
export function useAlturaGrade() {
  const ref = useRef(null);
  const [altura, setAltura] = useState(undefined);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let quadro = 0;
    function medir() {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const topoGrade = el.getBoundingClientRect().top + window.scrollY;
        const nova = calcularAlturaGrade({ alturaJanela: window.innerHeight, topoGrade });
        setAltura((atual) => (atual === nova ? atual : nova));
      });
    }
    medir();
    window.addEventListener('resize', medir);
    const observador = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    if (observador) observador.observe(document.body);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('resize', medir);
      if (observador) observador.disconnect();
    };
  }, []);

  return { ref, estilo: altura ? { maxHeight: `${altura}px` } : undefined };
}
