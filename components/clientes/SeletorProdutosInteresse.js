import { useEffect, useRef, useState } from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { buscarProdutosInteresse, LIMITE_BUSCA_PRODUTOS } from '../../lib/clientes/clientes';
import { rotuloSituacaoProduto } from '../../lib/clientes/filtros';
import {
  adicionarProduto,
  buscarSeHouverTermo,
  estadoListaResultados,
  marcarJaAdicionados,
  removerProduto,
  termoDeBusca,
} from '../../lib/clientes/seletorProdutos';
import estilos from './clientes.module.css';

// Produtos de interesse de 1 cliente (migration 0069). Autocomplete, no
// mesmo espírito do "Produto do Catálogo" de Pedidos: campo vazio não busca
// nem mostra lista; ao digitar, busca sob demanda (RPC
// buscar_produtos_interesse_cliente: só produtos ativos e marcados no
// Catálogo como "Disponível para interesse de clientes", no máximo
// LIMITE_BUSCA_PRODUTOS = 50 por busca -- o mesmo teto do banco); escolher
// um produto limpa o termo e fecha a lista. `selecionados` = [{ produto_id,
// nome, ativo, disponivel }]; um interesse já gravado cujo produto foi
// inativado ou desmarcado continua listado, identificado, e pode ser
// removido. Regras em lib/clientes/seletorProdutos.js.
export default function SeletorProdutosInteresse({ selecionados, onAlterar, podeEditar }) {
  const [termo, setTermo] = useState('');
  const [termoBuscado, setTermoBuscado] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState('');
  const sequencia = useRef(0);

  useEffect(() => {
    const minha = ++sequencia.current;
    if (!termoDeBusca(termo)) {
      // Campo vazio: nenhuma busca, nenhuma lista, nenhuma mensagem.
      setResultados([]);
      setTermoBuscado('');
      setErro('');
      setBuscando(false);
      return undefined;
    }
    setBuscando(true);
    const timer = setTimeout(async () => {
      const r = await buscarSeHouverTermo(termo, buscarProdutosInteresse, LIMITE_BUSCA_PRODUTOS);
      if (minha !== sequencia.current) return;
      setResultados(r.produtos);
      setErro(r.erro);
      setTermoBuscado(r.termo);
      setBuscando(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [termo]);

  function adicionar(produto) {
    onAlterar(adicionarProduto(selecionados, produto));
    setTermo(''); // limpa a busca e fecha a lista
  }

  const estado = estadoListaResultados({ termo, termoBuscado, buscando, erro, resultados, limite: LIMITE_BUSCA_PRODUTOS });

  return (
    <div className={estilos.seletor}>
      {selecionados.length === 0 ? (
        <p className={estilos.vazio}>Nenhum produto de interesse.</p>
      ) : (
        <ul className={estilos.chips} aria-label="Produtos de interesse">
          {selecionados.map((p) => (
            <li key={p.produto_id} className={estilos.chip}>
              <span>{p.nome}</span>
              {rotuloSituacaoProduto(p) && <Badge tom="neutral">{rotuloSituacaoProduto(p)}</Badge>}
              {podeEditar && (
                <button type="button" className={estilos.chipRemover} onClick={() => onAlterar(removerProduto(selecionados, p.produto_id))} aria-label={`Remover ${p.nome}`}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {podeEditar && (
        <>
          <Input
            type="search"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar produto..."
            aria-label="Buscar produto de interesse"
          />
          {estado.tipo !== 'oculto' && (
            <div className={estilos.resultados} role="listbox" aria-label="Produtos encontrados">
              {estado.tipo === 'buscando' ? (
                <p className={estilos.mensagemBusca}>Buscando...</p>
              ) : estado.tipo === 'erro' ? (
                <p className={estilos.mensagemBusca}>{erro}</p>
              ) : estado.tipo === 'vazio' ? (
                <p className={estilos.mensagemBusca}>Nenhum produto encontrado.</p>
              ) : (
                <>
                  {estado.avisoLimite && (
                    <p className={estilos.mensagemBusca}>Mostrando os primeiros {LIMITE_BUSCA_PRODUTOS}. Digite mais do nome para refinar.</p>
                  )}
                  {marcarJaAdicionados(resultados, selecionados).map((p) => (
                    <div key={p.id} className={estilos.resultado}>
                      <span>{p.nome}</span>
                      <Button type="button" variante="secondary" tamanho="sm" disabled={p.adicionado} onClick={() => adicionar(p)}>
                        {p.adicionado ? 'Adicionado' : 'Adicionar'}
                      </Button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
