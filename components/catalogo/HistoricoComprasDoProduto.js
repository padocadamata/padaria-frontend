import { useState } from 'react';
import LancarCompraForm from './LancarCompraForm';

function formatarData(dataYYYYMMDD) {
  const [ano, mes, dia] = dataYYYYMMDD.split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Card "Histórico de compras" de /catalogo/[id]. `lancamentos` já vem
// carregado pela página (ver comentário em FornecedoresDoProduto.js
// sobre a mesma decisão). "Editar" só aparece para origem='manual' --
// linhas origem='recebimento_pedido' (Fase C, nenhuma existe ainda) são
// somente leitura por desenho do banco (trigger
// produtos_historico_compras_protecao, migration 0023), então nem
// tentamos oferecer editar para elas aqui.
export default function HistoricoComprasDoProduto({ produtoId, lancamentos, configuracoesComerciais, fornecedoresAtivos, podeEditar, corPrimaria = '#8B4513', onRecarregar }) {
  const [modalAberto, setModalAberto] = useState(false);
  const [lancamentoEmEdicao, setLancamentoEmEdicao] = useState(null);
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  function abrirNovoLancamento() {
    setLancamentoEmEdicao(null);
    setModalAberto(true);
  }

  function abrirEdicaoLancamento(lancamento) {
    setLancamentoEmEdicao(lancamento);
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
    setLancamentoEmEdicao(null);
  }

  function aoSalvar() {
    const estaEditando = lancamentoEmEdicao != null;
    fecharModal();
    setMensagemSucesso(estaEditando ? 'Lançamento atualizado com sucesso.' : 'Compra lançada com sucesso.');
    setTimeout(() => setMensagemSucesso(''), 4000);
    onRecarregar();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>Histórico de compras</h3>

        {podeEditar && (
          <button
            type="button"
            onClick={abrirNovoLancamento}
            style={{
              padding: '8px 16px',
              backgroundColor: corPrimaria,
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '13px',
            }}
          >
            + Lançar compra
          </button>
        )}
      </div>

      {mensagemSucesso && <p style={{ color: '#4CAF50', fontWeight: 'bold', marginBottom: '10px' }}>{mensagemSucesso}</p>}

      {lancamentos.length === 0 ? (
        <p style={{ color: '#666' }}>Nenhuma compra registrada para este produto.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
                <th style={{ padding: '8px' }}>Data</th>
                <th style={{ padding: '8px' }}>Fornecedor</th>
                <th style={{ padding: '8px' }}>Unidade</th>
                <th style={{ padding: '8px' }}>Quantidade</th>
                <th style={{ padding: '8px' }}>Preço unitário</th>
                <th style={{ padding: '8px' }}>Preço-base</th>
                <th style={{ padding: '8px' }}>Origem</th>
                <th style={{ padding: '8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {lancamentos.map((lancamento) => (
                <tr key={lancamento.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px' }}>{formatarData(lancamento.data_compra)}</td>
                  <td style={{ padding: '8px' }}>{lancamento.fornecedorNome}</td>
                  <td style={{ padding: '8px' }}>{lancamento.unidade_comercial}</td>
                  <td style={{ padding: '8px' }}>{lancamento.quantidade_comercial}</td>
                  <td style={{ padding: '8px' }}>{formatarMoeda(lancamento.preco_unitario_comercial)}</td>
                  <td style={{ padding: '8px' }}>
                    {lancamento.preco_unitario_base != null ? formatarMoeda(lancamento.preco_unitario_base) : '—'}
                  </td>
                  <td style={{ padding: '8px' }}>
                    {lancamento.origem === 'manual' ? 'Manual' : 'Recebimento'}
                  </td>
                  <td style={{ padding: '8px' }}>
                    {podeEditar && lancamento.origem === 'manual' && (
                      <button
                        type="button"
                        onClick={() => abrirEdicaoLancamento(lancamento)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#2196F3',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontSize: '13px',
                        }}
                      >
                        Editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalAberto && (
        <LancarCompraForm
          produtoId={produtoId}
          fornecedoresAtivos={fornecedoresAtivos}
          configuracoesComerciais={configuracoesComerciais}
          lancamento={lancamentoEmEdicao}
          corPrimaria={corPrimaria}
          onFechar={fecharModal}
          onSalvo={aoSalvar}
        />
      )}
    </div>
  );
}
