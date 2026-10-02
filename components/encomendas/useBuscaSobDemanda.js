import { useEffect, useRef, useState } from 'react';
import { buscarSeHouverTermo, estadoListaResultados, termoDeBusca } from '../../lib/clientes/seletorProdutos';

// Autocomplete sob demanda (mesmo comportamento do seletor de Produtos de
// interesse de Clientes, com as MESMAS regras puras de
// lib/clientes/seletorProdutos.js): campo vazio não busca nem mostra
// nada; 250 ms depois de digitar busca; respostas antigas são descartadas.
// `buscar(termo, limite)` devolve { produtos, erro } (contrato das RPCs).
export default function useBuscaSobDemanda(buscar, limite) {
  const [termo, setTermo] = useState('');
  const [termoBuscado, setTermoBuscado] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState('');
  const sequencia = useRef(0);
  const buscarRef = useRef(buscar);
  buscarRef.current = buscar;

  useEffect(() => {
    const minha = ++sequencia.current;
    if (!termoDeBusca(termo)) {
      setResultados([]);
      setTermoBuscado('');
      setErro('');
      setBuscando(false);
      return undefined;
    }
    setBuscando(true);
    const timer = setTimeout(async () => {
      const r = await buscarSeHouverTermo(termo, buscarRef.current, limite);
      if (minha !== sequencia.current) return;
      setResultados(r.produtos);
      setErro(r.erro);
      setTermoBuscado(r.termo);
      setBuscando(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [termo, limite]);

  const estado = estadoListaResultados({ termo, termoBuscado, buscando, erro, resultados, limite });
  return { termo, setTermo, resultados, erro, estado };
}
