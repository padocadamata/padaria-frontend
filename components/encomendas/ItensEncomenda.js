import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import useBuscaSobDemanda from './useBuscaSobDemanda';
import { buscarProdutosEncomenda, LIMITE_BUSCA_PRODUTOS_ENCOMENDA } from '../../lib/encomendas/encomendas';
import { MAX_COMENTARIO_ITEM, normalizarQuantidade } from '../../lib/encomendas/regras';
import { rotuloSituacaoProduto } from '../../lib/clientes/filtros';
import estilosClientes from '../clientes/clientes.module.css';
import estilos from './encomendas.module.css';

let proximaChave = 0;
export function novaChaveItem() {
  proximaChave += 1;
  return `item-${proximaChave}`;
}

// Itens da encomenda: busca de produto encomendável (autocomplete, só
// produtos ativos marcados no Catálogo como "Disponível para encomenda",
// no máximo 50) + linhas com quantidade e comentário livre. O mesmo
// produto pode entrar mais de uma vez (ex.: comentários diferentes).
// `itens` = [{ chave, produto_id, nome, quantidade (texto), comentario,
// ativo, disponivel }]; um item já gravado cujo produto foi desmarcado ou
// inativado continua listado e identificado.
export default function ItensEncomenda({ itens, onAlterar, podeEditar }) {
  const busca = useBuscaSobDemanda(buscarProdutosEncomenda, LIMITE_BUSCA_PRODUTOS_ENCOMENDA);
  const { estado } = busca;
  const idsNaLista = new Set(itens.map((i) => i.produto_id));

  function adicionar(produto) {
    onAlterar([...itens, { chave: novaChaveItem(), produto_id: produto.id, nome: produto.nome, quantidade: '1', comentario: '', ativo: true, disponivel: true }]);
    busca.setTermo('');
  }

  function alterar(chave, campos) {
    onAlterar(itens.map((i) => (i.chave === chave ? { ...i, ...campos } : i)));
  }

  return (
    <div className={estilosClientes.seletor}>
      {itens.length === 0 ? (
        <p className={estilosClientes.vazio}>Nenhum produto na encomenda.</p>
      ) : (
        <ol className={estilos.itens} aria-label="Itens da encomenda">
          {itens.map((item, indice) => {
            const quantidadeInvalida = normalizarQuantidade(item.quantidade) === null;
            return (
              <li key={item.chave} className={estilos.item}>
                <div className={estilos.itemCabecalho}>
                  <span className={estilos.itemNome}>
                    {indice + 1}. {item.nome}
                  </span>
                  {rotuloSituacaoProduto(item) && <Badge tom="neutral">{rotuloSituacaoProduto(item)}</Badge>}
                  {podeEditar && (
                    <button type="button" className={estilosClientes.chipRemover} onClick={() => onAlterar(itens.filter((i) => i.chave !== item.chave))} aria-label={`Remover ${item.nome}`}>
                      ×
                    </button>
                  )}
                </div>
                <div className={estilos.itemCampos}>
                  <label className={estilos.itemQuantidade}>
                    <span>Quantidade</span>
                    <Input
                      inputMode="decimal"
                      value={item.quantidade}
                      onChange={(e) => alterar(item.chave, { quantidade: e.target.value })}
                      disabled={!podeEditar}
                      aria-invalid={quantidadeInvalida || undefined}
                    />
                  </label>
                  <label className={estilos.itemComentario}>
                    <span>Comentário (opcional)</span>
                    <Input
                      value={item.comentario}
                      onChange={(e) => alterar(item.chave, { comentario: e.target.value })}
                      maxLength={MAX_COMENTARIO_ITEM}
                      placeholder="Ex.: um deles sem açúcar por cima"
                      disabled={!podeEditar}
                    />
                  </label>
                </div>
                {quantidadeInvalida && <p className={estilos.aviso}>Quantidade inválida: maior que zero (ex.: 2 ou 1,5).</p>}
              </li>
            );
          })}
        </ol>
      )}

      {podeEditar && (
        <>
          <Input
            type="search"
            value={busca.termo}
            onChange={(e) => busca.setTermo(e.target.value)}
            placeholder="Buscar produto para adicionar..."
            aria-label="Buscar produto da encomenda"
          />
          {estado.tipo !== 'oculto' && (
            <div className={estilosClientes.resultados} role="listbox" aria-label="Produtos encontrados">
              {estado.tipo === 'buscando' ? (
                <p className={estilosClientes.mensagemBusca}>Buscando...</p>
              ) : estado.tipo === 'erro' ? (
                <p className={estilosClientes.mensagemBusca}>{busca.erro}</p>
              ) : estado.tipo === 'vazio' ? (
                <p className={estilosClientes.mensagemBusca}>
                  Nenhum produto encontrado. Só aparecem produtos marcados no Catálogo como &quot;Disponível para encomenda&quot;.
                </p>
              ) : (
                <>
                  {estado.avisoLimite && (
                    <p className={estilosClientes.mensagemBusca}>Mostrando os primeiros {LIMITE_BUSCA_PRODUTOS_ENCOMENDA}. Digite mais do nome para refinar.</p>
                  )}
                  {busca.resultados.map((p) => (
                    <div key={p.id} className={estilosClientes.resultado}>
                      <span>{p.nome}</span>
                      <Button type="button" variante="secondary" tamanho="sm" onClick={() => adicionar(p)}>
                        {idsNaLista.has(p.id) ? 'Adicionar outro' : 'Adicionar'}
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
