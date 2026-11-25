import { useCallback, useEffect, useRef, useState } from 'react';

// Hook de leitura de UMA RPC do BI, com estado independente por bloco
// (carregando / erro com "tentar de novo" / ok). Um bloco com erro não
// derruba os demais.
//
//  - args = null -> consulta desligada (ex.: bloco ainda fora da tela,
//    filtro incompleto, período acima do limite da RPC);
//  - mudança de filtros espera ATRASO_MS (debounce) antes de chamar, e
//    respostas antigas são descartadas (nunca sobrescrevem a atual);
//  - cache e fila (máx. 3 simultâneas) ficam no cliente (lib/bi/consultas).
export const ATRASO_MS = 250;

export function useConsulta(cliente, tipo, args) {
  const chave = args ? cliente.chave(tipo, args) : null;
  const [estado, setEstado] = useState({ chave: null, status: args ? 'carregando' : 'inativo', dados: null, erro: null });
  const [tentativa, setTentativa] = useState(0);
  const argsRef = useRef(args);
  argsRef.current = args;

  useEffect(() => {
    if (!chave) {
      setEstado((e) => (e.status === 'inativo' && e.chave === null ? e : { chave: null, status: 'inativo', dados: null, erro: null }));
      return undefined;
    }
    let vivo = true;
    setEstado((e) => (e.chave === chave && e.status === 'ok' ? e : { chave, status: 'carregando', dados: e.chave === chave ? e.dados : null, erro: null }));
    const t = setTimeout(() => {
      cliente.consultar(tipo, argsRef.current).then(
        (dados) => {
          if (vivo) setEstado({ chave, status: 'ok', dados, erro: null });
        },
        (erro) => {
          if (vivo) setEstado({ chave, status: 'erro', dados: null, erro: erro && erro.message ? erro.message : 'Não foi possível carregar os dados.' });
        }
      );
    }, ATRASO_MS);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [cliente, tipo, chave, tentativa]);

  const tentarDeNovo = useCallback(() => setTentativa((n) => n + 1), []);

  // Enquanto a nova chave não respondeu, o estado é "carregando".
  if (chave && estado.chave !== chave) return { status: 'carregando', dados: null, erro: null, tentarDeNovo };
  return { status: estado.status, dados: estado.dados, erro: estado.erro, tentarDeNovo };
}

// Carregamento progressivo: o bloco só consulta depois de entrar (ou estar
// prestes a entrar) na tela. Uma vez visível, continua ativo.
export function useVisivel(margem = '300px') {
  const ref = useRef(null);
  const [visivel, setVisivel] = useState(false);
  useEffect(() => {
    if (visivel) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisivel(true);
      return undefined;
    }
    const obs = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setVisivel(true);
          obs.disconnect();
        }
      },
      { rootMargin: margem }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visivel, margem]);
  return [ref, visivel];
}
