import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';

// Proteção contra perder alterações não salvas do Cartão-Ponto -- vale para
// TODA saída da tela:
//   * links internos e menu: clique interceptado ANTES do Next (fase de
//     captura) -- cancelar não gera erro nenhum;
//   * navegação feita pelo código (ex.: trocar competência): quem navega
//     chama confirmarSaida() antes;
//   * voltar/avançar do navegador: beforePopState;
//   * fechar/recarregar a aba: beforeunload;
//   * qualquer outra rota: routeChangeStart (último recurso -- o Next só
//     aborta lançando um erro).
// Cancelar mantém o usuário na tela com o rascunho intacto.
const MENSAGEM = 'Há alterações não salvas neste cartão. Sair e descartá-las?';

export function useProtecaoAlteracoes(ativo) {
  const router = useRouter();
  const ativoRef = useRef(ativo);
  ativoRef.current = ativo;
  const liberadoRef = useRef(false);

  // true = pode sair (sem alterações, ou o usuário confirmou).
  const confirmarSaida = useCallback(() => {
    if (!ativoRef.current || liberadoRef.current) return true;
    if (!window.confirm(MENSAGEM)) return false;
    liberadoRef.current = true;
    return true;
  }, []);

  useEffect(() => {
    if (!ativo) liberadoRef.current = false;
  }, [ativo]);

  useEffect(() => {
    let ignorarProximoPop = false;

    const antesDeSair = (evento) => {
      if (!ativoRef.current || liberadoRef.current) return;
      evento.preventDefault();
      evento.returnValue = '';
    };

    const cliqueEmLink = (evento) => {
      if (!ativoRef.current || liberadoRef.current) return;
      if (evento.defaultPrevented || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
      const link = evento.target.closest?.('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const destino = new URL(link.href, window.location.href);
      if (destino.origin !== window.location.origin) return; // saída do site: beforeunload cuida
      if (destino.pathname === window.location.pathname && destino.search === window.location.search) return;
      if (confirmarSaida()) return;
      evento.preventDefault();
      evento.stopPropagation();
    };

    const mudancaDeRota = () => {
      if (!ativoRef.current || liberadoRef.current) return;
      if (confirmarSaida()) return;
      router.events.emit('routeChangeError');
      // eslint-disable-next-line no-throw-literal
      throw 'Navegação cancelada: alterações não salvas no Cartão-Ponto.';
    };

    // Voltar/avançar: o navegador já trocou a URL quando o Next é avisado.
    // Cancelado -> devolve a URL (history.go(1)) e ignora esse retorno.
    router.beforePopState(() => {
      if (ignorarProximoPop) {
        ignorarProximoPop = false;
        return false;
      }
      if (confirmarSaida()) return true;
      ignorarProximoPop = true;
      window.history.go(1);
      return false;
    });

    window.addEventListener('beforeunload', antesDeSair);
    document.addEventListener('click', cliqueEmLink, true);
    router.events.on('routeChangeStart', mudancaDeRota);
    return () => {
      window.removeEventListener('beforeunload', antesDeSair);
      document.removeEventListener('click', cliqueEmLink, true);
      router.events.off('routeChangeStart', mudancaDeRota);
      router.beforePopState(() => true);
    };
  }, [router, confirmarSaida]);

  return confirmarSaida;
}
