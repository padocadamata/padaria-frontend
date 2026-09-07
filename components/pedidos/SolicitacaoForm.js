import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { dataLocalHoje } from '../../lib/data/dataLocal';
import { buscarProdutosPorRelevancia } from '../../lib/pedidos/buscaProduto';

// Form único de criação E edição de uma solicitação interna de compra
// (`solicitacao` null = criação; preenchida = edição, só permitida
// enquanto status='pendente' -- a RPC editar_solicitacao_pedido rejeita
// qualquer outro estado, mesma garantia replicada aqui só para uma
// mensagem de erro melhor antes de gastar uma chamada de rede).
//
// Produto cadastrado (produto_id preenchido): busca reaproveitando
// lib/pedidos/buscaProduto.js (mesmo helper de PedidoForm.js/extinto
// CompraPresencialForm.js) -- descricao/unidade exibidas aqui são só
// PREVIEW; o snapshot real e definitivo é sempre recalculado no banco
// pela RPC (criar_solicitacao_pedido/editar_solicitacao_pedido), nunca
// confiando no que este formulário mandar.
//
// Produto não cadastrado: checkbox alterna para um campo de descrição
// livre -- produto_id vai null, unidade não é pedida (V1 simples, ver
// auditoria aprovada seção 6).
function mensagemErro(error) {
  if (!error) return '';
  const msg = error.message || '';
  if (msg.includes('requer a permissao pedidos_solicitacoes.inserir')) {
    return 'Você não tem permissão para criar solicitações.';
  }
  if (msg.includes('requer a permissao pedidos_solicitacoes.editar')) {
    return 'Você não tem permissão para editar esta solicitação.';
  }
  if (msg.includes('somente solicitacoes pendentes podem ser editadas')) {
    return 'Esta solicitação não está mais pendente. Recarregue a página.';
  }
  if (msg.includes('informe uma descricao para produto nao cadastrado')) {
    return 'Informe uma descrição para o item não cadastrado.';
  }
  if (msg.includes('quantidade deve ser maior que zero')) {
    return 'A quantidade deve ser maior que zero.';
  }
  if (msg.includes('data_solicitacao e obrigatoria')) {
    return 'Informe a data da solicitação.';
  }
  if (msg.includes('produto') && msg.includes('nao encontrado')) {
    return 'O produto selecionado não foi encontrado. Recarregue a página e tente novamente.';
  }
  return 'Não foi possível salvar a solicitação. Tente novamente ou avise um administrador.';
}

const overlayEstilo = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
  justifyContent: 'center', zIndex: 1000, padding: '20px',
};
const caixaEstilo = {
  backgroundColor: 'white', padding: '25px', borderRadius: '10px',
  maxWidth: '480px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};
const rotuloEstilo = { fontWeight: 'bold', display: 'block', marginBottom: '5px', fontSize: '14px' };
const campoEstilo = {
  width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '5px', boxSizing: 'border-box',
};
const botaoEstilo = (cor) => ({
  padding: '10px 20px', backgroundColor: cor, color: 'white', border: 'none',
  borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold',
});

export default function SolicitacaoForm({ solicitacao, corPrimaria = '#8B4513', onSalvo, onCancelar }) {
  const estaEditando = solicitacao != null;
  const hoje = dataLocalHoje();

  const [produtos, setProdutos] = useState([]);
  const [carregandoProdutos, setCarregandoProdutos] = useState(true);

  const [naoCadastrado, setNaoCadastrado] = useState(() => estaEditando && !solicitacao.produto_id);
  const [produtoId, setProdutoId] = useState(() => (estaEditando ? solicitacao.produto_id : null));
  const [produtoNome, setProdutoNome] = useState(() => (estaEditando && solicitacao.produto_id ? solicitacao.descricao : ''));
  const [buscaProduto, setBuscaProduto] = useState('');
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [descricaoLivre, setDescricaoLivre] = useState(() => (estaEditando && !solicitacao.produto_id ? solicitacao.descricao : ''));
  const [quantidade, setQuantidade] = useState(() => (estaEditando ? String(solicitacao.quantidade) : ''));
  const [dataSolicitacao, setDataSolicitacao] = useState(() => (estaEditando ? solicitacao.data_solicitacao : hoje));
  const [observacao, setObservacao] = useState(() => (estaEditando ? solicitacao.observacao || '' : ''));

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let efeitoAtivo = true;
    async function carregar() {
      setCarregandoProdutos(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from('produtos')
        .select('id, nome, unidade_medida')
        .eq('ativo', true)
        .order('nome', { ascending: true });
      if (!efeitoAtivo) return;
      if (error) {
        console.error('Erro ao carregar produtos:', error);
      }
      setProdutos(data || []);
      setCarregandoProdutos(false);
    }
    carregar();
    return () => {
      efeitoAtivo = false;
    };
  }, []);

  function alternarNaoCadastrado(marcado) {
    setNaoCadastrado(marcado);
    setProdutoId(null);
    setProdutoNome('');
    setBuscaProduto('');
    if (!marcado) setDescricaoLivre('');
  }

  function selecionarProduto(produto) {
    setProdutoId(produto.id);
    setProdutoNome(produto.nome);
    setBuscaProduto('');
    setBuscaAberta(false);
  }

  async function salvar() {
    const qtd = Number(quantidade);
    if (quantidade === '' || !Number.isFinite(qtd) || qtd <= 0) {
      setErro('Informe uma quantidade maior que zero.');
      return;
    }
    if (!dataSolicitacao) {
      setErro('Informe a data da solicitação.');
      return;
    }
    if (naoCadastrado) {
      if (!descricaoLivre.trim()) {
        setErro('Informe a descrição do item não cadastrado.');
        return;
      }
    } else if (!produtoId) {
      setErro('Selecione um produto, ou marque "Produto não cadastrado".');
      return;
    }

    setSalvando(true);
    setErro('');

    const supabase = createClient();
    const payload = {
      p_produto_id: naoCadastrado ? null : produtoId,
      p_descricao_livre: naoCadastrado ? descricaoLivre.trim() : null,
      p_quantidade: qtd,
      p_data_solicitacao: dataSolicitacao,
      p_observacao: observacao.trim() || null,
    };

    const { error } = estaEditando
      ? await supabase.rpc('editar_solicitacao_pedido', { p_id: solicitacao.id, ...payload })
      : await supabase.rpc('criar_solicitacao_pedido', payload);

    setSalvando(false);

    if (error) {
      console.error('Erro ao salvar solicitação:', error);
      setErro(mensagemErro(error));
      return;
    }

    onSalvo();
  }

  const resultadosBusca = buscarProdutosPorRelevancia(produtos, buscaProduto);

  return (
    <div style={overlayEstilo}>
      <div style={caixaEstilo}>
        <h3 style={{ color: corPrimaria, marginTop: 0 }}>{estaEditando ? 'Editar solicitação' : 'Nova solicitação'}</h3>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '10px' }}>
            <input type="checkbox" checked={naoCadastrado} onChange={(e) => alternarNaoCadastrado(e.target.checked)} />
            Produto não cadastrado
          </label>

          {naoCadastrado ? (
            <>
              <label style={rotuloEstilo}>Descrição *</label>
              <input
                type="text"
                value={descricaoLivre}
                onChange={(e) => setDescricaoLivre(e.target.value)}
                placeholder="Ex.: Esponja para limpeza"
                style={campoEstilo}
                autoFocus
              />
            </>
          ) : (
            <>
              <label style={rotuloEstilo}>Produto *</label>
              {produtoId ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', color: '#333', fontWeight: 'bold' }}>{produtoNome}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setProdutoId(null);
                      setProdutoNome('');
                    }}
                    style={{ border: 'none', background: 'transparent', color: '#2196F3', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' }}
                  >
                    Trocar
                  </button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={buscaProduto}
                    onChange={(e) => {
                      setBuscaProduto(e.target.value);
                      setBuscaAberta(true);
                    }}
                    onFocus={() => setBuscaAberta(true)}
                    onBlur={() => setTimeout(() => setBuscaAberta(false), 150)}
                    placeholder={carregandoProdutos ? 'Carregando produtos...' : 'Buscar produto do Catálogo...'}
                    style={campoEstilo}
                    disabled={carregandoProdutos}
                  />
                  {buscaAberta && buscaProduto.trim() && (
                    <div
                      style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: 'white',
                        border: `1px solid ${corPrimaria}`, borderRadius: '5px', boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
                        zIndex: 10, maxHeight: '160px', overflowY: 'auto',
                      }}
                    >
                      {resultadosBusca.length === 0 ? (
                        <div style={{ padding: '8px 10px', fontSize: '13px', color: '#999' }}>Nenhum produto encontrado.</div>
                      ) : (
                        resultadosBusca.map((produto) => (
                          <div
                            key={produto.id}
                            onMouseDown={() => selecionarProduto(produto)}
                            style={{ padding: '8px 10px', fontSize: '13px', cursor: 'pointer' }}
                            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
                            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            {produto.nome}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
          <div>
            <label style={rotuloEstilo}>Quantidade *</label>
            <input
              type="number"
              min="0"
              step="any"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              style={campoEstilo}
            />
          </div>
          <div>
            <label style={rotuloEstilo}>Data *</label>
            <input
              type="date"
              value={dataSolicitacao}
              onChange={(e) => setDataSolicitacao(e.target.value)}
              style={campoEstilo}
            />
          </div>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={rotuloEstilo}>Observação</label>
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Opcional"
            style={{ ...campoEstilo, minHeight: '50px', fontFamily: 'Arial' }}
          />
        </div>

        {erro && <p style={{ color: '#f44336', fontWeight: 'bold', marginBottom: '15px' }}>{erro}</p>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancelar} disabled={salvando} style={botaoEstilo('#999')}>
            Cancelar
          </button>
          <button type="button" onClick={salvar} disabled={salvando} style={botaoEstilo(corPrimaria)}>
            {salvando ? 'Salvando...' : estaEditando ? 'Salvar alterações' : 'Criar solicitação'}
          </button>
        </div>
      </div>
    </div>
  );
}
